import { Bot, InlineKeyboard } from "grammy";
import { UniswapService } from "../services/swap/uni.service";
import { WalletService } from "../services/telegram/wallet.service";
import { TokenService } from "../services/token/token.service";
import { BlockchainType, EthereumWallet } from "../types";
import { BotContext } from "../services/telegram/telegram.service";
import logger from "../utils/logger";

// Simple session clearing helper
const clearUniSession = (ctx: BotContext) => {
  ctx.session.uniSwap = {
    step: undefined,
    wallet: undefined,
    sellToken: undefined,
    buyToken: undefined,
    amount: undefined,
    chainId: undefined,
  };
};

export function setupUniHandler(
  bot: Bot<BotContext>,
  walletService: WalletService
) {
  const uniswapService = new UniswapService();
  const tokenService = new TokenService();

  // Initialize session if needed
  bot.use((ctx, next) => {
    if (!ctx.session.uniSwap) {
      clearUniSession(ctx);
    }
    return next();
  });

  // Handle /uni command to start the Uniswap flow
  bot.command("uni", async (ctx) => {
    try {
      // Clear any existing uni session
      clearUniSession(ctx);

      // Get user ID
      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply("Could not identify your user ID. Please try again.");
        return;
      }

      // Get the user's Ethereum wallets
      const wallet1 = await walletService.getUserWallet(
        userId,
        BlockchainType.ETHEREUM,
        0
      );

      const wallet2 = await walletService.getUserWallet(
        userId,
        BlockchainType.ETHEREUM,
        1
      );

      // Format wallet addresses for display
      const w1Address = await walletService.formatAddress(
        wallet1.address,
        BlockchainType.ETHEREUM
      );
      const w2Address = await walletService.formatAddress(
        wallet2.address,
        BlockchainType.ETHEREUM
      );

      // Prompt user to select a wallet
      await ctx.reply("Select a wallet for your Uniswap trade:", {
        reply_markup: new InlineKeyboard()
          .text(`Wallet 1: ${w1Address}`, "uni_wallet_0")
          .row()
          .text(`Wallet 2: ${w2Address}`, "uni_wallet_1")
          .row()
          .text("Cancel", "uni_cancel"),
      });

      logger.info("Uniswap wallet selection presented to user:", userId);
    } catch (error) {
      console.error("Error in /uni command:", error);
      await ctx.reply("Failed to start Uniswap flow. Please try again later.");
    }
  });

  // Handle wallet selection
  bot.callbackQuery(/uni_wallet_(\d+)/, async (ctx) => {
    try {
      // Get wallet index from callback data
      const walletIndex = parseInt(ctx.match?.[1] || "0");

      // Acknowledge the callback query
      await ctx.answerCallbackQuery();

      // Get user ID
      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply("Could not identify your user ID. Please try again.");
        return;
      }

      // Get the selected wallet
      const wallet = await walletService.getUserWallet(
        userId,
        BlockchainType.ETHEREUM,
        walletIndex
      );

      // Store wallet in session
      if (!ctx.session.uniSwap) {
        clearUniSession(ctx);
      }
      ctx.session.uniSwap!.wallet = wallet;
      ctx.session.uniSwap!.step = "select_chain";

      // Prompt for chain selection
      await ctx.editMessageText("Select a blockchain network:", {
        reply_markup: new InlineKeyboard()
          .text("Ethereum Mainnet", "uni_chain_1")
          .row()
          .text("Sepolia Testnet", "uni_chain_11155111")
          .row()
          .text("Cancel", "uni_cancel"),
      });

      logger.info("Uniswap chain selection presented to user:", userId);
    } catch (error) {
      console.error("Error in wallet selection:", error);
      await ctx.reply("Failed to select wallet. Please try again.");
      clearUniSession(ctx);
    }
  });

  // Handle chain selection
  bot.callbackQuery(/uni_chain_(\d+)/, async (ctx) => {
    try {
      // Get chain ID from callback data
      const chainId = parseInt(ctx.match?.[1] || "0");

      // Acknowledge the callback query
      await ctx.answerCallbackQuery();

      // Store chain ID in session
      ctx.session.uniSwap!.chainId = chainId;
      ctx.session.uniSwap!.step = "enter_sell_token";

      // Prompt for sell token
      await ctx.editMessageText(
        "Enter the token you want to sell (symbol, name, or address):",
        {
          reply_markup: new InlineKeyboard().text("Cancel", "uni_cancel"),
        }
      );

      logger.info("Uniswap sell token prompt presented to user:", ctx.from?.id);
    } catch (error) {
      console.error("Error in chain selection:", error);
      await ctx.reply("Failed to select chain. Please try again.");
      clearUniSession(ctx);
    }
  });

  // Handle all text messages with a single handler
  bot.on("message:text", async (ctx) => {
    // Check which step we're in and process accordingly
    const step = ctx.session.uniSwap?.step;

    // If not in any Uniswap step, ignore the message
    if (!step) {
      return;
    }

    console.log(`Processing message:text in step: ${step}`);

    // Handle sell token input
    if (step === "enter_sell_token") {
      try {
        const sellTokenQuery = ctx.message.text.trim();
        const chainId = ctx.session.uniSwap!.chainId;

        if (!chainId) {
          await ctx.reply("Chain ID not found. Please start again with /uni");
          clearUniSession(ctx);
          return;
        }

        // Search for the token
        const sellToken = await uniswapService.findToken(
          sellTokenQuery,
          chainId
        );

        if (!sellToken) {
          await ctx.reply(
            `Token "${sellTokenQuery}" not found. Please try again with a different symbol, name, or address.`,
            {
              reply_markup: new InlineKeyboard().text("Cancel", "uni_cancel"),
            }
          );
          return;
        }

        // Store token in session
        ctx.session.uniSwap!.sellToken = sellToken;
        ctx.session.uniSwap!.step = "enter_buy_token";

        // Prompt for buy token
        await ctx.reply(
          `Selected sell token: ${sellToken.symbol} (${sellToken.name})`
        );
        await ctx.reply(
          "Now enter the token you want to buy (symbol, name, or address):",
          {
            reply_markup: new InlineKeyboard().text("Cancel", "uni_cancel"),
          }
        );

        logger.info(
          "Uniswap buy token prompt presented to user:",
          ctx.from?.id
        );
      } catch (error) {
        console.error("Error processing sell token:", error);
        await ctx.reply("Failed to process token. Please try again.");
      }
    }
    // Handle buy token input
    else if (step === "enter_buy_token") {
      try {
        const buyTokenQuery = ctx.message.text.trim();
        const chainId = ctx.session.uniSwap!.chainId;
        const sellToken = ctx.session.uniSwap!.sellToken;

        if (!chainId || !sellToken) {
          await ctx.reply("Missing information. Please start again with /uni");
          clearUniSession(ctx);
          return;
        }

        // Search for the token
        const buyToken = await uniswapService.findToken(buyTokenQuery, chainId);

        if (!buyToken) {
          await ctx.reply(
            `Token "${buyTokenQuery}" not found. Please try again with a different symbol, name, or address.`,
            {
              reply_markup: new InlineKeyboard().text("Cancel", "uni_cancel"),
            }
          );
          return;
        }

        // Check if buying the same token
        if (
          buyToken.address.toLowerCase() === sellToken.address.toLowerCase()
        ) {
          await ctx.reply(
            "You cannot swap a token for itself. Please choose a different token to buy.",
            {
              reply_markup: new InlineKeyboard().text("Cancel", "uni_cancel"),
            }
          );
          return;
        }

        // Store token in session
        ctx.session.uniSwap!.buyToken = buyToken;
        ctx.session.uniSwap!.step = "enter_amount";

        // Prompt for amount
        await ctx.reply(
          `Selected buy token: ${buyToken.symbol} (${buyToken.name})`
        );
        await ctx.reply(
          `How much ${sellToken.symbol} do you want to swap? Enter the amount:`,
          {
            reply_markup: new InlineKeyboard().text("Cancel", "uni_cancel"),
          }
        );

        logger.info("Uniswap amount prompt presented to user:", ctx.from?.id);
      } catch (error) {
        console.error("Error processing buy token:", error);
        await ctx.reply("Failed to process token. Please try again.");
      }
    }
    // Handle amount input
    else if (step === "enter_amount") {
      try {
        const amountText = ctx.message.text.trim();
        const amount = parseFloat(amountText);

        // Validate amount
        if (isNaN(amount) || amount <= 0) {
          await ctx.reply(
            "Please enter a valid positive number for the amount.",
            {
              reply_markup: new InlineKeyboard().text("Cancel", "uni_cancel"),
            }
          );
          return;
        }

        // Store amount in session
        ctx.session.uniSwap!.amount = amountText;

        // Get tokens from session
        const sellToken = ctx.session.uniSwap!.sellToken!;
        const buyToken = ctx.session.uniSwap!.buyToken!;
        const wallet = ctx.session.uniSwap!.wallet! as EthereumWallet;
        const chainId = ctx.session.uniSwap!.chainId!;

        // Format confirmation message
        const networkName =
          chainId === 1 ? "Ethereum Mainnet" : "Sepolia Testnet";
        const message = `Please confirm your swap:\n\nNetwork: ${networkName}\nWallet: ${wallet.address.substring(
          0,
          6
        )}...${wallet.address.substring(38)}\n\nSell: ${amountText} ${
          sellToken.symbol
        }\nBuy: ${buyToken.symbol}\n\nDo you want to proceed?`;

        // Show confirmation buttons
        await ctx.reply(message, {
          reply_markup: new InlineKeyboard()
            .text("Confirm", "uni_confirm")
            .row()
            .text("Cancel", "uni_cancel"),
        });

        logger.info(
          "Uniswap swap confirmation presented to user:",
          ctx.from?.id
        );
      } catch (error) {
        console.error("Error processing amount:", error);
        await ctx.reply("Failed to process amount. Please try again.");
      }
    }
  });

  // Handle swap confirmation
  bot.callbackQuery("uni_confirm", async (ctx) => {
    try {
      // Acknowledge the callback query
      await ctx.answerCallbackQuery();

      // Get all required data from session
      const wallet = ctx.session.uniSwap!.wallet! as EthereumWallet;
      const sellToken = ctx.session.uniSwap!.sellToken!;
      const buyToken = ctx.session.uniSwap!.buyToken!;
      const amount = ctx.session.uniSwap!.amount!;
      const chainId = ctx.session.uniSwap!.chainId!;

      if (!wallet || !sellToken || !buyToken || !amount || !chainId) {
        await ctx.reply("Missing information. Please start again with /uni");
        clearUniSession(ctx);
        return;
      }

      // Create a status message
      const statusMsg = await ctx.reply("Processing your swap on Uniswap...");

      // Create a callback function to notify the user when the transaction is sent
      const onOrderCreated = async (txHash: string, orderChainId: number) => {
        try {
          // Get the network name
          const networkName =
            orderChainId === 1 ? "Ethereum Mainnet" : "Sepolia Testnet";

          // Generate the Etherscan link
          const explorerLink = `https://${
            orderChainId === 1 ? "" : "sepolia."
          }etherscan.io/tx/${txHash}`;

          // Send a notification to the user
          await ctx.reply(
            `🔔 Your Uniswap transaction has been submitted!\n\nNetwork: ${networkName}\nTransaction: ${txHash}\n\nView on Etherscan: ${explorerLink}`,
            { parse_mode: "Markdown" }
          );
        } catch (error) {
          console.error("Error sending transaction notification:", error);
        }
      };

      // Execute the swap
      const result = await uniswapService.executeSwap(
        wallet,
        sellToken.address,
        buyToken.address,
        amount,
        300, // 3% slippage (300 basis points)
        chainId,
        onOrderCreated
      );

      if (result.success) {
        // Format success message
        let successMessage = `✅ *Swap Initiated on Uniswap*\n\n`;

        // Show transaction hash
        successMessage += `Transaction: \`${result.txHash}\`\n\n`;
        successMessage += `Selling: ${amount} ${result.sellToken}\n`;
        successMessage += `Buying: ~${result.expectedBuyAmount} ${result.buyToken}\n\n`;

        // Add Etherscan link
        const networkPrefix = chainId === 1 ? "" : "sepolia.";
        successMessage += `[View on Etherscan](https://${networkPrefix}etherscan.io/tx/${result.txHash})`;

        await ctx.reply(successMessage, {
          parse_mode: "Markdown",
        });
      } else {
        // Format error message
        let errorMessage = `❌ *Swap Failed on Uniswap*\n\n`;
        errorMessage += `Error: ${result.message}\n\n`;

        if (result.approvalTxHash) {
          // If there was an approval transaction, show it
          const networkPrefix = chainId === 1 ? "" : "sepolia.";
          errorMessage += `Note: Token approval was processed in [this transaction](https://${networkPrefix}etherscan.io/tx/${result.approvalTxHash}).\n\n`;
        }

        errorMessage += `Please try again or contact support if the issue persists.`;

        await ctx.api.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          errorMessage,
          { parse_mode: "Markdown" }
        );
      }

      // Clear the session
      clearUniSession(ctx);
    } catch (error) {
      console.error("Error executing swap:", error);
      await ctx.reply(
        `Failed to execute swap: ${(error as Error).message || "Unknown error"}`
      );
      clearUniSession(ctx);
    }
  });

  // Handle cancellation
  bot.callbackQuery("uni_cancel", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Uniswap operation cancelled.");
    clearUniSession(ctx);
  });
}

export const setupUniHandlers = setupUniHandler;
