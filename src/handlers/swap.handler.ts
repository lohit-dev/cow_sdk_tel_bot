// src/handlers/swap.handler.ts
import { Bot, Context, InlineKeyboard } from "grammy";
import {
  CowSwapService,
  SwapParams,
  Token,
} from "../services/swap/cow.service";
import { WalletService } from "../services/telegram/wallet.service";
import { BlockchainType } from "../types";

export function setupSwapHandlers(bot: Bot, walletService: WalletService) {
  // Command to start a swap
  bot.command("swap", async (ctx) => {
    await ctx.reply(
      "Welcome to the swap feature! You can swap tokens using CoW Protocol.\n\n" +
        "First, select the chain you want to use:",
      {
        reply_markup: new InlineKeyboard()
          .text("Ethereum", "swap_select_chain_ethereum")
          .text("Gnosis Chain", "swap_select_chain_gnosis")
          .row()
          .text("Sepolia (Testnet)", "swap_select_chain_sepolia"),
      }
    );
  });

  // Handle chain selection
  bot.callbackQuery(/swap_select_chain_(.+)/, async (ctx) => {
    const chainName = ctx.match?.[1];
    if (!chainName) return;

    // Check if the chain is supported
    if (!CowSwapService.isSupportedChain(chainName)) {
      await ctx.answerCallbackQuery({
        text: `${chainName} is not supported by CoW Protocol yet.`,
        show_alert: true,
      });
      return;
    }

    // Store the selected chain in session
    ctx.session.selectedChain = chainName;

    // Create a new instance of CowSwapService for the selected chain
    const cowSwapService = new CowSwapService(chainName);

    // Get common tokens for the selected chain
    const tokens = cowSwapService.getCommonTokens();

    // Create keyboard with tokens
    const keyboard = new InlineKeyboard();

    tokens.forEach((token) => {
      keyboard.text(
        token.symbol,
        `swap_select_sell_token_${token.symbol}_${token.address}`
      );
    });

    await ctx.editMessageText(
      `You selected ${chainName}. Now select the token you want to sell:`,
      { reply_markup: keyboard }
    );
  });

  // Handle sell token selection
  bot.callbackQuery(/swap_select_sell_token_(.+)_(.+)/, async (ctx) => {
    const tokenSymbol = ctx.match?.[1];
    const tokenAddress = ctx.match?.[2];
    const chainName = ctx.session.selectedChain;

    if (!tokenSymbol || !tokenAddress || !chainName) return;

    // Store the selected sell token in session
    ctx.session.sellTokenSymbol = tokenSymbol;
    ctx.session.sellTokenAddress = tokenAddress;

    // Create a new instance of CowSwapService for the selected chain
    const cowSwapService = new CowSwapService(chainName);

    // Get common tokens for the selected chain
    const tokens = cowSwapService.getCommonTokens();

    // Create keyboard with tokens (excluding the sell token)
    const keyboard = new InlineKeyboard();

    tokens
      .filter((token) => token.symbol !== tokenSymbol)
      .forEach((token) => {
        keyboard.text(
          token.symbol,
          `swap_select_buy_token_${token.symbol}_${token.address}`
        );
      });

    await ctx.editMessageText(
      `You want to sell ${tokenSymbol}. Now select the token you want to buy:`,
      { reply_markup: keyboard }
    );
  });

  // Handle buy token selection
  bot.callbackQuery(/swap_select_buy_token_(.+)_(.+)/, async (ctx) => {
    const tokenSymbol = ctx.match?.[1];
    const tokenAddress = ctx.match?.[2];
    const chainName = ctx.session.selectedChain;
    const sellTokenSymbol = ctx.session.sellTokenSymbol;

    if (!tokenSymbol || !tokenAddress || !chainName || !sellTokenSymbol) return;

    // Store the selected buy token in session
    ctx.session.buyTokenSymbol = tokenSymbol;
    ctx.session.buyTokenAddress = tokenAddress;

    await ctx.editMessageText(
      `You want to swap ${sellTokenSymbol} for ${tokenSymbol}.\n\n` +
        "Please enter the amount of " +
        sellTokenSymbol +
        " you want to sell:\n" +
        "Example: `0.1`",
      { parse_mode: "Markdown" }
    );

    // Set the next step to handle amount input
    ctx.session.swapStep = "enter_amount";
  });

  // Handle amount input
  bot.on("message:text", async (ctx) => {
    if (ctx.session.swapStep !== "enter_amount") return;

    const amount = ctx.message.text.trim();
    const chainName = ctx.session.selectedChain;
    const sellTokenSymbol = ctx.session.sellTokenSymbol;
    const sellTokenAddress = ctx.session.sellTokenAddress;
    const buyTokenSymbol = ctx.session.buyTokenSymbol;
    const buyTokenAddress = ctx.session.buyTokenAddress;

    if (
      !amount ||
      !chainName ||
      !sellTokenSymbol ||
      !sellTokenAddress ||
      !buyTokenSymbol ||
      !buyTokenAddress
    )
      return;

    // Validate amount
    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      await ctx.reply("Please enter a valid amount greater than 0.");
      return;
    }

    // Store the amount in session
    ctx.session.sellAmount = amount;

    // Ask user to select a wallet
    const userId = ctx.from?.id;
    if (!userId) return;

    // Get user's Ethereum wallets
    const wallets = await walletService.getUserWallets(
      userId,
      BlockchainType.ETHEREUM
    );

    if (!wallets || wallets.length === 0) {
      await ctx.reply(
        "You don't have any Ethereum wallets. Please create one first using /wallet command."
      );
      return;
    }

    // Create keyboard with wallets
    const keyboard = new InlineKeyboard();

    wallets.forEach((wallet, index) => {
      keyboard.text(
        `Wallet ${index} (${walletService.formatAddress(wallet.address)})`,
        `swap_select_wallet_${index}`
      );
    });

    await ctx.reply("Please select the wallet you want to use for the swap:", {
      reply_markup: keyboard,
    });

    // Clear the swap step
    ctx.session.swapStep = undefined;
  });

  // Handle wallet selection
  bot.callbackQuery(/swap_select_wallet_(\d+)/, async (ctx) => {
    const walletIndex = parseInt(ctx.match?.[1] || "0");
    const userId = ctx.from?.id;
    const chainName = ctx.session.selectedChain;
    const sellTokenSymbol = ctx.session.sellTokenSymbol;
    const sellTokenAddress = ctx.session.sellTokenAddress;
    const buyTokenSymbol = ctx.session.buyTokenSymbol;
    const buyTokenAddress = ctx.session.buyTokenAddress;
    const sellAmount = ctx.session.sellAmount;

    if (
      !userId ||
      !chainName ||
      !sellTokenSymbol ||
      !sellTokenAddress ||
      !buyTokenSymbol ||
      !buyTokenAddress ||
      !sellAmount
    )
      return;

    try {
      // Get the wallet
      const wallet = await walletService.getUserWallet(
        userId,
        BlockchainType.ETHEREUM,
        walletIndex
      );

      // Create CowSwapService instance
      const cowSwapService = new CowSwapService(chainName);

      // Get token details
      const tokens = cowSwapService.getCommonTokens();
      const sellToken = tokens.find((t) => t.address === sellTokenAddress);
      const buyToken = tokens.find((t) => t.address === buyTokenAddress);

      if (!sellToken || !buyToken) {
        await ctx.answerCallbackQuery({
          text: "Token not found",
          show_alert: true,
        });
        return;
      }

      // Show loading message
      await ctx.answerCallbackQuery({
        text: "Getting quote...",
      });

      await ctx.editMessageText("Getting quote for your swap...");

      // Get quote
      const swapParams: SwapParams = {
        sellToken,
        buyToken,
        sellAmount,
        slippagePercentage: 0.5, // 0.5% slippage
        receiver: wallet.address,
      };

      const quote = await cowSwapService.getQuote(swapParams);

      // Show quote details
      const keyboard = new InlineKeyboard()
        .text("Confirm Swap", `swap_confirm_${walletIndex}`)
        .text("Cancel", "swap_cancel");

      await ctx.editMessageText(
        `Swap Quote:\n\n` +
          `Sell: ${sellAmount} ${sellTokenSymbol}\n` +
          `Buy: ${quote.buyAmount} ${buyTokenSymbol}\n` +
          `Price: 1 ${sellTokenSymbol} = ${parseFloat(
            quote.executionPrice
          ).toFixed(6)} ${buyTokenSymbol}\n` +
          `Fee: ${quote.fee} ${sellTokenSymbol}\n\n` +
          `Do you want to proceed with this swap?`,
        { reply_markup: keyboard }
      );
    } catch (error) {
      console.error("Error getting swap quote:", error);
      await ctx.answerCallbackQuery({
        text: "Failed to get quote",
        show_alert: true,
      });
      await ctx.editMessageText(
        `Failed to get quote: ${(error as Error).message}`
      );
    }
  });

  // Handle swap confirmation
  bot.callbackQuery(/swap_confirm_(\d+)/, async (ctx) => {
    const walletIndex = parseInt(ctx.match?.[1] || "0");
    const userId = ctx.from?.id;
    const chainName = ctx.session.selectedChain;
    const sellTokenSymbol = ctx.session.sellTokenSymbol;
    const sellTokenAddress = ctx.session.sellTokenAddress;
    const buyTokenSymbol = ctx.session.buyTokenSymbol;
    const buyTokenAddress = ctx.session.buyTokenAddress;
    const sellAmount = ctx.session.sellAmount;

    if (
      !userId ||
      !chainName ||
      !sellTokenSymbol ||
      !sellTokenAddress ||
      !buyTokenSymbol ||
      !buyTokenAddress ||
      !sellAmount
    )
      return;

    try {
      // Show loading message
      await ctx.answerCallbackQuery({
        text: "Creating swap order...",
      });

      await ctx.editMessageText("Creating your swap order...");

      // Get the wallet
      const wallet = await walletService.getUserWallet(
        userId,
        BlockchainType.ETHEREUM,
        walletIndex
      );

      // Create CowSwapService instance
      const cowSwapService = new CowSwapService(chainName);

      // Get token details
      const tokens = cowSwapService.getCommonTokens();
      const sellToken = tokens.find((t) => t.address === sellTokenAddress);
      const buyToken = tokens.find((t) => t.address === buyTokenAddress);

      if (!sellToken || !buyToken) {
        await ctx.editMessageText("Token not found");
        return;
      }

      // Create swap params
      const swapParams: SwapParams = {
        sellToken,
        buyToken,
        sellAmount,
        slippagePercentage: 0.5, // 0.5% slippage
        receiver: wallet.address,
      };

      // Create swap order
      const result = await cowSwapService.createSwapOrder(wallet, swapParams);

      // Show result
      await ctx.editMessageText(
        `Swap order created successfully!\n\n` +
          `Order ID: ${result.orderId}\n` +
          `Sell: ${result.sellAmount} ${result.sellToken.symbol}\n` +
          `Buy: ${result.buyAmount} ${result.buyToken.symbol}\n` +
          `Price: 1 ${result.sellToken.symbol} = ${parseFloat(
            result.executionPrice
          ).toFixed(6)} ${result.buyToken.symbol}\n` +
          `Fee: ${result.fee} ${result.sellToken.symbol}\n` +
          `Status: ${result.status}\n\n` +
          `Your order has been submitted to CoW Protocol and will be executed when conditions are met.`
      );

      // Clear session data
      ctx.session.selectedChain = undefined;
      ctx.session.sellTokenSymbol = undefined;
      ctx.session.sellTokenAddress = undefined;
      ctx.session.buyTokenSymbol = undefined;
      ctx.session.buyTokenAddress = undefined;
      ctx.session.sellAmount = undefined;
      ctx.session.swapStep = undefined;
    } catch (error) {
      console.error("Error creating swap order:", error);
      await ctx.editMessageText(
        `Failed to create swap order: ${(error as Error).message}`
      );
    }
  });

  // Handle swap cancellation
  bot.callbackQuery("swap_cancel", async (ctx) => {
    await ctx.answerCallbackQuery({
      text: "Swap cancelled",
    });

    await ctx.editMessageText("Swap cancelled");

    // Clear session data
    ctx.session.selectedChain = undefined;
    ctx.session.sellTokenSymbol = undefined;
    ctx.session.sellTokenAddress = undefined;
    ctx.session.buyTokenSymbol = undefined;
    ctx.session.buyTokenAddress = undefined;
    ctx.session.sellAmount = undefined;
    ctx.session.swapStep = undefined;
  });
}
