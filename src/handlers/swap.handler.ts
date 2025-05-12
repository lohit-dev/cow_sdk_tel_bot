import { Bot, Context, InlineKeyboard, SessionFlavor } from "grammy";
import { CowSwapService } from "../services/swap/cow.service";
import { WalletService } from "../services/telegram/wallet.service";
import {
  BlockchainType,
  SwapSession,
  SwapResult,
  EthereumWallet,
} from "../types";
import { SupportedChainId } from "@cowprotocol/cow-sdk";
import { TokenService } from "../services/token/token.service";

// Type for context with session
type SwapContext = Context & SessionFlavor<SwapSession>;

// Map chain names to CoW Protocol chain IDs
const chainIdMap: Record<string, SupportedChainId> = {
  sepolia: SupportedChainId.SEPOLIA,
  ethereum: SupportedChainId.MAINNET,
  gnosis: SupportedChainId.GNOSIS_CHAIN,
  arbitrum: SupportedChainId.ARBITRUM_ONE,
  base: SupportedChainId.BASE,
};

export function setupSwapHandlers(
  bot: Bot<SwapContext>,
  walletService: WalletService
) {
  const cowSwapService = new CowSwapService();
  const tokenService = new TokenService();

  // Command to start a swap
  bot.command("swap", async (ctx) => {
    clearSwapSession(ctx);

    await ctx.reply(
      "Welcome to the swap feature! You can swap tokens using CoW Protocol.\n\n" +
        "First, select the chain you want to use:",
      {
        reply_markup: new InlineKeyboard()
          .text("Ethereum", "swap_select_chain_ethereum")
          .text("Gnosis Chain", "swap_select_chain_gnosis")
          .row()
          .text("Sepolia (Testnet)", "swap_select_chain_sepolia")
          .row()
          .text("Arbitrum", "swap_select_chain_arbitrum")
          .text("Base", "swap_select_chain_base"),
      }
    );
  });

  // Handle chain selection
  bot.callbackQuery(/swap_select_chain_(.+)/, async (ctx) => {
    const chainName = ctx.match?.[1];
    if (!chainName) return;

    // Check if the chain is supported
    const chainId = chainIdMap[chainName];
    if (!chainId) {
      await ctx.answerCallbackQuery({
        text: `${chainName} is not supported by CoW Protocol yet.`,
        show_alert: true,
      });
      return;
    }

    // Acknowledge the callback query
    await ctx.answerCallbackQuery();

    // Store the selected chain in session
    ctx.session.selectedChain = chainName;
    ctx.session.selectedChainId = chainId;

    // Ask user to select buy or sell
    await ctx.editMessageText(
      `You selected ${chainName}. What would you like to do?`,
      {
        reply_markup: new InlineKeyboard()
          .text("Buy", "swap_action_buy")
          .text("Sell", "swap_action_sell"),
      }
    );
  });

  // Handle buy/sell action selection
  bot.callbackQuery(/swap_action_(buy|sell)/, async (ctx) => {
    const action = ctx.match?.[1];
    if (!action) return;

    // Acknowledge the callback query
    await ctx.answerCallbackQuery();

    // Store the selected action in session
    ctx.session.swapAction = action;

    // Ask for the amount
    await ctx.editMessageText(
      `You selected to ${action}. Please enter the amount you want to ${action}:\n` +
        "Example: `0.1`",
      { parse_mode: "Markdown" }
    );

    // Set the next step to handle amount input
    ctx.session.swapStep = "enter_amount";
  });

  // Handle amount input
  bot.on("message:text", async (ctx) => {
    // Skip if not in a swap flow
    if (!ctx.session.swapStep) return;

    const step = ctx.session.swapStep;
    const chainId = ctx.session.selectedChainId;
    const action = ctx.session.swapAction;

    if (!chainId || !action) {
      await ctx.reply("Please start the swap process again with /swap");
      clearSwapSession(ctx);
      return;
    }

    // Handle amount input
    if (step === "enter_amount") {
      const amount = ctx.message.text.trim();

      // Validate amount
      if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        await ctx.reply("Please enter a valid amount greater than 0.");
        return;
      }

      // Store the amount in session
      ctx.session.amount = amount;

      // Ask for the token based on the action (buy or sell)
      const promptMessage =
        action === "buy"
          ? "Now enter the token you want to buy (symbol, name, or address):"
          : "Now enter the token you want to sell (symbol, name, or address):";

      await ctx.reply(promptMessage);

      // Set the next step to handle token input
      ctx.session.swapStep =
        action === "buy" ? "enter_buy_token" : "enter_sell_token";
    }
    // Handle sell token input
    else if (step === "enter_sell_token") {
      const tokenQuery = ctx.message.text.trim();

      // Search for the token
      const tokens = tokenService.searchTokens(tokenQuery, chainId);

      if (tokens.length === 0) {
        await ctx.reply(
          `Token "${tokenQuery}" not found. Please try another token.`
        );
        return;
      }

      // If multiple tokens found, let the user select one
      if (tokens.length > 1) {
        const keyboard = new InlineKeyboard();

        tokens.slice(0, 5).forEach((token) => {
          keyboard.text(
            `${token.symbol} (${token.name})`,
            `swap_select_sell_token_${token.address}`
          );
          keyboard.row();
        });

        await ctx.reply(
          `Multiple tokens found for "${tokenQuery}". Please select one:`,
          { reply_markup: keyboard }
        );
        return;
      }

      // If only one token found, use it directly
      const token = tokens[0];
      ctx.session.sellToken = token;

      await ctx.reply(
        `You selected ${token.symbol} (${token.name}) as the token to sell.\n\n` +
          `Now enter the token you want to buy (symbol, name, or address):`
      );

      ctx.session.swapStep = "enter_buy_token";
    }
    // Handle buy token input
    else if (step === "enter_buy_token") {
      const tokenQuery = ctx.message.text.trim();
      const sellToken = ctx.session.sellToken;

      // For buy-first flow, we don't have a sell token yet
      if (ctx.session.swapAction === "buy" && !sellToken) {
        // Search for the token
        const tokens = tokenService.searchTokens(tokenQuery, chainId);

        if (tokens.length === 0) {
          await ctx.reply(
            `Token "${tokenQuery}" not found. Please try another token.`
          );
          return;
        }

        // If multiple tokens found, let the user select one
        if (tokens.length > 1) {
          const keyboard = new InlineKeyboard();

          tokens.slice(0, 5).forEach((token) => {
            keyboard.text(
              `${token.symbol} (${token.name})`,
              `swap_select_buy_token_${token.address}`
            );
            keyboard.row();
          });

          await ctx.reply(
            `Multiple tokens found for "${tokenQuery}". Please select one:`,
            { reply_markup: keyboard }
          );
          return;
        }

        // If only one token found, use it directly
        const token = tokens[0];
        ctx.session.buyToken = token;

        await ctx.reply(
          `You selected ${token.symbol} (${token.name}) as the token to buy.\n\n` +
            `Now enter the token you want to sell (symbol, name, or address):`
        );

        ctx.session.swapStep = "enter_sell_token";
        return;
      }

      // For sell-first flow, continue with normal buy token selection
      if (!sellToken) {
        await ctx.reply("Please start the swap process again with /swap");
        clearSwapSession(ctx);
        return;
      }

      // Search for the token
      const tokens = tokenService.searchTokens(tokenQuery, chainId);

      if (tokens.length === 0) {
        await ctx.reply(
          `Token "${tokenQuery}" not found. Please try another token.`
        );
        return;
      }

      // If multiple tokens found, let the user select one
      if (tokens.length > 1) {
        const keyboard = new InlineKeyboard();

        let hasOptions = false;
        tokens.slice(0, 5).forEach((token) => {
          // Don't show the sell token as an option
          if (token.address.toLowerCase() !== sellToken.address.toLowerCase()) {
            keyboard.text(
              `${token.symbol} (${token.name})`,
              `swap_select_buy_token_${token.address}`
            );
            keyboard.row();
            hasOptions = true;
          }
        });

        if (!hasOptions) {
          await ctx.reply(
            "All found tokens match your sell token. Please try a different search term."
          );
          return;
        }

        await ctx.reply(
          `Multiple tokens found for "${tokenQuery}". Please select one:`,
          { reply_markup: keyboard }
        );
        return;
      }

      // If only one token found, use it directly
      const token = tokens[0];

      // Check if the buy token is the same as the sell token
      if (token.address.toLowerCase() === sellToken.address.toLowerCase()) {
        await ctx.reply(
          "You cannot swap a token for itself. Please select a different token."
        );
        return;
      }

      ctx.session.buyToken = token;

      // Get user's wallet
      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply("Could not identify your user ID. Please try again.");
        return;
      }

      // Get user's wallet
      try {
        // Explicitly get an Ethereum wallet
        const wallet = (await walletService.getUserWallet(
          userId,
          BlockchainType.ETHEREUM
        )) as EthereumWallet;

        if (!wallet || !wallet.address) {
          await ctx.reply(
            "Could not find your Ethereum wallet. Please create one first using /wallet command."
          );
          clearSwapSession(ctx);
          return;
        }

        // Store wallet in session
        ctx.session.wallet = wallet;

        // Use the amount from the session
        const amount = ctx.session.amount;
        if (!amount) {
          await ctx.reply("Amount is missing. Please start again with /swap");
          clearSwapSession(ctx);
          return;
        }

        // For buy-first flow, we store the amount as buyAmount
        // For sell-first flow, we store it as sellAmount
        if (ctx.session.swapAction === "buy") {
          ctx.session.buyAmount = amount;
        } else {
          ctx.session.sellAmount = amount;
        }

        // Show confirmation
        const keyboard = new InlineKeyboard()
          .text("Confirm Swap", "swap_confirm")
          .text("Cancel", "swap_cancel");

        const summaryText =
          ctx.session.swapAction === "buy"
            ? `Swap Summary:\n\n` +
              `Buy: ${amount} ${token.symbol}\n` +
              `Sell: ${sellToken.symbol}\n` +
              `Wallet: ${
                wallet.address
                  ? await walletService.formatAddress(
                      wallet.address,
                      BlockchainType.ETHEREUM
                    )
                  : "Unknown"
              }\n\n` +
              `Do you want to proceed with this swap?`
            : `Swap Summary:\n\n` +
              `Sell: ${amount} ${sellToken.symbol}\n` +
              `Buy: ${token.symbol}\n` +
              `Wallet: ${
                wallet.address
                  ? await walletService.formatAddress(
                      wallet.address,
                      BlockchainType.ETHEREUM
                    )
                  : "Unknown"
              }\n\n` +
              `Do you want to proceed with this swap?`;

        await ctx.reply(summaryText, { reply_markup: keyboard });

        // Clear the swap step
        ctx.session.swapStep = undefined;
      } catch (error) {
        console.error("Error getting wallet:", error);
        await ctx.reply(
          "Failed to get your wallet. Please make sure you have created a wallet using /wallet command."
        );
        clearSwapSession(ctx);
      }
    }
  });

  // Handle sell token selection from multiple options
  bot.callbackQuery(/swap_select_sell_token_(.+)/, async (ctx) => {
    const tokenAddress = ctx.match?.[1];
    const chainId = ctx.session.selectedChainId;

    if (!tokenAddress || !chainId) {
      await ctx.answerCallbackQuery({
        text: "Missing information. Please start again.",
        show_alert: true,
      });
      return;
    }

    // Acknowledge the callback query
    await ctx.answerCallbackQuery();

    // Find the token
    const token = tokenService.findTokenByAddress(tokenAddress, chainId);

    if (!token) {
      await ctx.editMessageText(
        "Token not found. Please start again with /swap"
      );
      return;
    }

    // Store the token in session
    ctx.session.sellToken = token;

    // If we already have a buy token (from buy-first flow), go to wallet selection
    if (ctx.session.buyToken) {
      const buyToken = ctx.session.buyToken;

      // Check if the buy token is the same as the sell token
      if (token.address.toLowerCase() === buyToken.address.toLowerCase()) {
        await ctx.editMessageText(
          "You cannot swap a token for itself. Please start again with /swap"
        );
        return;
      }

      // Get user's wallet
      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.editMessageText(
          "Could not identify your user ID. Please try again with /swap"
        );
        return;
      }

      try {
        // Explicitly get an Ethereum wallet
        const wallet = (await walletService.getUserWallet(
          userId,
          BlockchainType.ETHEREUM
        )) as EthereumWallet;

        if (!wallet || !wallet.address) {
          await ctx.editMessageText(
            "Could not find your Ethereum wallet. Please create one first using /wallet command."
          );
          clearSwapSession(ctx);
          return;
        }

        // Store wallet in session
        ctx.session.wallet = wallet;

        // Use the amount from the session
        const amount = ctx.session.amount;
        if (!amount) {
          await ctx.editMessageText(
            "Amount is missing. Please start again with /swap"
          );
          clearSwapSession(ctx);
          return;
        }

        // For buy-first flow, we store the amount as buyAmount
        if (ctx.session.swapAction === "buy") {
          ctx.session.buyAmount = amount;
        } else {
          ctx.session.sellAmount = amount;
        }

        // Show confirmation
        const keyboard = new InlineKeyboard()
          .text("Confirm Swap", "swap_confirm")
          .text("Cancel", "swap_cancel");

        const summaryText =
          ctx.session.swapAction === "buy"
            ? `Swap Summary:\n\n` +
              `Buy: ${amount} ${buyToken.symbol}\n` +
              `Sell: ${token.symbol}\n` +
              `Wallet: ${
                wallet.address
                  ? await walletService.formatAddress(
                      wallet.address,
                      BlockchainType.ETHEREUM
                    )
                  : "Unknown"
              }\n\n` +
              `Do you want to proceed with this swap?`
            : `Swap Summary:\n\n` +
              `Sell: ${amount} ${token.symbol}\n` +
              `Buy: ${buyToken.symbol}\n` +
              `Wallet: ${
                wallet.address
                  ? await walletService.formatAddress(
                      wallet.address,
                      BlockchainType.ETHEREUM
                    )
                  : "Unknown"
              }\n\n` +
              `Do you want to proceed with this swap?`;

        await ctx.editMessageText(summaryText, { reply_markup: keyboard });

        // Clear the swap step
        ctx.session.swapStep = undefined;
        return;
      } catch (error) {
        console.error("Error getting wallet:", error);
        await ctx.editMessageText(
          "Failed to get your wallet. Please make sure you have created a wallet using /wallet command."
        );
        clearSwapSession(ctx);
        return;
      }
    }

    // For sell-first flow, continue with normal flow
    await ctx.editMessageText(
      `You selected ${token.symbol} (${token.name}) as the token to sell.\n\n` +
        `Now enter the token you want to buy (symbol, name, or address):`
    );

    ctx.session.swapStep = "enter_buy_token";
  });

  // Handle buy token selection from multiple options
  bot.callbackQuery(/swap_select_buy_token_(.+)/, async (ctx) => {
    const tokenAddress = ctx.match?.[1];
    const chainId = ctx.session.selectedChainId;
    const sellToken = ctx.session.sellToken;

    if (!tokenAddress || !chainId) {
      await ctx.answerCallbackQuery({
        text: "Missing information. Please start again.",
        show_alert: true,
      });
      return;
    }

    // Acknowledge the callback query
    await ctx.answerCallbackQuery();

    // Find the token
    const token = tokenService.findTokenByAddress(tokenAddress, chainId);

    if (!token) {
      await ctx.editMessageText(
        "Token not found. Please start again with /swap"
      );
      return;
    }

    // For buy-first flow, we don't have a sell token yet
    if (ctx.session.swapAction === "buy" && !sellToken) {
      // Store the token in session
      ctx.session.buyToken = token;

      await ctx.editMessageText(
        `You selected ${token.symbol} (${token.name}) as the token to buy.\n\n` +
          `Now enter the token you want to sell (symbol, name, or address):`
      );

      ctx.session.swapStep = "enter_sell_token";
      return;
    }

    // For sell-first flow, continue with normal flow
    if (!sellToken) {
      await ctx.editMessageText(
        "Please start the swap process again with /swap"
      );
      clearSwapSession(ctx);
      return;
    }

    // Check if the buy token is the same as the sell token
    if (token.address.toLowerCase() === sellToken.address.toLowerCase()) {
      await ctx.editMessageText(
        "You cannot swap a token for itself. Please start again with /swap"
      );
      return;
    }

    // Store the token in session
    ctx.session.buyToken = token;

    // Get user's wallet
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.editMessageText(
        "Could not identify your user ID. Please try again with /swap"
      );
      return;
    }

    try {
      // Explicitly get an Ethereum wallet
      const wallet = (await walletService.getUserWallet(
        userId,
        BlockchainType.ETHEREUM
      )) as EthereumWallet;

      if (!wallet || !wallet.address) {
        await ctx.editMessageText(
          "Could not find your Ethereum wallet. Please create one first using /wallet command."
        );
        clearSwapSession(ctx);
        return;
      }

      // Store wallet in session
      ctx.session.wallet = wallet;

      // Use the amount from the session
      const amount = ctx.session.amount;
      if (!amount) {
        await ctx.editMessageText(
          "Amount is missing. Please start again with /swap"
        );
        clearSwapSession(ctx);
        return;
      }

      // For buy-first flow, we store the amount as buyAmount
      // For sell-first flow, we store it as sellAmount
      if (ctx.session.swapAction === "buy") {
        ctx.session.buyAmount = amount;
      } else {
        ctx.session.sellAmount = amount;
      }

      // Show confirmation
      const keyboard = new InlineKeyboard()
        .text("Confirm Swap", "swap_confirm")
        .text("Cancel", "swap_cancel");

      const summaryText =
        ctx.session.swapAction === "buy"
          ? `Swap Summary:\n\n` +
            `Buy: ${amount} ${token.symbol}\n` +
            `Sell: ${sellToken.symbol}\n` +
            `Wallet: ${
              wallet.address
                ? await walletService.formatAddress(
                    wallet.address,
                    BlockchainType.ETHEREUM
                  )
                : "Unknown"
            }\n\n` +
            `Do you want to proceed with this swap?`
          : `Swap Summary:\n\n` +
            `Sell: ${amount} ${sellToken.symbol}\n` +
            `Buy: ${token.symbol}\n` +
            `Wallet: ${
              wallet.address
                ? await walletService.formatAddress(
                    wallet.address,
                    BlockchainType.ETHEREUM
                  )
                : "Unknown"
            }\n\n` +
            `Do you want to proceed with this swap?`;

      await ctx.editMessageText(summaryText, { reply_markup: keyboard });

      // Clear the swap step
      ctx.session.swapStep = undefined;
    } catch (error) {
      console.error("Error getting wallet:", error);
      await ctx.editMessageText(
        "Failed to get your wallet. Please make sure you have created a wallet using /wallet command."
      );
      clearSwapSession(ctx);
    }
  });

  // Handle swap confirmation
  bot.callbackQuery("swap_confirm", async (ctx) => {
    const userId = ctx.from?.id;
    const chainId = ctx.session.selectedChainId;
    const sellToken = ctx.session.sellToken;
    const buyToken = ctx.session.buyToken;
    const action = ctx.session.swapAction;
    const amount = ctx.session.amount;
    const wallet = ctx.session.wallet;

    if (
      !userId ||
      !chainId ||
      !sellToken ||
      !buyToken ||
      !amount ||
      !wallet ||
      !action
    ) {
      await ctx.answerCallbackQuery({
        text: "Missing swap information. Please start again.",
        show_alert: true,
      });
      return;
    }

    // Acknowledge the callback query
    await ctx.answerCallbackQuery();

    try {
      // Create a status message and ensure we get a Message object back
      const response = await ctx.editMessageText(
        "Processing your swap. This may take a few minutes..."
      );

      // Determine the sell amount based on the action
      const sellAmount = action === "sell" ? amount : undefined;

      // Check if we have a valid message object with an ID
      if (typeof response === "boolean") {
        // If editMessageText returns true, we need to use the original message
        await ctx.reply("Processing your swap. This may take a few minutes...");

        // Execute the swap
        let result: SwapResult;
        try {
          result = await cowSwapService.executeSwap(
            wallet,
            sellToken.address,
            buyToken.address,
            sellAmount || amount, // Use sellAmount if available, otherwise use amount
            50, // 0.5% slippage
            chainId as SupportedChainId
          );
        } catch (error) {
          console.error("Error executing swap:", error);
          await ctx.reply(
            `❌ Error executing swap: ${
              (error as Error).message || "Unknown error"
            }`
          );
          return;
        }

        if (result.success) {
          await ctx.reply(
            `✅ Swap completed successfully!\n\n` +
              `Sold: ${result.sellAmount || sellAmount || amount} ${
                result.sellToken || sellToken.symbol
              }\n` +
              `Received: ${result.actualBuyAmount || "unknown amount"} ${
                result.buyToken || buyToken.symbol
              }\n` +
              `Order ID: ${result.orderId || "N/A"}\n\n` +
              `Message: ${result.message}`
          );
        } else {
          await ctx.reply(
            `❌ Swap failed!\n\n` +
              `Message: ${result.message}\n` +
              (result.orderId ? `Order ID: ${result.orderId}` : "")
          );
        }
      } else {
        // We have a valid message object with an ID
        const messageId = response.message_id;

        // Execute the swap
        let result: SwapResult;
        try {
          result = await cowSwapService.executeSwap(
            wallet,
            sellToken.address,
            buyToken.address,
            sellAmount || amount, // Use sellAmount if available, otherwise use amount
            50, // 0.5% slippage
            chainId as SupportedChainId
          );
        } catch (error) {
          console.error("Error executing swap:", error);
          await ctx.api.editMessageText(
            ctx.chat!.id,
            messageId,
            `❌ Error executing swap: ${
              (error as Error).message || "Unknown error"
            }`
          );
          return;
        }

        if (result.success) {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            messageId,
            `✅ Swap completed successfully!\n\n` +
              `Sold: ${result.sellAmount || sellAmount || amount} ${
                result.sellToken || sellToken.symbol
              }\n` +
              `Received: ${result.actualBuyAmount || "unknown amount"} ${
                result.buyToken || buyToken.symbol
              }\n` +
              `Order ID: ${result.orderId || "N/A"}\n\n` +
              `Message: ${result.message}`
          );
        } else {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            messageId,
            `❌ Swap failed!\n\n` +
              `Message: ${result.message}\n` +
              (result.orderId ? `Order ID: ${result.orderId}` : "")
          );
        }
      }

      // Clear swap session data after completion
      clearSwapSession(ctx);
    } catch (error) {
      console.error("Error in swap confirmation handler:", error);
      await ctx.reply(
        `❌ Error processing swap: ${
          (error as Error).message || "Unknown error"
        }`
      );
      clearSwapSession(ctx);
    }
  });

  // Handle swap cancellation
  bot.callbackQuery("swap_cancel", async (ctx) => {
    await ctx.answerCallbackQuery({
      text: "Swap cancelled",
    });

    await ctx.editMessageText(
      "Swap cancelled. You can start a new swap with /swap"
    );

    // Clear swap session data
    clearSwapSession(ctx);
  });

  // Helper function to clear swap session data
  function clearSwapSession(ctx: SwapContext) {
    ctx.session.swapStep = undefined;
    ctx.session.selectedChain = undefined;
    ctx.session.selectedChainId = undefined;
    ctx.session.sellToken = undefined;
    ctx.session.buyToken = undefined;
    ctx.session.sellAmount = undefined;
    ctx.session.buyAmount = undefined;
    ctx.session.amount = undefined;
    ctx.session.swapAction = undefined;
    ctx.session.wallet = undefined;
  }
}
