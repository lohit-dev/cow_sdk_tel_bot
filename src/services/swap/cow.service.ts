import {
  OrderKind,
  SupportedChainId,
  TradeParameters,
  TradingSdk,
  OrderBookApi,
  OrderStatus,
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import { EthereumWallet, SwapResult, TokenInfo } from "../../types";
import { CONFIG } from "../../config";
import { tokenService } from "../token/token.service";

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
  private provider: ethers.providers.JsonRpcProvider;

  constructor() {
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
    let token = tokenService.findTokenBySymbol(tokenQuery, chainId);

    // If not found, try by address
    if (!token && ethers.utils.isAddress(tokenQuery)) {
      token = tokenService.findTokenByAddress(tokenQuery, chainId);
    }

    // If still not found, search in all fields
    if (!token) {
      const results = tokenService.searchTokens(tokenQuery, chainId);
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
  ): Promise<{ approved: boolean; txHash?: string }> {
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

      // If allowance is less than the amount, approve with unlimited amount
      if (currentAllowance.lt(amount)) {
        console.log(
          `Current allowance (${currentAllowance.toString()}) is less than required (${amount})`
        );
        console.log(
          `Approving token ${tokenAddress} for unlimited amount to spender ${VAULT_RELAYER_ADDRESS}...`
        );

        // Approve max uint256 for unlimited allowance
        const maxUint256 = ethers.constants.MaxUint256;
        const tx = await tokenContract.approve(
          VAULT_RELAYER_ADDRESS,
          maxUint256
        );

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
   * Get a quote from CoW Protocol without executing the swap
   */
  async getQuote(
    wallet: EthereumWallet,
    sellTokenQuery: string,
    buyTokenQuery: string,
    sellAmount: string,
    slippageBps: number = 50, // Default 0.5%
    chainId: SupportedChainId = SupportedChainId.SEPOLIA
  ): Promise<{
    success: boolean;
    buyAmount?: string;
    sellAmount?: string;
    buyToken?: string;
    sellToken?: string;
    message?: string;
  }> {
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
      const { approved, txHash } = await this.checkAndApproveToken(
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

      try {
        // Get a quote for the trade
        const { quoteResults } = await cowSdk.getQuote(parameters);

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

        return {
          success: true,
          buyAmount: formattedBuyAmount,
          sellAmount: formattedSellAmount,
          buyToken: buyToken.symbol,
          sellToken: sellToken.symbol,
        };
      } catch (error: any) {
        console.error("Error getting CoW quote:", error);
        return {
          success: false,
          message: `Error getting quote: ${error.message || "Unknown error"}`,
        };
      }
    } catch (error: any) {
      console.error("Error getting CoW quote:", error);
      return {
        success: false,
        message: `Error getting quote: ${error.message || "Unknown error"}`,
      };
    }
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
    chainId: SupportedChainId = SupportedChainId.SEPOLIA,
    onOrderCreated?: (orderId: string, chainId: number) => Promise<void> // Callback for order creation
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
      const { approved, txHash } = await this.checkAndApproveToken(
        ethersWallet,
        sellToken.address,
        amountInWei.toString()
      );

      if (!approved) {
        return {
          success: false,
          message: `Failed to approve ${sellToken.symbol} for trading`,
          txHash,
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

      try {
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

        // Call the callback if provided to notify about order creation
        if (onOrderCreated) {
          await onOrderCreated(orderId, chainId);
        }

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
      } catch (error: any) {
        console.error("Error executing swap:", error);

        // Handle CoW Protocol specific errors
        if (error.body) {
          const errorBody = error.body;

          if (errorBody.errorType === "SellAmountDoesNotCoverFee") {
            const feeHex = errorBody.data?.fee_amount;
            let feeMessage = "";

            if (feeHex) {
              try {
                const feeAmount = ethers.BigNumber.from(feeHex);
                const formattedFee = ethers.utils.formatUnits(
                  feeAmount,
                  sellToken.decimals
                );
                feeMessage = ` Minimum required: ${formattedFee} ${sellToken.symbol}`;
              } catch (e) {
                console.error("Error formatting fee amount:", e);
              }
            }

            return {
              success: false,
              message: `The sell amount is too small to cover the transaction fee.${feeMessage} Please try a larger amount.`,
              errorType: errorBody.errorType,
            };
          } else if (errorBody.errorType === "InsufficientLiquidity") {
            return {
              success: false,
              message:
                "There is not enough liquidity for this trade. Try a smaller amount or different tokens.",
              errorType: errorBody.errorType,
            };
          } else if (errorBody.errorType) {
            return {
              success: false,
              message: `${errorBody.description || errorBody.errorType}`,
              errorType: errorBody.errorType,
            };
          }
        }

        return {
          success: false,
          message: `Error executing swap: ${error.message || "Unknown error"}`,
        };
      }
    } catch (error: any) {
      console.error("Error in swap preparation:", error);
      return {
        success: false,
        message: `Error preparing swap: ${error.message || "Unknown error"}`,
      };
    }
  }
}

export const cowSwapService = new CowSwapService();
