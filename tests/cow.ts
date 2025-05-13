import {
  OrderKind,
  SupportedChainId,
  TradeParameters,
  TradingSdk,
  OrderBookApi,
  OrderStatus,
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import * as readline from "readline";
// ERC20 ABI for token approval
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

// CowSwap VaultRelayer address for Sepolia network
const VAULT_RELAYER_ADDRESS = "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110";

// Create a readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function promptUser(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Wait and monitor the order status
 */
async function monitorOrderExecution(
  orderBookApi: OrderBookApi,
  orderId: string,
  timeout: number = 60 * 10_000 // 10 minutes default
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const order = await orderBookApi.getOrder(orderId);

      console.log(`Current order status: ${order.status}`);

      // Check different order statuses
      switch (order.status) {
        case OrderStatus.FULFILLED:
          console.log("✅ Order successfully executed!");
          console.log(`Executed Sell Amount: ${order.executedSellAmount}`);
          console.log(`Executed Buy Amount: ${order.executedBuyAmount}`);
          return;

        case OrderStatus.CANCELLED:
          console.log("❌ Order was cancelled.");
          return;

        case OrderStatus.EXPIRED:
          console.log("⏰ Order expired.");
          return;
      }
    } catch (error) {
      console.error("Error checking order status:", error);
    }

    // Wait for 30 seconds before checking again
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  console.log("⏰ Order monitoring timed out.");
}

async function main() {
  try {
    console.log("Starting CowSwap comprehensive swap script...");
    const provider = new ethers.providers.JsonRpcProvider(
      "https://sepolia.drpc.org"
    );

    const privateKey: string = process.env.MY_PRIVATE_KEY || "";
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log(`Using wallet address: ${wallet.address}`);

    // Initialize the SDK
    const cowSdk = new TradingSdk({
      appCode: "garden",
      chainId: SupportedChainId.SEPOLIA,
      signer: wallet,
    });

    // Define trade parameters
    const amount = 0.01 * 1e8;

    const parameters: TradeParameters = {
      kind: OrderKind.SELL,
      sellToken: "0x29f2D40B0605204364af54EC677bD022dA425d03",
      sellTokenDecimals: 8,
      amount: amount.toString(),
      buyToken: "0x58eb19ef91e8a6327fed391b51ae1887b833cc91",
      buyTokenDecimals: 6,
      slippageBps: 50,
    };

    console.log("Getting quote...");

    // Get a quote for the trade
    const { quoteResults, postSwapOrderFromQuote } = await cowSdk.getQuote(
      parameters
    );

    // Display trade details
    console.log("Quote received:");
    console.log(`Sell token: ${parameters.sellToken}`);
    console.log(`Buy token: ${parameters.buyToken}`);
    console.log(
      `You will spend: ${ethers.utils.formatUnits(
        parameters.amount,
        parameters.sellTokenDecimals
      )}`
    );

    const buyAmount = quoteResults.amountsAndCosts.afterSlippage.buyAmount;
    console.log(
      `You will get at least: ${ethers.utils.formatUnits(
        buyAmount,
        parameters.buyTokenDecimals
      )}`
    );

    // Ask for confirmation
    const confirmation = await promptUser("Proceed with the swap? (yes/no): ");

    if (confirmation.toLowerCase() === "yes") {
      console.log("Submitting order...");

      // Check and approve token allowance before submitting the order
      await checkAndApproveToken(
        wallet,
        parameters.sellToken,
        VAULT_RELAYER_ADDRESS,
        parameters.amount
      );

      // Post the order
      const orderId = await postSwapOrderFromQuote();
      console.log("Order created, id: ", orderId);

      // Initialize OrderBook API for monitoring
      const orderBookApi = new OrderBookApi({
        chainId: SupportedChainId.SEPOLIA,
      });

      // Monitor order execution
      await monitorOrderExecution(orderBookApi, orderId);

      // Optionally, get final order details
      const finalOrder = await orderBookApi.getOrder(orderId);
      console.log("Final Order Details: ", finalOrder);
    } else {
      console.log("Swap cancelled.");
    }
  } catch (error) {
    console.error("Error executing swap:", error);
  } finally {
    rl.close();
  }
}

/**
 * Check token allowance and approve if necessary
 */
async function checkAndApproveToken(
  wallet: ethers.Wallet,
  tokenAddress: string,
  spenderAddress: string,
  amount: string
) {
  try {
    console.log(`Checking allowance for token ${tokenAddress}...`);

    // Create token contract instance
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

    // Check current allowance
    const currentAllowance = await tokenContract.allowance(
      wallet.address,
      spenderAddress
    );

    // If allowance is less than the amount, approve
    if (currentAllowance.lt(amount)) {
      console.log(
        `Current allowance (${currentAllowance.toString()}) is less than required (${amount})`
      );
      console.log(
        `Approving ${tokenAddress} to be spent by ${spenderAddress}...`
      );

      // Approve max uint256 to avoid frequent approvals
      const maxUint256 = ethers.constants.MaxUint256;
      const tx = await tokenContract.approve(spenderAddress, maxUint256);

      console.log(`Approval transaction sent: ${tx.hash}`);
      await tx.wait();
      console.log("Approval confirmed!");
    } else {
      console.log("Token already has sufficient allowance.");
    }
  } catch (error) {
    console.error("Error approving token:", error);
    throw error;
  }
}

// Execute the main function
main().catch(console.error);
