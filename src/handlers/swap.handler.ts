import { Bot, Context, InlineKeyboard } from "grammy";
import { CowSwapService } from "../services/swap/cow.service";
import { WalletService } from "../services/telegram/wallet.service";
import { GardenService } from "../services/swap/garden.service";
import { TokenService } from "../services/token/token.service";
import {
  BlockchainType,
  SwapResult,
  Wallet,
  EthereumWallet,
  BitcoinWallet,
} from "../types";
import { SupportedChainId } from "@cowprotocol/cow-sdk";
import { chainIdMap, clearSwapSession } from "../utils/utils";
import { BotContext } from "../services/telegram/telegram.service";
import logger from "../utils/logger";

export function setupSwapHandlers(
  bot: Bot<BotContext>,
  walletService: WalletService
) {
  const cowSwapService = new CowSwapService();
  const tokenService = new TokenService();
  const gardenService = new GardenService(bot as any);

  // Add this helper function to generate CoW explorer links
  const getCowExplorerLink = (
    chainId: number | undefined,
    orderId: string,
    type: "order" | "tx" | "address" = "order"
  ): string => {
    const networkId = chainId;

    // Base URL for CoW Explorer
    const baseUrl =
      networkId === 1
        ? "https://explorer.cow.fi"
        : "https://sepolia.explorer.cow.fi";

    // Return the appropriate URL based on the type
    switch (type) {
      case "order":
        return `${baseUrl}/orders/${orderId}`;
      case "tx":
        return `${baseUrl}/tx/${orderId}`;
      case "address":
        return `${baseUrl}/address/${orderId}`;
      default:
        return `${baseUrl}/orders/${orderId}`;
    }
  };

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

    // If wallet is already selected, ask for buy token directly
    if (ctx.session.wallet) {
      // If swapAction is not set, default to "buy"
      if (!ctx.session.swapAction) {
        ctx.session.swapAction = "buy";
      }

      if (ctx.session.swapAction === "buy") {
        await ctx.editMessageText(
          `Chain selected: ${chainName}\n\nEnter the token you want to buy (symbol, name, or address):`,
          {
            reply_markup: new InlineKeyboard().text("Cancel", "swap_cancel"),
          }
        );
        ctx.session.swapStep = "enter_buy_token";
      } else if (ctx.session.swapAction === "sell") {
        await ctx.editMessageText(
          `Chain selected: ${chainName}\n\nEnter the token you want to sell (symbol, name, or address):`,
          {
            reply_markup: new InlineKeyboard().text("Cancel", "swap_cancel"),
          }
        );
        ctx.session.swapStep = "enter_sell_token";
      }
    } else {
      // If wallet not selected, prompt for wallet selection
      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply("Could not identify your user ID. Please try again.");
        return;
      }

      try {
        // Get the wallets (2 Ethereum, 1 Bitcoin)
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

        const wallet3 = await walletService.getUserWallet(
          userId,
          BlockchainType.BITCOIN,
          0
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
        const w3Address = await walletService.formatAddress(
          wallet3.address,
          BlockchainType.BITCOIN
        );

        // Store wallets in session for later use
        ctx.session.availableWallets = {
          w1: wallet1,
          w2: wallet2,
          w3: wallet3,
        };

        // For swaps, we can only use Ethereum wallets, so filter the options accordingly
        const keyboard = new InlineKeyboard();

        // Only show Ethereum wallets for swapping
        if (wallet1.blockchainType === BlockchainType.ETHEREUM) {
          keyboard.text("w1 (ETH)", "swap_select_wallet_0");
        }

        if (wallet2.blockchainType === BlockchainType.ETHEREUM) {
          keyboard.text("w2 (ETH)", "swap_select_wallet_1");
        }

        if (wallet3.blockchainType === BlockchainType.ETHEREUM) {
          keyboard.text("w3 (ETH)", "swap_select_wallet_2");
        }

        keyboard.row().text("Custom ", "swap_select_wallet_custom");

        await ctx.editMessageText(
          `You selected ${chainName}. Now choose which wallet to use:\n\n` +
            `${
              wallet1.blockchainType === BlockchainType.ETHEREUM ? " " : " "
            }w1 (ETH): ${w1Address}\n` +
            `${
              wallet2.blockchainType === BlockchainType.ETHEREUM ? " " : " "
            }w2 (ETH): ${w2Address}\n` +
            `${
              wallet3.blockchainType === BlockchainType.ETHEREUM ? " " : " "
            }w3 (BTC): ${w3Address}\n\n` +
            `Click on a wallet to select it. Only Ethereum wallets can be used for swaps.`,
          {
            reply_markup: keyboard,
          }
        );
      } catch (error) {
        console.error("Error getting wallets:", error);
        await ctx.reply("Failed to get your wallets. Please try again.");
        clearSwapSession(ctx);
      }
    }
  });

  // Handle wallet selection
  bot.callbackQuery(/swap_select_wallet_(\d|custom)/, async (ctx) => {
    const walletSelection = ctx.match?.[1];
    if (!walletSelection) return;

    // Acknowledge the callback query
    await ctx.answerCallbackQuery();

    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply("Could not identify your user ID. Please try again.");
      return;
    }

    try {
      let selectedWallet: Wallet;

      if (walletSelection === "custom") {
        // Handle custom wallet selection (future implementation)
        await ctx.reply(
          "Custom wallet selection is not implemented yet. Please select one of the predefined wallets."
        );
        return;
      } else {
        const walletIndex = parseInt(walletSelection);

        if (ctx.session.availableWallets) {
          // Use the wallet from session if available
          const walletKey = `w${
            walletIndex + 1
          }` as keyof typeof ctx.session.availableWallets;
          selectedWallet = ctx.session.availableWallets[walletKey];
        } else {
          // Otherwise, get the wallet directly
          if (walletIndex === 0) {
            selectedWallet = await walletService.createWalletFromTelegramId(
              userId,
              BlockchainType.ETHEREUM
            );
          } else if (walletIndex === 1) {
            selectedWallet = await walletService.getUserWallet(
              userId,
              BlockchainType.ETHEREUM,
              1
            );
          } else {
            selectedWallet = await walletService.createWalletFromTelegramId(
              userId,
              BlockchainType.BITCOIN
            );
          }
        }
      }

      // Check if the selected wallet is an Ethereum wallet
      if (selectedWallet.blockchainType !== BlockchainType.ETHEREUM) {
        await ctx.reply(
          "Only Ethereum wallets can be used for swaps. Please select an Ethereum wallet."
        );
        return;
      }

      // Store the selected wallet in session
      ctx.session.wallet = selectedWallet;

      // Confirm wallet selection and directly show chain selection
      await ctx.editMessageText(
        `Wallet selected: ${await walletService.formatAddress(
          selectedWallet.address,
          selectedWallet.blockchainType
        )}\n\nSelect the chain you want to use:`,
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
    } catch (error) {
      console.error("Error selecting wallet:", error);
      await ctx.reply("Failed to select wallet. Please try again.");
      clearSwapSession(ctx);
    }
  });

  // Handle buy/sell action selection - now only used when directly clicking Buy/Sell from main menu
  bot.callbackQuery(/swap_action_(buy|sell)/, async (ctx) => {
    const action = ctx.match?.[1];
    if (!action) return;

    try {
      // Acknowledge the callback query
      await ctx.answerCallbackQuery();

      // Clear previous swap session and set action
      clearSwapSession(ctx);
      ctx.session.swapAction = action;

      // Log the current state to debug
      logger.info(
        `Starting ${action} flow for user: ${
          ctx.from?.id
        }, session: ${JSON.stringify(ctx.session)}`
      );

      // First, ask user to select swap type: DEX or Cross-chain
      const message = await ctx.reply(
        "Select the type of swap you want to perform:",
        {
          reply_markup: new InlineKeyboard()
            .text("DEX Swap (Same Chain)", `swap_type_dex_${action}`)
            .row()
            .text(
              "Cross-chain Swap (BTC ↔ ETH)",
              `swap_type_cross_chain_${action}`
            ),
        }
      );

      // Log the message ID for debugging
      logger.info(
        `Sent swap type selection message with ID: ${message.message_id}`
      );
      logger.info(
        `Swap type options presented to user for ${action}:`,
        ctx.from?.id
      );
    } catch (error) {
      console.error(`Error in ${action} handler:`, error);
      await ctx.reply(`Failed to start ${action} process. Please try again.`);
      clearSwapSession(ctx);
    }
  });

  // Handle all text input for swaps in a single handler
  bot.on("message:text", async (ctx) => {
    // Skip if not in a swap flow
    if (!ctx.session.swapStep) return;

    const step = ctx.session.swapStep;
    logger.info(
      `Processing message for step: ${step}, text: ${ctx.message.text}`
    );

    // Handle different swap steps with switch/case
    switch (step) {
      case "enter_amount": {
        // Handle amount input for regular DEX swaps
        const amount = ctx.message.text.trim();

        // Validate amount
        if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
          await ctx.reply("Please enter a valid amount greater than 0.");
          return;
        }

        // Store the amount in session
        ctx.session.amount = amount;

        // Show swap confirmation instead of asking for tokens again
        const buyToken = ctx.session.buyToken;
        const sellToken = ctx.session.sellToken;

        if (!buyToken || !sellToken) {
          await ctx.reply(
            "Missing token information. Please start the swap process again."
          );
          clearSwapSession(ctx);
          return;
        }

        // Show swap confirmation
        await ctx.reply(
          `Ready to swap ${amount} ${sellToken.symbol} for ${buyToken.symbol}.\n\n` +
            `Confirm this swap?`,
          {
            reply_markup: new InlineKeyboard()
              .text("Confirm", "swap_confirm")
              .text("Cancel", "swap_cancel"),
          }
        );

        // Set the next step to confirmation
        ctx.session.swapStep = "confirm";
        break;
      }

      case "enter_cross_chain_amount": {
        // Handle cross-chain amount input
        const amountText = ctx.message.text.trim();
        const amount = parseFloat(amountText);

        logger.info(
          `Cross-chain amount entered: ${amountText}, parsed: ${amount}`
        );

        // Validate amount
        if (isNaN(amount) || amount <= 0) {
          await ctx.reply(
            "Please enter a valid positive number for the amount.",
            {
              reply_markup: new InlineKeyboard().text("Cancel", "swap_cancel"),
            }
          );
          return;
        }

        // Store the amount in session
        ctx.session.crossChainAmount = amountText;

        // Get the source and destination wallets from session
        const sourceWallet = ctx.session.sourceWallet;
        const destinationWallet = ctx.session.destinationWallet;
        const fromChain = ctx.session.fromChain;
        const toChain = ctx.session.toChain;
        const direction = ctx.session.crossChainDirection;

        logger.info(`Cross-chain swap details: 
          Direction: ${direction}
          From: ${fromChain} (${sourceWallet?.address?.substring(0, 10)}...)
          To: ${toChain} (${destinationWallet?.address?.substring(0, 10)}...)
          Amount: ${amountText}`);

        if (
          !sourceWallet ||
          !destinationWallet ||
          !fromChain ||
          !toChain ||
          !direction
        ) {
          logger.error(`Missing cross-chain swap information: 
            sourceWallet: ${!!sourceWallet}
            destinationWallet: ${!!destinationWallet}
            fromChain: ${fromChain}
            toChain: ${toChain}
            direction: ${direction}`);

          await ctx.reply(
            "Missing swap information. Please start again with /swap"
          );
          clearSwapSession(ctx);
          return;
        }

        // Determine asset symbols based on chains
        const fromAssetSymbol =
          fromChain === BlockchainType.ETHEREUM ? "WBTC" : "BTC";
        const toAssetSymbol =
          toChain === BlockchainType.ETHEREUM ? "WBTC" : "BTC";

        // Show confirmation message
        let confirmationMessage = `📝 **Cross-chain Swap Summary**\n\n`;
        confirmationMessage += `From: ${fromAssetSymbol} (${fromChain})\n`;
        confirmationMessage += `To: ${toAssetSymbol} (${toChain})\n`;
        confirmationMessage += `Amount: ${amountText} ${
          fromChain === BlockchainType.ETHEREUM ? "ETH" : "BTC"
        }\n\n`;

        if (direction === "btc_eth") {
          confirmationMessage += `ℹ️ For BTC → ETH swaps, you'll need to send BTC to a deposit address that will be provided after confirmation.\n\n`;
        }

        confirmationMessage += `Do you want to proceed with this swap?`;

        logger.info(`Sending cross-chain confirmation message`);

        await ctx.reply(confirmationMessage, {
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard()
            .text("Confirm", "swap_cross_chain_confirm")
            .text("Cancel", "swap_cancel"),
        });
        break;
      }

      case "enter_sell_token": {
        const tokenQuery = ctx.message.text.trim();
        const chainId = ctx.session.selectedChainId || 11155111;

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

        // If we're in buy flow and already have a buy token, go to amount
        if (ctx.session.swapAction === "buy" && ctx.session.buyToken) {
          const buyToken = ctx.session.buyToken;

          // Check if the buy token is the same as the sell token
          if (token.address.toLowerCase() === buyToken.address.toLowerCase()) {
            await ctx.reply(
              "You cannot swap a token for itself. Please select a different token."
            );
            return;
          }

          // Ask for the amount
          await ctx.reply(
            `You selected ${token.symbol} (${token.name}) as the token to sell and ${buyToken.symbol} (${buyToken.name}) as the token to buy.\n\n` +
              `Enter the amount of ${token.symbol} you want to swap:`,
            { parse_mode: "Markdown" }
          );

          // Set the next step to handle amount input
          ctx.session.swapStep = "enter_amount";
          return;
        }

        // If we're in sell flow, ask for buy token
        await ctx.reply(
          `You selected ${token.symbol} (${token.name}) as the token to sell.\n\n` +
            `Now enter the token you want to buy (symbol, name, or address):`
        );

        ctx.session.swapStep = "enter_buy_token";
        break;
      }

      case "enter_buy_token": {
        const tokenQuery = ctx.message.text.trim();
        const chainId = ctx.session.selectedChainId || 11155111;

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

        // If we're in sell flow and already have a sell token, go to amount
        if (ctx.session.swapAction === "sell" && ctx.session.sellToken) {
          const sellToken = ctx.session.sellToken;

          // Check if the buy token is the same as the sell token
          if (token.address.toLowerCase() === sellToken.address.toLowerCase()) {
            await ctx.reply(
              "You cannot swap a token for itself. Please select a different token."
            );
            return;
          }

          // Ask for the amount
          await ctx.reply(
            `You selected ${sellToken.symbol} (${sellToken.name}) as the token to sell and ${token.symbol} (${token.name}) as the token to buy.\n\n` +
              `Enter the amount of ${sellToken.symbol} you want to swap:`,
            { parse_mode: "Markdown" }
          );

          // Set the next step to handle amount input
          ctx.session.swapStep = "enter_amount";
          return;
        }

        // If we're in buy flow, ask for sell token
        await ctx.reply(
          `You selected ${token.symbol} (${token.name}) as the token to buy.\n\n` +
            `Now enter the token you want to sell (symbol, name, or address):`
        );

        ctx.session.swapStep = "enter_sell_token";
        break;
      }

      default:
        logger.warn(`Unhandled swap step: ${step}`);
        break;
    }
  });

  // Handle buy token selection from multiple options
  bot.callbackQuery(/swap_select_buy_token_(.+)/, async (ctx) => {
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
    ctx.session.buyToken = token;

    // If we're in sell flow and already have a sell token, go to amount
    if (ctx.session.swapAction === "sell" && ctx.session.sellToken) {
      const sellToken = ctx.session.sellToken;

      // Check if the buy token is the same as the sell token
      if (token.address.toLowerCase() === sellToken.address.toLowerCase()) {
        await ctx.editMessageText(
          "You cannot swap a token for itself. Please start again with /swap"
        );
        return;
      }

      // Ask for the amount
      await ctx.editMessageText(
        `You selected ${sellToken.symbol} (${sellToken.name}) as the token to sell and ${token.symbol} (${token.name}) as the token to buy.\n\n` +
          `Enter the amount of ${sellToken.symbol} you want to swap:`,
        { parse_mode: "Markdown" }
      );

      // Set the next step to handle amount input
      ctx.session.swapStep = "enter_amount";
      return;
    }

    // If we're in buy flow, ask for sell token
    await ctx.editMessageText(
      `You selected ${token.symbol} (${token.name}) as the token to buy.\n\n` +
        `Now enter the token you want to sell (symbol, name, or address):`
    );

    ctx.session.swapStep = "enter_sell_token";
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

    // If we're in buy flow and already have a buy token, go to amount
    if (ctx.session.swapAction === "buy" && ctx.session.buyToken) {
      const buyToken = ctx.session.buyToken;

      // Check if the buy token is the same as the sell token
      if (token.address.toLowerCase() === buyToken.address.toLowerCase()) {
        await ctx.editMessageText(
          "You cannot swap a token for itself. Please start again with /swap"
        );
        return;
      }

      // Ask for the amount
      await ctx.editMessageText(
        `You selected ${token.symbol} (${token.name}) as the token to sell and ${buyToken.symbol} (${buyToken.name}) as the token to buy.\n\n` +
          `Enter the amount of ${token.symbol} you want to swap:`,
        { parse_mode: "Markdown" }
      );

      // Set the next step to handle amount input
      ctx.session.swapStep = "enter_amount";
      return;
    }

    // If we're in sell flow, ask for buy token
    await ctx.editMessageText(
      `You selected ${token.symbol} (${token.name}) as the token to sell.\n\n` +
        `Now enter the token you want to buy (symbol, name, or address):`
    );

    ctx.session.swapStep = "enter_buy_token";
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
        const statusMsg = await ctx.reply(
          "Processing your swap. This may take a few minutes..."
        );

        // Setup a timer to update the status message periodically
        let currentStep = 0;
        const statusMessages = [
          `📊 Getting quote for ${sellAmount || amount} ${
            sellToken.symbol
          } to ${buyToken.symbol}...`,
          `📝 Submitting order to CoW Protocol...`,
        ];

        const statusInterval = setInterval(async () => {
          if (currentStep < statusMessages.length) {
            try {
              await ctx.api.editMessageText(
                ctx.chat!.id,
                statusMsg.message_id,
                statusMessages[currentStep]
              );
              currentStep++;
            } catch (error) {
              console.error("Error updating status message:", error);
            }
          }
        }, 8000); // Update every 8 seconds

        // Create a callback function to notify the user when the order is created
        const onOrderCreated = async (
          orderId: string,
          orderChainId: number
        ) => {
          try {
            // Generate CoW Explorer link
            const cowExplorerUrl = getCowExplorerLink(orderChainId, orderId);

            // Update the status message with the order ID and link
            await ctx.api.editMessageText(
              ctx.chat!.id,
              statusMsg.message_id,
              `🎉 Order created!\n\n` +
                `Order ID: \`${orderId}\`\n\n` +
                `You can track your order here:\n` +
                `🔗 [View on CoW Explorer](${cowExplorerUrl})\n\n` +
                `Waiting for execution... This may take a few minutes.`,
              { parse_mode: "Markdown" }
            );

            // Clear the status interval since we're now showing a static message with the order ID
            clearInterval(statusInterval);
          } catch (error) {
            console.error("Error updating order creation message:", error);
          }
        };

        // Execute the swap
        let result: SwapResult;
        try {
          // Cast wallet to EthereumWallet since CoW SDK only supports Ethereum
          if (wallet.blockchainType !== BlockchainType.ETHEREUM) {
            await ctx.answerCallbackQuery({
              text: "Only Ethereum wallets can be used for swaps. Please select an Ethereum wallet.",
              show_alert: true,
            });
            return;
          }

          // Now we can safely cast to EthereumWallet
          const ethereumWallet = wallet as EthereumWallet;

          // Execute the swap
          result = await cowSwapService.executeSwap(
            ethereumWallet,
            sellToken.address,
            buyToken.address,
            sellAmount || amount, // Use sellAmount if available, otherwise use amount
            50, // 0.5% slippage
            chainId as SupportedChainId,
            onOrderCreated // Pass the callback function
          );
        } catch (error) {
          console.error("Error executing swap:", error);
          await ctx.api.editMessageText(
            ctx.chat!.id,
            statusMsg.message_id,
            `❌ Error executing swap: ${
              (error as Error).message || "Unknown error"
            }`
          );
          return;
        }

        if (result.success) {
          // Format success message with explorer links
          let successMessage = `✅ Swap completed successfully!\n\n`;

          // Add transaction details
          successMessage += `Sold: ${
            result.sellAmount || sellAmount || amount
          } ${result.sellToken || sellToken.symbol}\n`;
          successMessage += `Received: ${
            result.actualBuyAmount || "unknown amount"
          } ${result.buyToken || buyToken.symbol}\n\n`;

          if (result.orderId) {
            // For CoW Protocol, add a link to the explorer
            const cowExplorerUrl = getCowExplorerLink(
              result.chainId,
              result.orderId
            );
            successMessage += `🔗 [View Order on CoW Explorer](${cowExplorerUrl})\n`;
          }

          await ctx.api.editMessageText(
            ctx.chat!.id,
            statusMsg.message_id,
            successMessage,
            { parse_mode: "Markdown" }
          );
        } else {
          // Format error message based on error type with explorer links
          let errorMessage = `❌ Swap failed!\n\n`;

          if (result.errorType === "SellAmountDoesNotCoverFee") {
            errorMessage += `${result.message}\n\n`;
            errorMessage += `Try swapping a larger amount.`;
          } else if (result.errorType === "InsufficientLiquidity") {
            errorMessage += `${result.message}\n\n`;
            errorMessage += `Try a different token pair or a smaller amount.`;
          } else {
            errorMessage += `Message: ${result.message}\n`;

            if (result.orderId) {
              errorMessage += `Order ID: \`${result.orderId}\`\n`;

              // Add CoW Explorer link
              const cowExplorerUrl = getCowExplorerLink(
                result.chainId,
                result.orderId
              );
              errorMessage += `🔍 [View Order on CoW Explorer](${cowExplorerUrl})\n`;
            }

            // Add approval transaction link if available
            if (result.approvalTxHash) {
              const approvalLink = getCowExplorerLink(
                result.chainId,
                result.approvalTxHash,
                "tx"
              );
              errorMessage += `🔐 [View Approval on CoW Explorer](${approvalLink})\n`;
            }
          }

          await ctx.api.editMessageText(
            ctx.chat!.id,
            statusMsg.message_id,
            errorMessage,
            {
              parse_mode: "Markdown",
            }
          );
        }
      } else {
        // We have a valid message object with an ID
        const messageId = response.message_id;

        // Initial status message
        await ctx.api.editMessageText(
          ctx.chat!.id,
          messageId,
          `🔄 Initiating swap: ${sellAmount || amount} ${sellToken.symbol} → ${
            buyToken.symbol
          }...`
        );

        // Setup a timer to update the status message periodically
        let currentStep = 0;
        const statusMessages = [
          `📊 Getting quote for ${sellAmount || amount} ${
            sellToken.symbol
          } to ${buyToken.symbol}...`,
          `📝 Submitting order to CoW Protocol...`,
        ];

        const statusInterval = setInterval(async () => {
          if (currentStep < statusMessages.length) {
            try {
              await ctx.api.editMessageText(
                ctx.chat!.id,
                messageId,
                statusMessages[currentStep]
              );
              currentStep++;
            } catch (error) {
              console.error("Error updating status message:", error);
            }
          }
        }, 8000); // Update every 8 seconds

        // Create a callback function to notify the user when the order is created
        const onOrderCreated = async (
          orderId: string,
          orderChainId: number
        ) => {
          try {
            // Generate CoW Explorer link
            const cowExplorerUrl = getCowExplorerLink(orderChainId, orderId);

            // Update the status message with the order ID and link
            await ctx.api.editMessageText(
              ctx.chat!.id,
              messageId,
              `🎉 Order created!\n\n` +
                `Order ID: \`${orderId}\`\n\n` +
                `You can track your order here:\n` +
                `🔗 [View on CoW Explorer](${cowExplorerUrl})\n\n` +
                `Waiting for execution... This may take a few minutes.`,
              { parse_mode: "Markdown" }
            );

            // Clear the status interval since we're now showing a static message with the order ID
            clearInterval(statusInterval);
          } catch (error) {
            console.error("Error updating order creation message:", error);
          }
        };

        // Execute the swap
        let result: SwapResult;
        try {
          // Cast wallet to EthereumWallet since CoW SDK only supports Ethereum
          if (wallet.blockchainType !== BlockchainType.ETHEREUM) {
            await ctx.answerCallbackQuery({
              text: "Only Ethereum wallets can be used for swaps. Please select an Ethereum wallet.",
              show_alert: true,
            });
            return;
          }

          // Now we can safely cast to EthereumWallet
          const ethereumWallet = wallet as EthereumWallet;

          // Execute the swap
          result = await cowSwapService.executeSwap(
            ethereumWallet,
            sellToken.address,
            buyToken.address,
            sellAmount || amount, // Use sellAmount if available, otherwise use amount
            50, // 0.5% slippage
            chainId as SupportedChainId,
            onOrderCreated // Pass the callback function
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
          // Format success message with explorer links
          let successMessage = `✅ Swap completed successfully!\n\n`;

          // Add transaction details
          successMessage += `Sold: ${
            result.sellAmount || sellAmount || amount
          } ${result.sellToken || sellToken.symbol}\n`;
          successMessage += `Received: ${
            result.actualBuyAmount || "unknown amount"
          } ${result.buyToken || buyToken.symbol}\n\n`;

          if (result.orderId) {
            // For CoW Protocol, add a link to the explorer
            const cowExplorerUrl = getCowExplorerLink(
              result.chainId,
              result.orderId
            );
            successMessage += `🔗 [View Order on CoW Explorer](${cowExplorerUrl})\n`;
          }

          await ctx.api.editMessageText(
            ctx.chat!.id,
            messageId,
            successMessage,
            { parse_mode: "Markdown" }
          );
        } else {
          // Format error message based on error type with explorer links
          let errorMessage = `❌ Swap failed!\n\n`;

          if (result.errorType === "SellAmountDoesNotCoverFee") {
            errorMessage += `${result.message}\n\n`;
            errorMessage += `Try swapping a larger amount.`;
          } else if (result.errorType === "InsufficientLiquidity") {
            errorMessage += `${result.message}\n\n`;
            errorMessage += `Try a different token pair or a smaller amount.`;
          } else {
            errorMessage += `Message: ${result.message}\n`;

            if (result.orderId) {
              errorMessage += `Order ID: \`${result.orderId}\`\n`;

              // Add CoW Explorer link
              const cowExplorerUrl = getCowExplorerLink(
                result.chainId,
                result.orderId
              );
              errorMessage += `🔍 [View Order on CoW Explorer](${cowExplorerUrl})\n`;
            }

            // Add approval transaction link if available
            if (result.approvalTxHash) {
              const approvalLink = getCowExplorerLink(
                result.chainId,
                result.approvalTxHash,
                "tx"
              );
              errorMessage += `🔐 [View Approval on CoW Explorer](${approvalLink})\n`;
            }
          }

          await ctx.api.editMessageText(ctx.chat!.id, messageId, errorMessage, {
            parse_mode: "Markdown",
          });
        }
      }

      // Clear the swap session
      clearSwapSession(ctx);
    } catch (error) {
      console.error("Error in swap confirmation handler:", error);
      await ctx.reply("An unexpected error occurred. Please try again.");
      clearSwapSession(ctx);
    }
  });

  // Handle swap cancellation
  bot.callbackQuery("swap_cancel", async (ctx) => {
    await ctx.answerCallbackQuery({
      text: "Swap cancelled",
    });

    await ctx.editMessageText("Swap cancelled successfully.");

    // Clear swap session data
    clearSwapSession(ctx);
  });

  // Handle buy button click from main menu
  bot.callbackQuery("swap_action_buy", async (ctx) => {
    try {
      // Acknowledge the callback query
      await ctx.answerCallbackQuery();

      // Clear previous swap session and set action to buy
      clearSwapSession(ctx);
      ctx.session.swapAction = "buy";

      // Log the current state to debug
      logger.info(
        `Starting buy flow for user: ${ctx.from?.id}, session: ${JSON.stringify(
          ctx.session
        )}`
      );

      // First, ask user to select swap type: DEX or Cross-chain
      const message = await ctx.reply(
        "Select the type of swap you want to perform:",
        {
          reply_markup: new InlineKeyboard()
            .text("DEX Swap (Same Chain)", "swap_select_chain_sepolia")
            .row()
            .text("Cross-chain Swap (BTC ↔ ETH)", "swap_type_cross_chain_buy"),
        }
      );

      // Log the message ID for debugging
      logger.info(
        `Sent swap type selection message with ID: ${message.message_id}`
      );
      logger.info(`Swap type options presented to user for buy:`, ctx.from?.id);
    } catch (error) {
      console.error("Error in buy handler:", error);
      await ctx.reply("Failed to start buy process. Please try again.");
      clearSwapSession(ctx);
    }
  });

  // Handle sell button click from main menu
  bot.callbackQuery("swap_action_sell", async (ctx) => {
    try {
      // Acknowledge the callback query
      await ctx.answerCallbackQuery();

      // Clear previous swap session and set action to sell
      clearSwapSession(ctx);
      ctx.session.swapAction = "sell";

      // First, ask user to select swap type: DEX or Cross-chain
      const message = await ctx.reply(
        "Select the type of swap you want to perform:",
        {
          reply_markup: new InlineKeyboard()
            .text("DEX Swap (Same Chain)", "swap_select_chain_sepolia")
            .row()
            .text("Cross-chain Swap (BTC ↔ ETH)", "swap_type_cross_chain_sell"),
        }
      );

      // Log the message ID for debugging
      logger.info(
        `Sent swap type selection message with ID: ${message.message_id}`
      );
      logger.info(
        "Swap type options presented to user for sell:",
        ctx.from?.id
      );
    } catch (error) {
      console.error("Error in sell handler:", error);
      await ctx.reply("Failed to start sell process. Please try again.");
      clearSwapSession(ctx);
    }
  });

  // Handle DEX swap type selection for sell
  bot.callbackQuery("swap_type_dex_sell", async (ctx) => {
    try {
      // Acknowledge the callback query
      await ctx.answerCallbackQuery();

      // Store the selected swap type in session
      ctx.session.swapType = "dex";

      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply("Could not identify your user ID. Please try again.");
        return;
      }

      // Get the wallets (2 Ethereum, 1 Bitcoin)
      const wallet1 = await walletService.createWalletFromTelegramId(
        userId,
        BlockchainType.ETHEREUM
      );

      const wallet2 = await walletService.getUserWallet(
        userId,
        BlockchainType.ETHEREUM,
        1
      );

      const wallet3 = await walletService.createWalletFromTelegramId(
        userId,
        BlockchainType.BITCOIN
      );

      // Store wallets in session for later use
      ctx.session.availableWallets = {
        w1: wallet1,
        w2: wallet2,
        w3: wallet3,
      };

      // Ask user to select a chain
      await ctx.reply("Select the blockchain for your swap:", {
        reply_markup: new InlineKeyboard()
          .text("Ethereum", "swap_select_chain_ethereum")
          .row()
          .text("Sepolia (Testnet)", "swap_select_chain_sepolia")
          .row()
          .text("Cancel", "swap_cancel"),
      });
    } catch (error) {
      console.error("Error in sell handler:", error);
      await ctx.reply("Failed to start sell process. Please try again.");
      clearSwapSession(ctx);
    }
  });

  // Handle cross-chain swap type selection for buy
  bot.callbackQuery("swap_type_cross_chain_buy", async (ctx) => {
    try {
      // Acknowledge the callback query
      await ctx.answerCallbackQuery();

      // Store the selected swap type and action in session
      ctx.session.swapType = "cross_chain";
      ctx.session.swapAction = "buy";

      // For cross-chain swaps, ask for direction
      await ctx.reply("Select the direction of your cross-chain swap:", {
        reply_markup: new InlineKeyboard()
          .text("ETH → BTC", "swap_cross_direction_eth_btc")
          .row()
          .text("BTC → ETH", "swap_cross_direction_btc_eth")
          .row()
          .text("Cancel", "swap_cancel"),
      });

      logger.info(
        "Cross-chain direction options presented to user:",
        ctx.from?.id
      );
    } catch (error) {
      console.error("Error setting up cross-chain buy:", error);
      await ctx.reply("Failed to set up cross-chain swap. Please try again.");
      clearSwapSession(ctx);
    }
  });

  // Handle cross-chain swap type selection for sell
  bot.callbackQuery("swap_type_cross_chain_sell", async (ctx) => {
    try {
      // Acknowledge the callback query
      await ctx.answerCallbackQuery();

      // Store the selected swap type and action in session
      ctx.session.swapType = "cross_chain";
      ctx.session.swapAction = "sell";

      // For cross-chain swaps, ask for direction
      await ctx.reply("Select the direction of your cross-chain swap:", {
        reply_markup: new InlineKeyboard()
          .text("ETH → BTC", "swap_cross_direction_eth_btc")
          .row()
          .text("BTC → ETH", "swap_cross_direction_btc_eth")
          .row()
          .text("Cancel", "swap_cancel"),
      });

      logger.info(
        "Cross-chain direction options presented to user:",
        ctx.from?.id
      );
    } catch (error) {
      console.error("Error setting up cross-chain sell:", error);
      await ctx.reply("Failed to set up cross-chain swap. Please try again.");
      clearSwapSession(ctx);
    }
  });

  // Handle swap type selection
  bot.callbackQuery(/swap_type_(dex|cross_chain)/, async (ctx) => {
    const swapType = ctx.match?.[1];
    if (!swapType) return;

    // Acknowledge the callback query
    await ctx.answerCallbackQuery();

    // Store the selected swap type in session
    ctx.session.swapType = swapType as "dex" | "cross_chain";

    if (swapType === "dex") {
      // For DEX swaps, continue with the existing flow
      await ctx.editMessageText("Select the action you want to perform:", {
        reply_markup: new InlineKeyboard()
          .text("Buy", "swap_action_buy")
          .text("Sell", "swap_action_sell"),
      });
    } else if (swapType === "cross_chain") {
      // For cross-chain swaps, ask for direction
      await ctx.editMessageText(
        "Select the direction of your cross-chain swap:",
        {
          reply_markup: new InlineKeyboard()
            .text("ETH → BTC", "swap_cross_direction_eth_btc")
            .row()
            .text("BTC → ETH", "swap_cross_direction_btc_eth")
            .row()
            .text("Cancel", "swap_cancel"),
        }
      );
    }
  });

  // Handle cross-chain direction selection
  bot.callbackQuery(/swap_cross_direction_(eth_btc|btc_eth)/, async (ctx) => {
    const direction = ctx.match?.[1];
    if (!direction) return;

    // Acknowledge the callback query
    await ctx.answerCallbackQuery();

    // Store the selected direction in session
    ctx.session.crossChainDirection = direction as "eth_btc" | "btc_eth";

    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply("Could not identify your user ID. Please try again.");
      return;
    }

    try {
      // Get the wallets (Ethereum and Bitcoin)
      const ethWallet = (await walletService.getUserWallet(
        userId,
        BlockchainType.ETHEREUM,
        0
      )) as EthereumWallet;

      const btcWallet = (await walletService.getUserWallet(
        userId,
        BlockchainType.BITCOIN,
        0
      )) as BitcoinWallet;

      // Format wallet addresses for display
      const ethAddress = await walletService.formatAddress(
        ethWallet.address,
        BlockchainType.ETHEREUM
      );
      const btcAddress = await walletService.formatAddress(
        btcWallet.address,
        BlockchainType.BITCOIN
      );

      // Store wallets in session for later use
      ctx.session.availableWallets = {
        eth: ethWallet,
        btc: btcWallet,
      };

      if (direction === "eth_btc") {
        // For ETH → BTC, we need ETH source wallet and BTC destination
        ctx.session.sourceWallet = ethWallet;
        ctx.session.destinationWallet = btcWallet;
        ctx.session.fromChain = BlockchainType.ETHEREUM;
        ctx.session.toChain = BlockchainType.BITCOIN;

        // Ask for the amount to swap
        await ctx.editMessageText(
          `You selected ETH → BTC swap\n\n` +
            `Source: ${ethAddress} (ETH)\n` +
            `Destination: ${btcAddress} (BTC)\n\n` +
            `Enter the amount of ETH you want to swap:`,
          {
            reply_markup: new InlineKeyboard().text("Cancel", "swap_cancel"),
          }
        );

        ctx.session.swapStep = "enter_cross_chain_amount";
      } else if (direction === "btc_eth") {
        // For BTC → ETH, we need BTC source wallet and ETH destination
        ctx.session.sourceWallet = btcWallet;
        ctx.session.destinationWallet = ethWallet;
        ctx.session.fromChain = BlockchainType.BITCOIN;
        ctx.session.toChain = BlockchainType.ETHEREUM;

        // Ask for the amount to swap
        await ctx.editMessageText(
          `You selected BTC → ETH swap\n\n` +
            `Source: ${btcAddress} (BTC)\n` +
            `Destination: ${ethAddress} (ETH)\n\n` +
            `Enter the amount of BTC you want to swap:`,
          {
            reply_markup: new InlineKeyboard().text("Cancel", "swap_cancel"),
          }
        );

        ctx.session.swapStep = "enter_cross_chain_amount";
      }
    } catch (error) {
      console.error("Error setting up cross-chain swap:", error);
      await ctx.reply("Failed to set up cross-chain swap. Please try again.");
      clearSwapSession(ctx);
    }
  });

  // Handle cross-chain swap confirmation
  bot.callbackQuery("swap_cross_chain_confirm", async (ctx) => {
    // Acknowledge the callback query
    await ctx.answerCallbackQuery();

    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply("Could not identify your user ID. Please try again.");
      return;
    }

    // Get all required data from session
    const sourceWallet = ctx.session.sourceWallet;
    const destinationWallet = ctx.session.destinationWallet;
    const fromChain = ctx.session.fromChain;
    const toChain = ctx.session.toChain;
    const amount = ctx.session.crossChainAmount;

    if (
      !sourceWallet ||
      !destinationWallet ||
      !fromChain ||
      !toChain ||
      !amount
    ) {
      await ctx.reply(
        "Missing swap information. Please start again with /swap"
      );
      clearSwapSession(ctx);
      return;
    }

    try {
      // Create a status message
      const statusMsg = await ctx.reply(
        "Processing your cross-chain swap. This may take a few minutes..."
      );

      // Determine asset symbols based on chains
      const fromAssetSymbol =
        fromChain === BlockchainType.ETHEREUM ? "WBTC" : "BTC";
      const toAssetSymbol =
        toChain === BlockchainType.ETHEREUM ? "WBTC" : "BTC";

      // Execute the swap
      const result = await gardenService.executeSwap(
        ctx,
        userId,
        fromChain,
        toChain,
        fromAssetSymbol,
        toAssetSymbol,
        amount,
        sourceWallet.privateKey || "",
        destinationWallet.address
      );

      if (result.success) {
        // Format success message based on swap direction
        let successMessage = "";

        if (result.isBitcoinSource) {
          // For BTC → ETH swaps, provide deposit instructions
          successMessage = `🔄 **Cross-chain Swap Initiated**\n\n`;
          successMessage += `Order ID: \`${result.orderId}\`\n\n`;
          successMessage += `**Please send ${amount} BTC to this address:**\n`;
          successMessage += `\`${result.depositAddress}\`\n\n`;
          successMessage += `⚠️ **IMPORTANT:**\n`;
          successMessage += `- Send EXACTLY ${amount} BTC\n`;
          successMessage += `- Only send BTC to this address\n`;
          successMessage += `- The bot will automatically complete the swap once your deposit is detected\n`;
          successMessage += `- This may take up to 60 minutes depending on Bitcoin network congestion`;
        } else {
          // For ETH → BTC swaps, show transaction hash
          successMessage = `🔄 **Cross-chain Swap Initiated**\n\n`;
          successMessage += `Order ID: \`${result.orderId}\`\n`;
          successMessage += `Transaction: \`${result.txHash}\`\n\n`;
          successMessage += `Your funds have been locked in the contract. The bot will automatically complete the swap when conditions are met.\n\n`;
          successMessage += `You'll receive a notification when your ${toAssetSymbol} is ready in your destination wallet.`;
        }

        await ctx.api.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          successMessage,
          { parse_mode: "Markdown" }
        );
      } else {
        // Format error message
        let errorMessage = `❌ **Cross-chain Swap Failed**\n\n`;
        errorMessage += `Error: ${result.message}\n\n`;
        errorMessage += `Please try again or contact support if the issue persists.`;

        await ctx.api.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          errorMessage,
          { parse_mode: "Markdown" }
        );
      }

      // Clear the swap session
      clearSwapSession(ctx);
    } catch (error) {
      console.error("Error executing cross-chain swap:", error);
      await ctx.reply(
        `Failed to execute cross-chain swap: ${
          (error as Error).message || "Unknown error"
        }`
      );
      clearSwapSession(ctx);
    }
  });
}
