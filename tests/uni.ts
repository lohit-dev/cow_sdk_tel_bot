import { Token, CurrencyAmount, TradeType, Percent } from "@uniswap/sdk-core";
import { Pool, Route, Trade, tickToPrice } from "@uniswap/v3-sdk";
import { ethers } from "ethers";
import * as readline from "readline";

// ============= CONFIGURATION VARIABLES =============
// Chain configuration
const SEPOLIA_CHAIN_ID = 11155111;
const SWAP_ROUTER = "0x65669fe35312947050c450bd5d36e6361f85ec12"; // SwapRouter V3
const UNISWAP_V3_FACTORY = "0x0227628f3F023bb0B980b67D528571c95c6DaC1c";
const provider = new ethers.providers.JsonRpcProvider(
  process.env.RPC_URL || "https://sepolia.drpc.org"
);

// Token configuration - Change these for different swaps
const TO_TOKEN_ADDRESS = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"; // WETH
const FROM_TOKEN_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"; // USDC
const AMOUNT_TO_SWAP = "10";

// Special addresses
const NATIVE_ETH_ADDRESS = "0x0000000000000000000000000000000000000000";
const WETH_ADDRESS = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";

// Wallet configuration
const PRIVATE_KEY =
  "7c7f9b2aac806a014c9a26d31d1c21a123aa6e8c130374369b4b5365e7bc347b";

// Swap settings
const SLIPPAGE_TOLERANCE_PERCENT = 3; // 3%
const TRANSACTION_DEADLINE_MINUTES = 20;

const TOKEN_METADATA = {
  "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238": {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
  },
  "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14": {
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
  },
  "0x0000000000000000000000000000000000000000": {
    symbol: "ETH",
    name: "Ethereum",
    decimals: 18,
  },
};

// ERC20 Token ABI
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
];

// Helper function to check if address is native ETH
function isNativeETH(address: string): boolean {
  return address.toLowerCase() === NATIVE_ETH_ADDRESS.toLowerCase();
}

// Helper function to get token metadata
async function getTokenInfo(
  address: string
): Promise<{ symbol: string; name: string; decimals: number }> {
  if (isNativeETH(address)) {
    return TOKEN_METADATA[NATIVE_ETH_ADDRESS];
  }

  // Check if we have cached metadata
  const cached = TOKEN_METADATA[address.toLowerCase()];
  if (cached) {
    return cached;
  }

  // Fetch from contract
  try {
    const tokenContract = new ethers.Contract(address, ERC20_ABI, provider);
    const [symbol, name, decimals] = await Promise.all([
      tokenContract.symbol(),
      tokenContract.name(),
      tokenContract.decimals(),
    ]);

    return { symbol, name, decimals };
  } catch (error) {
    console.error(`Failed to fetch token info for ${address}:`, error);
    throw new Error(`Unable to fetch token information for ${address}`);
  }
}

// Create Token instance
async function createToken(address: string): Promise<Token> {
  const info = await getTokenInfo(address);

  // For native ETH, use WETH for Uniswap calculations
  const tokenAddress = isNativeETH(address) ? WETH_ADDRESS : address;

  return new Token(
    SEPOLIA_CHAIN_ID,
    tokenAddress,
    info.decimals,
    info.symbol,
    info.name
  );
}

// Check and approve token allowance
async function ensureTokenAllowance(
  tokenAddress: string,
  walletAddress: string,
  spenderAddress: string,
  requiredAmount: string,
  wallet: ethers.Wallet
): Promise<void> {
  if (isNativeETH(tokenAddress)) {
    console.log("✅ Native ETH doesn't require approval");
    return;
  }

  console.log(`\n🔍 Checking ${tokenAddress} allowance...`);

  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const currentAllowance = await tokenContract.allowance(
    walletAddress,
    spenderAddress
  );

  console.log(
    `- Current allowance: ${ethers.utils.formatUnits(
      currentAllowance,
      await tokenContract.decimals()
    )}`
  );
  console.log(
    `- Required amount: ${ethers.utils.formatUnits(
      requiredAmount,
      await tokenContract.decimals()
    )}`
  );

  if (currentAllowance.lt(requiredAmount)) {
    console.log("⏳ Insufficient allowance, approving...");

    // Approve maximum amount for future transactions
    const maxAmount = ethers.constants.MaxUint256;
    const approveTx = await tokenContract.approve(spenderAddress, maxAmount);

    console.log(`📝 Approval transaction sent: ${approveTx.hash}`);
    console.log("⏳ Waiting for approval confirmation...");

    const approvalReceipt = await approveTx.wait();
    console.log(
      `✅ Approval confirmed in block ${approvalReceipt.blockNumber}`
    );
  } else {
    console.log("✅ Sufficient allowance already exists");
  }
}

// Check token balance
async function checkTokenBalance(
  tokenAddress: string,
  walletAddress: string,
  requiredAmount: string
): Promise<boolean> {
  let balance: ethers.BigNumber;
  let decimals: number;
  let symbol: string;

  if (isNativeETH(tokenAddress)) {
    balance = await provider.getBalance(walletAddress);
    decimals = 18;
    symbol = "ETH";
  } else {
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ERC20_ABI,
      provider
    );
    [balance, decimals, symbol] = await Promise.all([
      tokenContract.balanceOf(walletAddress),
      tokenContract.decimals(),
      tokenContract.symbol(),
    ]);
  }

  const formattedBalance = ethers.utils.formatUnits(balance, decimals);
  const formattedRequired = ethers.utils.formatUnits(requiredAmount, decimals);

  console.log(`💰 ${symbol} Balance: ${formattedBalance}`);
  console.log(`📊 Required: ${formattedRequired}`);

  const hasEnough = balance.gte(requiredAmount);
  if (!hasEnough) {
    console.error(`❌ Insufficient ${symbol} balance!`);
  }

  return hasEnough;
}

// Calculate quote using V3 SDK pool methods
function calculateQuoteFromPool(
  pool: Pool,
  inputAmount: CurrencyAmount<Token>,
  inputToken: Token,
  outputToken: Token
): CurrencyAmount<Token> {
  try {
    console.log("Calculating quote using pool price methods...");

    const price = inputToken.equals(pool.token0)
      ? pool.token0Price
      : pool.token1Price;

    console.log(
      `Pool price: 1 ${inputToken.symbol} = ${price.toSignificant(6)} ${
        outputToken.symbol
      }`
    );

    const outputAmount = price.quote(inputAmount);

    console.log(
      `SDK Quote: ${inputAmount.toExact()} ${
        inputToken.symbol
      } → ${outputAmount.toExact()} ${outputToken.symbol}`
    );

    return outputAmount;
  } catch (error) {
    console.error("Pool quote calculation failed:", error);
    return calculateQuoteFromTick(pool, inputAmount, inputToken, outputToken);
  }
}

// Alternative calculation using tick math
function calculateQuoteFromTick(
  pool: Pool,
  inputAmount: CurrencyAmount<Token>,
  inputToken: Token,
  outputToken: Token
): CurrencyAmount<Token> {
  try {
    console.log("Using tick-based calculation as fallback...");

    const currentTick = pool.tickCurrent;
    console.log("Current tick:", currentTick);

    const price = tickToPrice(inputToken, outputToken, currentTick);
    console.log(
      `Tick price: 1 ${inputToken.symbol} = ${price.toSignificant(6)} ${
        outputToken.symbol
      }`
    );

    const outputAmount = price.quote(inputAmount);

    console.log(
      `Tick Quote: ${inputAmount.toExact()} ${
        inputToken.symbol
      } → ${outputAmount.toExact()} ${outputToken.symbol}`
    );

    return outputAmount;
  } catch (error) {
    console.error("Tick calculation failed:", error);
    throw new Error("Unable to calculate quote from pool");
  }
}

// Find working pool
async function findWorkingPool(token0: Token, token1: Token) {
  const factoryContract = new ethers.Contract(
    UNISWAP_V3_FACTORY,
    [
      "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
    ],
    provider
  );

  const feeTiers = [100, 500, 3000, 10000];

  for (const fee of feeTiers) {
    try {
      const poolAddress = await factoryContract.getPool(
        token0.address,
        token1.address,
        fee
      );

      console.log(`Pool for fee ${fee}: ${poolAddress}`);

      if (poolAddress !== "0x0000000000000000000000000000000000000000") {
        const poolData = await getPoolData(poolAddress);
        if (poolData && poolData.liquidity.toString() !== "0") {
          console.log(`Found working pool at ${poolAddress} with fee ${fee}`);
          return { address: poolAddress, ...poolData };
        }
      }
    } catch (error) {
      console.log(`Fee tier ${fee} failed:`, error.message);
    }
  }

  return null;
}

// Get pool data
async function getPoolData(poolAddress: string) {
  try {
    const poolContract = new ethers.Contract(
      poolAddress,
      [
        "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
        "function liquidity() view returns (uint128)",
        "function fee() view returns (uint24)",
        "function token0() view returns (address)",
        "function token1() view returns (address)",
        "function tickSpacing() view returns (int24)",
      ],
      provider
    );

    const [slot0, liquidity, fee, token0, token1, tickSpacing] =
      await Promise.all([
        poolContract.slot0(),
        poolContract.liquidity(),
        poolContract.fee(),
        poolContract.token0(),
        poolContract.token1(),
        poolContract.tickSpacing(),
      ]);

    console.log("Pool info:");
    console.log("- Token0:", token0);
    console.log("- Token1:", token1);
    console.log("- Fee:", fee.toString());
    console.log("- Liquidity:", liquidity.toString());
    console.log("- Current tick:", slot0[1].toString());

    return {
      sqrtPriceX96: slot0[0],
      tick: slot0[1],
      liquidity,
      fee,
      token0,
      token1,
      tickSpacing,
    };
  } catch (error) {
    console.error("Error getting pool data:", error);
    return null;
  }
}

// Build swap transaction data for V3 SwapRouter
function buildSwapTransaction(
  trade: Trade<Token, Token, TradeType>,
  walletAddress: string,
  deadline: number,
  amountOutMinimum: CurrencyAmount<Token>,
  isInputNative: boolean,
  isOutputNative: boolean
) {
  // Use the simpler exactInputSingle interface for single pool swaps
  const swapRouterInterface = new ethers.utils.Interface([
    `function exactInputSingle(
      tuple(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        address recipient,
        uint256 deadline,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96
      ) params
    ) external payable returns (uint256)`,
    `function multicall(uint256 deadline, bytes[] calldata data) external payable returns (bytes[] memory results)`,
    `function refundETH() external payable`,
    `function unwrapWETH9(uint256 amountMinimum, address recipient) external payable`,
  ]);

  const pool = trade.route.pools[0];
  let tokenIn: string;
  let tokenOut: string;
  let swapRecipient: string;
  let value: string = "0";

  // Determine input token address
  if (isInputNative) {
    tokenIn = WETH_ADDRESS; // Router will auto-wrap ETH to WETH
    value = trade.inputAmount.quotient.toString();
  } else {
    tokenIn = trade.inputAmount.currency.address;
  }

  // Determine output token address and recipient
  if (isOutputNative) {
    tokenOut = WETH_ADDRESS; // We'll unwrap WETH to ETH
    swapRecipient = "0x0000000000000000000000000000000000000000"; // Special address for router
  } else {
    tokenOut = trade.outputAmount.currency.address;
    swapRecipient = walletAddress; // Send directly to wallet
  }

  const swapParams = {
    tokenIn,
    tokenOut,
    fee: pool.fee,
    recipient: swapRecipient,
    deadline,
    amountIn: trade.inputAmount.quotient.toString(),
    amountOutMinimum: amountOutMinimum.quotient.toString(),
    sqrtPriceLimitX96: 0,
  };

  // If we need to handle native ETH input/output, use multicall
  if (isInputNative || isOutputNative) {
    const swapCalldata = swapRouterInterface.encodeFunctionData(
      "exactInputSingle",
      [swapParams]
    );
    const callsData = [swapCalldata];

    // Add unwrap call if output is native ETH
    if (isOutputNative) {
      const unwrapCalldata = swapRouterInterface.encodeFunctionData(
        "unwrapWETH9",
        [amountOutMinimum.quotient.toString(), walletAddress]
      );
      callsData.push(unwrapCalldata);
    }

    // Add refund call if input is native ETH
    if (isInputNative) {
      const refundCalldata =
        swapRouterInterface.encodeFunctionData("refundETH");
      callsData.push(refundCalldata);
    }

    const multicallData = swapRouterInterface.encodeFunctionData("multicall", [
      deadline,
      callsData,
    ]);

    return { data: multicallData, value };
  } else {
    // For ERC20 to ERC20 swaps, use simple exactInputSingle
    const calldata = swapRouterInterface.encodeFunctionData(
      "exactInputSingle",
      [swapParams]
    );
    return { data: calldata, value: "0" };
  }
}

// Ask for user confirmation
function askForConfirmation(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  try {
    console.log("🚀 Uniswap V3 Swap Script");
    console.log("=========================");

    // Detect token types
    const isInputNative = isNativeETH(FROM_TOKEN_ADDRESS);
    const isOutputNative = isNativeETH(TO_TOKEN_ADDRESS);

    console.log(`\n🔍 Token Detection:`);
    console.log(
      `- Input Token: ${FROM_TOKEN_ADDRESS} ${
        isInputNative ? "(Native ETH)" : "(ERC20)"
      }`
    );
    console.log(
      `- Output Token: ${TO_TOKEN_ADDRESS} ${
        isOutputNative ? "(Native ETH)" : "(ERC20)"
      }`
    );

    // Create token instances
    console.log("\n📋 Creating token instances...");
    const inputToken = await createToken(FROM_TOKEN_ADDRESS);
    const outputToken = await createToken(TO_TOKEN_ADDRESS);

    console.log(
      `- Input: ${inputToken.symbol} (${inputToken.decimals} decimals)`
    );
    console.log(
      `- Output: ${outputToken.symbol} (${outputToken.decimals} decimals)`
    );

    // Parse input amount
    const amountIn = CurrencyAmount.fromRawAmount(
      inputToken,
      ethers.utils.parseUnits(AMOUNT_TO_SWAP, inputToken.decimals).toString()
    );

    console.log(`\n💱 Swap Configuration:`);
    console.log(`- Swapping: ${amountIn.toExact()} ${inputToken.symbol}`);
    console.log(`- For: ${outputToken.symbol}`);
    console.log(`- Slippage: ${SLIPPAGE_TOLERANCE_PERCENT}%`);

    // Setup wallet
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    console.log(`\n💼 Wallet: ${wallet.address}`);

    // Check balance
    console.log("\n💰 Checking balances...");
    const hasEnoughBalance = await checkTokenBalance(
      isInputNative ? NATIVE_ETH_ADDRESS : FROM_TOKEN_ADDRESS,
      wallet.address,
      amountIn.quotient.toString()
    );

    if (!hasEnoughBalance) {
      return;
    }

    // Check and approve token allowance (skip for native ETH)
    if (!isInputNative) {
      await ensureTokenAllowance(
        FROM_TOKEN_ADDRESS,
        wallet.address,
        SWAP_ROUTER,
        amountIn.quotient.toString(),
        wallet
      );
    }

    // Find working pool
    console.log("\n🏊 Looking for liquidity pools...");
    const poolInfo = await findWorkingPool(inputToken, outputToken);

    if (!poolInfo) {
      console.error("❌ No working pools found!");
      return;
    }

    // Determine token order for pool
    const token0Address = poolInfo.token0.toLowerCase();
    const token1Address = poolInfo.token1.toLowerCase();

    let token0: Token, token1: Token;
    if (token0Address === inputToken.address.toLowerCase()) {
      token0 = inputToken;
      token1 = outputToken;
    } else {
      token0 = outputToken;
      token1 = inputToken;
    }

    // Create Pool instance
    const pool = new Pool(
      token0,
      token1,
      poolInfo.fee,
      poolInfo.sqrtPriceX96.toString(),
      poolInfo.liquidity.toString(),
      poolInfo.tick
    );

    console.log(`\n🏊 Pool Created:`);
    console.log(`- Fee Tier: ${pool.fee} (${pool.fee / 10000}%)`);
    console.log(`- Liquidity: ${pool.liquidity.toString()}`);

    // Calculate quote
    console.log("\n🧮 Calculating quote...");
    const outputAmount = calculateQuoteFromPool(
      pool,
      amountIn,
      inputToken,
      outputToken
    );

    // Create trade
    const route = new Route([pool], inputToken, outputToken);
    const trade = Trade.createUncheckedTrade({
      route,
      inputAmount: amountIn,
      outputAmount: outputAmount,
      tradeType: TradeType.EXACT_INPUT,
    });

    console.log(`\n📈 Trade Analysis:`);
    console.log(`- Input: ${trade.inputAmount.toExact()} ${inputToken.symbol}`);
    console.log(
      `- Output: ${trade.outputAmount.toExact()} ${outputToken.symbol}`
    );
    console.log(
      `- Execution Price: ${trade.executionPrice.toSignificant(6)} ${
        outputToken.symbol
      }/${inputToken.symbol}`
    );
    console.log(`- Price Impact: ${trade.priceImpact.toSignificant(3)}%`);

    // Slippage protection
    const slippageTolerance = new Percent(
      SLIPPAGE_TOLERANCE_PERCENT * 100,
      10_000
    );
    const amountOutMinimum = trade.minimumAmountOut(slippageTolerance);

    console.log(`\n🛡️ Slippage Protection:`);
    console.log(
      `- Minimum Output: ${amountOutMinimum.toExact()} ${outputToken.symbol}`
    );

    // Build transaction
    const deadline =
      Math.floor(Date.now() / 1000) + 60 * TRANSACTION_DEADLINE_MINUTES;
    const { data: calldata, value } = buildSwapTransaction(
      trade,
      wallet.address,
      deadline,
      amountOutMinimum,
      isInputNative,
      isOutputNative
    );

    // Estimate gas
    console.log("\n⛽ Estimating gas...");
    try {
      const gasEstimate = await provider.estimateGas({
        to: SWAP_ROUTER,
        data: calldata,
        value,
        from: wallet.address,
      });

      const gasPrice = await provider.getGasPrice();
      const gasCost = gasEstimate.mul(gasPrice);

      console.log(`- Gas Limit: ${gasEstimate.toString()}`);
      console.log(
        `- Gas Price: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`
      );
      console.log(`- Gas Cost: ${ethers.utils.formatEther(gasCost)} ETH`);

      // Final summary
      console.log(`\n🚀 Transaction Summary:`);
      console.log(`- Sending: ${amountIn.toExact()} ${inputToken.symbol}`);
      console.log(
        `- Receiving: ~${outputAmount.toExact()} ${outputToken.symbol}`
      );
      console.log(
        `- Minimum: ${amountOutMinimum.toExact()} ${outputToken.symbol}`
      );
      console.log(`- Gas Cost: ~${ethers.utils.formatEther(gasCost)} ETH`);
      console.log(`- Recipient: ${wallet.address}`);
      console.log(`- Router: ${SWAP_ROUTER}`);

      // Ask for confirmation
      const confirmation = await askForConfirmation(
        "\nDo you want to proceed with the swap? (y/n): "
      );

      if (confirmation.toLowerCase() !== "y") {
        console.log("❌ Swap cancelled by user.");
        return;
      }

      // Execute transaction
      console.log("\n⏳ Executing swap...");
      const tx = await wallet.sendTransaction({
        to: SWAP_ROUTER,
        data: calldata,
        value,
        gasLimit: gasEstimate.mul(120).div(100), // 20% buffer
      });

      console.log(`📝 Transaction sent: ${tx.hash}`);
      console.log(
        `🔗 Sepolia Etherscan: https://sepolia.etherscan.io/tx/${tx.hash}`
      );
      console.log("⏳ Waiting for confirmation...");

      const receipt = await tx.wait();
      console.log(`\n✅ Swap completed successfully!`);
      console.log(`📦 Block: ${receipt.blockNumber}`);
      console.log(`⛽ Gas Used: ${receipt.gasUsed.toString()}`);
      console.log(
        `💰 Actual Gas Cost: ${ethers.utils.formatEther(
          receipt.gasUsed.mul(receipt.effectiveGasPrice || gasPrice)
        )} ETH`
      );

      // Show final balances
      console.log("\n💰 Final Balances:");
      await checkTokenBalance(
        isInputNative ? NATIVE_ETH_ADDRESS : FROM_TOKEN_ADDRESS,
        wallet.address,
        "0"
      );
      await checkTokenBalance(
        isOutputNative ? NATIVE_ETH_ADDRESS : TO_TOKEN_ADDRESS,
        wallet.address,
        "0"
      );
    } catch (error) {
      console.error("❌ Transaction failed:", error.message);

      if (error.data) {
        console.log("Error data:", error.data);
      }
      if (error.reason) {
        console.log("Error reason:", error.reason);
      }
    }
  } catch (error) {
    console.error("❌ Error in main:", error);
  }
}

main();
