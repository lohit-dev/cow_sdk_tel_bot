import { Token, CurrencyAmount, TradeType, Percent } from "@uniswap/sdk-core";
import { Pool, Route, Trade, tickToPrice } from "@uniswap/v3-sdk";
import { ethers } from "ethers";
import { EthereumWallet, SwapResult, TokenInfo } from "../../types";
import { CONFIG } from "../../config";
import { tokenService } from "../token/token.service";

// ERC20 ABI for token interactions
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
];

// Uniswap V3 configuration
const UNISWAP_V3_FACTORY = "0x0227628f3F023bb0B980b67D528571c95c6DaC1c"; // Sepolia
const SWAP_ROUTER = "0x65669fe35312947050c450bd5d36e6361f85ec12"; // SwapRouter V3 on Sepolia
const NATIVE_ETH_ADDRESS = "0x0000000000000000000000000000000000000000";
const WETH_ADDRESS = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"; // Sepolia WETH

// Default swap settings
const DEFAULT_SLIPPAGE_TOLERANCE_PERCENT = 3; // 3%
const DEFAULT_TRANSACTION_DEADLINE_MINUTES = 20;

export class UniswapService {
  private provider: ethers.providers.JsonRpcProvider;

  constructor() {
    this.provider = new ethers.providers.JsonRpcProvider(
      CONFIG.RPC_URL ||
        "https://eth-sepolia.g.alchemy.com/v2/zN3JM2LnBeD4lFHMlO_iA8IoQA8Ws9_r"
    );
  }

  /**
   * Check if address is native ETH
   */
  private isNativeETH(address: string): boolean {
    return address.toLowerCase() === NATIVE_ETH_ADDRESS.toLowerCase();
  }

  /**
   * Find token by symbol, name, or address
   */
  public async findToken(
    tokenQuery: string,
    chainId: number
  ): Promise<TokenInfo | undefined> {
    let token = tokenService.findTokenBySymbol(tokenQuery, chainId, "uni");

    // If not found, try by address
    if (!token && ethers.utils.isAddress(tokenQuery)) {
      token = tokenService.findTokenByAddress(tokenQuery, chainId, "uni");
    }

    // If still not found, search in all fields
    if (!token) {
      const results = tokenService.searchTokens(tokenQuery, chainId, "uni");
      if (results.length > 0) {
        token = results[0];
      }
    }

    return token;
  }

  /**
   * Create Token instance for Uniswap SDK
   */
  private async createToken(address: string, chainId: number): Promise<Token> {
    const token = await this.findToken(address, chainId);

    if (!token) {
      throw new Error(`Token not found: ${address}`);
    }

    // For native ETH, use WETH for Uniswap calculations
    const tokenAddress = this.isNativeETH(address) ? WETH_ADDRESS : address;

    return new Token(
      chainId,
      tokenAddress,
      token.decimals,
      token.symbol,
      token.name
    );
  }

  /**
   * Check token balance
   */
  private async checkTokenBalance(
    wallet: ethers.Wallet,
    tokenAddress: string,
    amount: string
  ): Promise<boolean> {
    try {
      if (this.isNativeETH(tokenAddress)) {
        // Check ETH balance
        const balance = await this.provider.getBalance(wallet.address);
        const amountBN = ethers.utils.parseEther(amount);
        return balance.gte(amountBN);
      } else {
        // Check ERC20 token balance
        const tokenContract = new ethers.Contract(
          tokenAddress,
          ERC20_ABI,
          wallet
        );
        const decimals = await tokenContract.decimals();
        const balance = await tokenContract.balanceOf(wallet.address);
        const amountBN = ethers.utils.parseUnits(amount, decimals);
        return balance.gte(amountBN);
      }
    } catch (error) {
      console.error("Error checking token balance:", error);
      return false;
    }
  }

  /**
   * Check and approve token allowance
   */
  private async ensureTokenAllowance(
    wallet: ethers.Wallet,
    tokenAddress: string,
    amount: string
  ): Promise<{ approved: boolean; txHash?: string }> {
    try {
      // Native ETH doesn't need approval
      if (this.isNativeETH(tokenAddress)) {
        return { approved: true };
      }

      console.log(`Checking allowance for token ${tokenAddress}...`);

      // Create token contract instance
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        wallet
      );

      // Get token decimals
      const decimals = await tokenContract.decimals();

      // Parse amount with proper decimals
      const amountBN = ethers.utils.parseUnits(amount, decimals);

      // Check current allowance
      const currentAllowance = await tokenContract.allowance(
        wallet.address,
        SWAP_ROUTER
      );

      // If allowance is less than the amount, approve with unlimited amount
      if (currentAllowance.lt(amountBN)) {
        console.log(
          `Current allowance (${ethers.utils.formatUnits(
            currentAllowance,
            decimals
          )}) is less than required (${amount})`
        );
        console.log(
          `Approving token ${tokenAddress} for unlimited amount to spender ${SWAP_ROUTER}...`
        );

        // Approve max uint256 for unlimited allowance
        const maxUint256 = ethers.constants.MaxUint256;
        const tx = await tokenContract.approve(SWAP_ROUTER, maxUint256);

        console.log(`Approval transaction sent: ${tx.hash}`);
        await tx.wait();
        console.log(
          "Approval confirmed! Unlimited approval set for future swaps."
        );

        return { approved: true, txHash: tx.hash };
      } else {
        console.log(
          "Token already approved with sufficient allowance. No new approval needed."
        );
        return { approved: true };
      }
    } catch (error) {
      console.error("Error approving token:", error);
      return { approved: false };
    }
  }

  /**
   * Find working pool for the token pair
   */
  private async findWorkingPool(
    token0: Token,
    token1: Token,
    chainId: number
  ): Promise<Pool> {
    const feeTiers = [100, 200, 300, 500, 3000, 10000];

    // Get the factory contract
    const factoryContract = new ethers.Contract(
      UNISWAP_V3_FACTORY,
      [
        "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
      ],
      this.provider
    );

    // Sort tokens to match Uniswap's ordering
    const [tokenA, tokenB] = token0.sortsBefore(token1)
      ? [token0, token1]
      : [token1, token0];

    // Try each fee tier
    for (const fee of feeTiers) {
      try {
        // Get pool address
        const poolAddress = await factoryContract.getPool(
          tokenA.address,
          tokenB.address,
          fee
        );

        // Skip if pool doesn't exist
        if (poolAddress === ethers.constants.AddressZero) {
          continue;
        }

        // Get pool data
        const poolData = await this.getPoolData(poolAddress);

        // Create Pool instance
        const pool = new Pool(
          tokenA,
          tokenB,
          fee,
          poolData.sqrtPriceX96.toString(),
          poolData.liquidity.toString(),
          poolData.tick
        );

        return pool;
      } catch (error) {
        console.log(`No working pool found for fee tier ${fee}`);
      }
    }

    throw new Error(
      `No working pool found for ${token0.symbol}/${token1.symbol}`
    );
  }

  /**
   * Get pool data
   */
  private async getPoolData(poolAddress: string) {
    const poolContract = new ethers.Contract(
      poolAddress,
      [
        "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
        "function liquidity() external view returns (uint128)",
      ],
      this.provider
    );

    // Get current pool state
    const [slot0, liquidity] = await Promise.all([
      poolContract.slot0(),
      poolContract.liquidity(),
    ]);

    return {
      sqrtPriceX96: slot0.sqrtPriceX96,
      tick: slot0.tick,
      liquidity: liquidity,
    };
  }

  /**
   * Build swap transaction data for Uniswap V3 SwapRouter
   */
  private buildSwapTransaction(
    trade: Trade<Token, Token, TradeType>,
    walletAddress: string,
    deadline: number,
    amountOutMinimum: CurrencyAmount<Token>,
    isInputNative: boolean,
    isOutputNative: boolean
  ) {
    // Get the swap router contract
    const swapRouter = new ethers.Contract(
      SWAP_ROUTER,
      [
        "function exactInput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)",
        "function exactOutput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum)) external payable returns (uint256 amountIn)",
      ],
      this.provider
    );

    // Encode the route path
    const path = this.encodePath(
      trade.route.tokenPath.map((token) => token.address),
      trade.route.pools.map((pool) => pool.fee)
    );

    // Prepare transaction parameters based on trade type
    if (trade.tradeType === TradeType.EXACT_INPUT) {
      const params = {
        path,
        recipient: isOutputNative ? SWAP_ROUTER : walletAddress,
        deadline,
        amountIn: trade.inputAmount.quotient.toString(),
        amountOutMinimum: amountOutMinimum.quotient.toString(),
      };

      // Encode function data
      const data = swapRouter.interface.encodeFunctionData("exactInput", [
        params,
      ]);

      // For native ETH input, we need to send ETH with the transaction
      const value = isInputNative ? trade.inputAmount.quotient.toString() : "0";

      return { data, value };
    } else {
      // EXACT_OUTPUT
      const params = {
        path,
        recipient: isOutputNative ? SWAP_ROUTER : walletAddress,
        deadline,
        amountOut: trade.outputAmount.quotient.toString(),
        amountInMaximum: trade
          .maximumAmountIn(
            new Percent(DEFAULT_SLIPPAGE_TOLERANCE_PERCENT * 100, 10_000)
          )
          .quotient.toString(),
      };

      // Encode function data
      const data = swapRouter.interface.encodeFunctionData("exactOutput", [
        params,
      ]);

      // For native ETH input, we need to send ETH with the transaction
      const value = isInputNative ? params.amountInMaximum : "0";

      return { data, value };
    }
  }

  /**
   * Encode path for Uniswap V3 SwapRouter
   */
  private encodePath(path: string[], fees: number[]): string {
    if (path.length !== fees.length + 1) {
      throw new Error("Path and fees length mismatch");
    }

    let encoded = "0x";
    for (let i = 0; i < fees.length; i++) {
      encoded += path[i].slice(2);
      encoded += fees[i].toString(16).padStart(6, "0");
    }
    encoded += path[path.length - 1].slice(2);

    return encoded;
  }

  /**
   * Execute a swap on Uniswap V3
   */
  public async executeSwap(
    wallet: EthereumWallet,
    sellTokenQuery: string,
    buyTokenQuery: string,
    sellAmount: string,
    slippageBps: number = DEFAULT_SLIPPAGE_TOLERANCE_PERCENT * 100, // Default 3%
    chainId: number = CONFIG.CHAIN_ID || 11155111, // Default to Sepolia
    onOrderCreated?: (txHash: string, chainId: number) => Promise<void> // Callback for transaction creation
  ): Promise<SwapResult> {
    try {
      console.log(`Starting Uniswap swap process...`);
      console.log(`Sell token: ${sellTokenQuery}, Buy token: ${buyTokenQuery}`);
      console.log(`Amount: ${sellAmount}, Chain ID: ${chainId}`);

      // Find tokens
      const sellToken = await this.findToken(sellTokenQuery, chainId);
      const buyToken = await this.findToken(buyTokenQuery, chainId);

      if (!sellToken) {
        return {
          success: false,
          message: `Sell token not found: ${sellTokenQuery}`,
        };
      }

      if (!buyToken) {
        return {
          success: false,
          message: `Buy token not found: ${buyTokenQuery}`,
        };
      }

      console.log(`Found tokens: ${sellToken.symbol} -> ${buyToken.symbol}`);

      // Create wallet instance
      const ethWallet = new ethers.Wallet(wallet.privateKey, this.provider);

      // Check if user has enough balance
      const hasBalance = await this.checkTokenBalance(
        ethWallet,
        sellToken.address,
        sellAmount
      );

      if (!hasBalance) {
        return {
          success: false,
          message: `Insufficient ${sellToken.symbol} balance for the swap`,
        };
      }

      console.log(`Balance check passed for ${sellAmount} ${sellToken.symbol}`);

      // Check if native ETH is involved
      const isInputNative = this.isNativeETH(sellToken.address);
      const isOutputNative = this.isNativeETH(buyToken.address);

      // If selling tokens (not ETH), ensure allowance
      let approvalResult = { approved: true };
      if (!isInputNative) {
        approvalResult = await this.ensureTokenAllowance(
          ethWallet,
          sellToken.address,
          sellAmount
        );

        if (!approvalResult.approved) {
          return {
            success: false,
            message: `Failed to approve ${sellToken.symbol} for trading`,
          };
        }
      }

      console.log("Token approval confirmed or not needed");

      // Create SDK Token instances
      const inputToken = await this.createToken(sellToken.address, chainId);
      const outputToken = await this.createToken(buyToken.address, chainId);

      // Find a working pool
      console.log(
        `Finding liquidity pool for ${inputToken.symbol}/${outputToken.symbol}...`
      );
      const pool = await this.findWorkingPool(inputToken, outputToken, chainId);
      console.log(`Found pool with fee tier: ${pool.fee / 10000}%`);

      // Create the trade
      const amountIn = CurrencyAmount.fromRawAmount(
        inputToken,
        ethers.utils.parseUnits(sellAmount, inputToken.decimals).toString()
      );

      // Create a route with the pool
      const route = new Route([pool], inputToken, outputToken);

      // Create a trade
      const trade = Trade.createUncheckedTrade({
        route,
        inputAmount: amountIn,
        outputAmount: CurrencyAmount.fromRawAmount(
          outputToken,
          route.midPrice.quote(amountIn.wrapped).quotient.toString()
        ),
        tradeType: TradeType.EXACT_INPUT,
      });

      // Calculate expected output with price impact
      const outputAmount = trade.outputAmount;
      const formattedOutputAmount = outputAmount.toSignificant(6);

      console.log(`Trade analysis:`);
      console.log(
        `- Input: ${trade.inputAmount.toExact()} ${inputToken.symbol}`
      );
      console.log(
        `- Expected output: ${formattedOutputAmount} ${outputToken.symbol}`
      );
      console.log(
        `- Price: ${trade.executionPrice.toSignificant(6)} ${
          outputToken.symbol
        }/${inputToken.symbol}`
      );
      console.log(`- Price impact: ${trade.priceImpact.toSignificant(2)}%`);

      // Apply slippage tolerance
      const slippageTolerance = new Percent(slippageBps, 10_000);
      const amountOutMinimum = trade.minimumAmountOut(slippageTolerance);
      console.log(
        `- Minimum output with slippage: ${amountOutMinimum.toExact()} ${
          outputToken.symbol
        }`
      );

      // Set transaction deadline
      const deadline =
        Math.floor(Date.now() / 1000) +
        60 * DEFAULT_TRANSACTION_DEADLINE_MINUTES;

      // Build transaction
      const { data: calldata, value } = this.buildSwapTransaction(
        trade,
        ethWallet.address,
        deadline,
        amountOutMinimum,
        isInputNative,
        isOutputNative
      );

      // Estimate gas
      console.log("Estimating gas...");
      try {
        const gasEstimate = await this.provider.estimateGas({
          to: SWAP_ROUTER,
          data: calldata,
          value,
          from: ethWallet.address,
        });

        const gasPrice = await this.provider.getGasPrice();
        const gasCost = gasEstimate.mul(gasPrice);

        console.log(`- Gas limit: ${gasEstimate.toString()}`);
        console.log(
          `- Gas price: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`
        );
        console.log(
          `- Estimated gas cost: ${ethers.utils.formatEther(gasCost)} ETH`
        );

        // Execute transaction
        console.log("Executing swap transaction...");
        const tx = await ethWallet.sendTransaction({
          to: SWAP_ROUTER,
          data: calldata,
          value,
          gasLimit: gasEstimate.mul(120).div(100), // 20% buffer
        });

        console.log(`Transaction sent: ${tx.hash}`);

        // Call the callback if provided
        if (onOrderCreated) {
          await onOrderCreated(tx.hash, chainId);
        }

        // Wait for transaction confirmation
        const receipt = await tx.wait();

        if (receipt.status === 1) {
          return {
            success: true,
            message: `Swap completed successfully! Received approximately ${formattedOutputAmount} ${outputToken.symbol}`,
            txHash: tx.hash,
            sellToken: sellToken.symbol,
            buyToken: buyToken.symbol,
            sellAmount,
            expectedBuyAmount: formattedOutputAmount,
            chainId,
          };
        } else {
          return {
            success: false,
            message: "Transaction failed on-chain",
            txHash: tx.hash,
          };
        }
      } catch (error: any) {
        console.error("Error executing swap:", error);

        // Handle specific error cases
        if (error.reason) {
          return {
            success: false,
            message: `Transaction failed: ${error.reason}`,
            error,
          };
        }

        return {
          success: false,
          message: `Error executing swap: ${error.message || "Unknown error"}`,
          error,
        };
      }
    } catch (error: any) {
      console.error("Error in swap preparation:", error);
      return {
        success: false,
        message: `Error preparing swap: ${error.message || "Unknown error"}`,
        error,
      };
    }
  }

  /**
   * Get a quote from Uniswap V3 without executing the swap
   */
  async getQuote(
    wallet: EthereumWallet,
    sellTokenQuery: string,
    buyTokenQuery: string,
    sellAmount: string,
    slippageBps: number = DEFAULT_SLIPPAGE_TOLERANCE_PERCENT * 100, // Default 3%
    chainId: number = CONFIG.CHAIN_ID || 11155111 // Default to Sepolia
  ): Promise<{
    success: boolean;
    buyAmount?: string;
    sellAmount?: string;
    buyToken?: string;
    sellToken?: string;
    priceImpact?: string;
    message?: string;
  }> {
    try {
      console.log(`Starting Uniswap quote process...`);
      console.log(`Sell token: ${sellTokenQuery}, Buy token: ${buyTokenQuery}`);
      console.log(`Amount: ${sellAmount}, Chain ID: ${chainId}`);

      // Find tokens
      const sellToken = await this.findToken(sellTokenQuery, chainId);
      const buyToken = await this.findToken(buyTokenQuery, chainId);

      if (!sellToken) {
        return {
          success: false,
          message: `Sell token not found: ${sellTokenQuery}`,
        };
      }

      if (!buyToken) {
        return {
          success: false,
          message: `Buy token not found: ${buyTokenQuery}`,
        };
      }

      console.log(`Found tokens: ${sellToken.symbol} -> ${buyToken.symbol}`);

      // Create wallet instance
      const ethWallet = new ethers.Wallet(wallet.privateKey, this.provider);

      // Check if user has enough balance
      const hasBalance = await this.checkTokenBalance(
        ethWallet,
        sellToken.address,
        sellAmount
      );

      if (!hasBalance) {
        return {
          success: false,
          message: `Insufficient ${sellToken.symbol} balance for the swap`,
        };
      }

      console.log(`Balance check passed for ${sellAmount} ${sellToken.symbol}`);

      // Check if native ETH is involved
      const isInputNative = this.isNativeETH(sellToken.address);
      const isOutputNative = this.isNativeETH(buyToken.address);

      // If selling tokens (not ETH), ensure allowance
      let approvalResult = { approved: true };
      if (!isInputNative) {
        approvalResult = await this.ensureTokenAllowance(
          ethWallet,
          sellToken.address,
          sellAmount
        );

        if (!approvalResult.approved) {
          return {
            success: false,
            message: `Failed to approve ${sellToken.symbol} for trading`,
          };
        }
      }

      console.log("Token approval confirmed or not needed");

      // Create SDK Token instances
      const inputToken = await this.createToken(sellToken.address, chainId);
      const outputToken = await this.createToken(buyToken.address, chainId);

      // Find a working pool
      console.log(
        `Finding liquidity pool for ${inputToken.symbol}/${outputToken.symbol}...`
      );
      const pool = await this.findWorkingPool(inputToken, outputToken, chainId);

      if (!pool) {
        return {
          success: false,
          message: "No liquidity pool found for this token pair",
        };
      }

      console.log(`Found pool with fee tier: ${pool.fee / 10000}%`);

      // Create the trade
      const amountIn = CurrencyAmount.fromRawAmount(
        inputToken,
        ethers.utils.parseUnits(sellAmount, inputToken.decimals).toString()
      );

      // Create a route with the pool
      const route = new Route([pool], inputToken, outputToken);

      // Create a trade
      const trade = Trade.createUncheckedTrade({
        route,
        inputAmount: amountIn,
        outputAmount: CurrencyAmount.fromRawAmount(
          outputToken,
          route.midPrice.quote(amountIn.wrapped).quotient.toString()
        ),
        tradeType: TradeType.EXACT_INPUT,
      });

      // Calculate expected output with price impact
      const outputAmount = trade.outputAmount;
      const formattedOutputAmount = outputAmount.toSignificant(6);
      const priceImpact = trade.priceImpact.toSignificant(2);

      console.log(`Uniswap quote analysis:`);
      console.log(
        `- Input: ${trade.inputAmount.toExact()} ${inputToken.symbol}`
      );
      console.log(
        `- Expected output: ${formattedOutputAmount} ${outputToken.symbol}`
      );
      console.log(
        `- Price: ${trade.executionPrice.toSignificant(6)} ${
          outputToken.symbol
        }/${inputToken.symbol}`
      );
      console.log(`- Price impact: ${priceImpact}%`);

      // Apply slippage tolerance
      const slippageTolerance = new Percent(slippageBps, 10_000);
      const amountOutMinimum = trade.minimumAmountOut(slippageTolerance);
      console.log(
        `- Minimum output with slippage: ${amountOutMinimum.toExact()} ${
          outputToken.symbol
        }`
      );

      // Return the quote information
      return {
        success: true,
        buyAmount: formattedOutputAmount,
        sellAmount: sellAmount,
        buyToken: buyToken.symbol,
        sellToken: sellToken.symbol,
        priceImpact: priceImpact,
      };
    } catch (error: any) {
      console.error("Error getting Uniswap quote:", error);
      return {
        success: false,
        message: `Error getting quote: ${error.message || "Unknown error"}`,
      };
    }
  }
}

export const uniswapService = new UniswapService();
