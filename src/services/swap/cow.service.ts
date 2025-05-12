import {
  OrderKind,
  SupportedChainId,
  TradeParameters,
  TradingSdk,
  OrderBookApi,
  OrderStatus,
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import { TokenService } from "../token/token.service";
import { EthereumWallet, SwapResult, TokenInfo } from "../../types";
import { CONFIG } from "../../config";

// ERC20 ABI for token approval
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
];

// CowSwap VaultRelayer address for Sepolia network
const VAULT_RELAYER_ADDRESS = "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110";

export class CowSwapService {
  private tokenService: TokenService;
  private provider: ethers.providers.JsonRpcProvider;

  constructor() {
    this.tokenService = new TokenService();
    this.provider = new ethers.providers.JsonRpcProvider(
      CONFIG.RPC_URL || "https://sepolia.drpc.org"
    );
  }

  /**
   * Find token by symbol, name, or address
   */
  private async findToken(
    tokenQuery: string,
    chainId: number
  ): Promise<TokenInfo | undefined> {
    // First try direct lookup by symbol
    let token = this.tokenService.findTokenBySymbol(tokenQuery, chainId);

    // If not found, try by address
    if (!token && ethers.utils.isAddress(tokenQuery)) {
      token = this.tokenService.findTokenByAddress(tokenQuery, chainId);
    }

    // If still not found, search in all fields
    if (!token) {
      const results = this.tokenService.searchTokens(tokenQuery, chainId);
      if (results.length > 0) {
        token = results[0];
      }
    }

    return token;
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
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        wallet
      );
      const balance = await tokenContract.balanceOf(wallet.address);

      return balance.gte(amount);
    } catch (error) {
      console.error("Error checking token balance:", error);
      return false;
    }
  }

  /**
   * Check token allowance and approve if necessary
   */
  private async checkAndApproveToken(
    wallet: ethers.Wallet,
    tokenAddress: string,
    amount: string
  ): Promise<boolean> {
    try {
      console.log(`Checking allowance for token ${tokenAddress}...`);

      // Create token contract instance
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        wallet
      );

      // Check current allowance
      const currentAllowance = await tokenContract.allowance(
        wallet.address,
        VAULT_RELAYER_ADDRESS
      );

      // If allowance is less than the amount, approve
      if (currentAllowance < amount) {
        console.log(
          `Current allowance (${currentAllowance.toString()}) is less than required (${amount})`
        );
        console.log(
          `Approving token ${tokenAddress} for ${amount} to spender ${VAULT_RELAYER_ADDRESS}...`
        );

        // Approve max uint256 to avoid frequent approvals
        const maxUint256 = ethers.constants.MaxUint256;
        const tx = await tokenContract.approve(
          VAULT_RELAYER_ADDRESS,
          maxUint256
        );

        console.log(`Approval transaction sent: ${tx.hash}`);
        await tx.wait();
        console.log("Approval confirmed!");

        return true;
      } else {
        console.log("Token already approved with sufficient allowance.");
        return true;
      }
    } catch (error) {
      console.error("Error approving token:", error);
      return false;
    }
  }

  /**
   * Monitor order execution
   */
  private async monitorOrderExecution(
    orderBookApi: OrderBookApi,
    orderId: string,
    timeout: number = 60 * 10_000 // 10 minutes default
  ): Promise<{
    status: OrderStatus;
    executedBuyAmount?: string;
    executedSellAmount?: string;
  }> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const order = await orderBookApi.getOrder(orderId);
        console.log(`Current order status: ${order.status}`);

        // Check different order statuses
        switch (order.status) {
          case OrderStatus.FULFILLED:
            console.log("✅ Order successfully executed!");
            return {
              status: OrderStatus.FULFILLED,
              executedSellAmount: order.executedSellAmount,
              executedBuyAmount: order.executedBuyAmount,
            };

          case OrderStatus.CANCELLED:
            console.log("❌ Order was cancelled.");
            return { status: OrderStatus.CANCELLED };

          case OrderStatus.EXPIRED:
            console.log("⏰ Order expired.");
            return { status: OrderStatus.EXPIRED };

          case OrderStatus.PRESIGNATURE_PENDING:
          case OrderStatus.OPEN:
            // Order still processing, continue waiting
            break;

          default:
            // Unknown status, continue monitoring
            break;
        }
      } catch (error) {
        console.error("Error checking order status:", error);
      }

      // Wait for 10 seconds before checking again
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }

    console.log("⏰ Order monitoring timed out.");
    return { status: "TIMEOUT" as any };
  }

  /**
   * Execute a swap on CoW Protocol
   */
  public async executeSwap(
    wallet: EthereumWallet,
    sellTokenQuery: string,
    buyTokenQuery: string,
    sellAmount: string,
    slippageBps: number = 50, // Default 0.5%
    chainId: SupportedChainId = SupportedChainId.SEPOLIA
  ): Promise<SwapResult> {
    try {
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

      // Create ethers wallet from private key
      const ethersWallet = new ethers.Wallet(wallet.privateKey, this.provider);

      // Convert amount to token units based on decimals
      const amountInWei = ethers.utils.parseUnits(
        sellAmount,
        sellToken.decimals
      );

      // Check if user has enough balance
      const hasBalance = await this.checkTokenBalance(
        ethersWallet,
        sellToken.address,
        amountInWei.toString()
      );

      if (!hasBalance) {
        return {
          success: false,
          message: `Insufficient balance of ${sellToken.symbol}`,
        };
      }

      // Check and approve token allowance
      const approved = await this.checkAndApproveToken(
        ethersWallet,
        sellToken.address,
        amountInWei.toString()
      );

      if (!approved) {
        return {
          success: false,
          message: `Failed to approve ${sellToken.symbol} for trading`,
        };
      }

      // Initialize the SDK
      const cowSdk = new TradingSdk({
        appCode: "garden",
        chainId,
        signer: ethersWallet,
      });

      // Define trade parameters
      const parameters: TradeParameters = {
        kind: OrderKind.SELL,
        sellToken: sellToken.address,
        sellTokenDecimals: sellToken.decimals,
        amount: amountInWei.toString(),
        buyToken: buyToken.address,
        buyTokenDecimals: buyToken.decimals,
        slippageBps,
      };

      console.log("Getting quote...");

      // Get a quote for the trade
      const { quoteResults, postSwapOrderFromQuote } = await cowSdk.getQuote(
        parameters
      );

      // Display trade details
      const formattedSellAmount = ethers.utils.formatUnits(
        parameters.amount,
        parameters.sellTokenDecimals
      );

      const buyAmount = quoteResults.amountsAndCosts.afterSlippage.buyAmount;
      const formattedBuyAmount = ethers.utils.formatUnits(
        buyAmount,
        parameters.buyTokenDecimals
      );

      console.log(
        `Submitting order to sell ${formattedSellAmount} ${sellToken.symbol} for at least ${formattedBuyAmount} ${buyToken.symbol}`
      );

      // Post the order
      const orderId = await postSwapOrderFromQuote();
      console.log("Order created, id: ", orderId);

      // Initialize OrderBook API for monitoring
      const orderBookApi = new OrderBookApi({
        chainId,
      });

      // Monitor order execution
      const orderResult = await this.monitorOrderExecution(
        orderBookApi,
        orderId
      );

      if (orderResult.status === OrderStatus.FULFILLED) {
        // Format the executed amounts
        const actualBuyAmount = orderResult.executedBuyAmount
          ? ethers.utils.formatUnits(
              orderResult.executedBuyAmount,
              buyToken.decimals
            )
          : "unknown";

        return {
          success: true,
          message: `Swap completed successfully! Received ${actualBuyAmount} ${buyToken.symbol}`,
          orderId,
          sellToken: sellToken.symbol,
          buyToken: buyToken.symbol,
          sellAmount: formattedSellAmount,
          expectedBuyAmount: formattedBuyAmount,
          actualBuyAmount,
        };
      } else if (orderResult.status === OrderStatus.CANCELLED) {
        return {
          success: false,
          message: "Order was cancelled",
          orderId,
        };
      } else if (orderResult.status === OrderStatus.EXPIRED) {
        return {
          success: false,
          message: "Order expired",
          orderId,
        };
      } else {
        return {
          success: false,
          message: `Order monitoring timed out or failed. Status: ${orderResult.status}`,
          orderId,
        };
      }
    } catch (error) {
      console.error("Error executing swap:", error);
      return {
        success: false,
        message: "Error executing swap",
        error,
      };
    }
  }
}

export const cowSwapService = new CowSwapService();
