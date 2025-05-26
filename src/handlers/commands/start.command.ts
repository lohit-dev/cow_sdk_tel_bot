import { Bot, InlineKeyboard } from "grammy";
import { BotContext } from "../../services/telegram/telegram.service";
import { walletService } from "../../services/telegram/wallet.service";
import { BlockchainType } from "../../types/index";

export function setupStartCommand(bot: Bot<BotContext>) {
  bot.command("start", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return ctx.reply("Could not identify user.");

    try {
      const loadingMessage = await ctx.reply(`Setting up your wallets...`);

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

      const [w1Balance, w2Balance, w3Balance] = await Promise.all([
        walletService.getBalance(wallet1.address, BlockchainType.ETHEREUM),
        walletService.getBalance(wallet2.address, BlockchainType.ETHEREUM),
        walletService.getBalance(wallet3.address, BlockchainType.BITCOIN),
      ]);

      // Get token balances for ETH wallets
      const w1TokenBalances = await walletService.getTokenBalances(
        wallet1.address,
        BlockchainType.ETHEREUM
      );
      const w2TokenBalances = await walletService.getTokenBalances(
        wallet2.address,
        BlockchainType.ETHEREUM
      );

      const formatTokenBalances = (
        tokenBalances: { symbol: string; balance: string }[]
      ) => {
        return tokenBalances
          .filter((token) => parseFloat(token.balance) > 0)
          .map((token) => `${token.symbol}: ${token.balance}`)
          .join("\n");
      };

      const w1TokensDisplay = formatTokenBalances(w1TokenBalances);
      const w2TokensDisplay = formatTokenBalances(w2TokenBalances);

      const keyboard = new InlineKeyboard()
        .text("Buy", "swap_action_buy")
        .text("Sell", "swap_action_sell")
        .row()
        .text("💰 Check Balances", "show_balance_menu")
        .row()
        .text("💳 See Wallets", "show_wallets_menu")
        .text("ℹ️ Help", "show_help");

      await ctx.api.editMessageText(
        ctx.chat.id,
        loadingMessage.message_id,
        `Welcome to Multi-Chain Wallet Bot! 💰\n\n` +
          `Your Wallets:\n` +
          `w1 (ETH): ${w1Balance.balance} ($0.0)\n${wallet1.address}` +
          (w1TokensDisplay ? `\nToken Balances:\n${w1TokensDisplay}` : "") +
          `\n\n` +
          `w2 (ETH): ${w2Balance.balance} ($0.0)\n${wallet2.address}` +
          (w2TokensDisplay ? `\nToken Balances:\n${w2TokensDisplay}` : "") +
          `\n\n` +
          `w3 (BTC): ${w3Balance.balance} ($0.0)\n${wallet3.address}\n\n` +
          `Click on a button below to get started or tap ℹ️ Help for more information.`,
        {
          reply_markup: keyboard,
        }
      );
    } catch (error) {
      console.error("Error creating wallets on start:", error);
      await ctx.reply(
        "There was an error creating your wallets. Please try again."
      );
    }
  });

  bot.command("menu", async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text("Buy", "swap_action_buy")
      .text("Sell", "swap_action_sell")
      .row()
      .text("💰 Check Balances", "show_balance_menu")
      .row()
      .text("💳 See Wallets", "show_wallets_menu")
      .text("ℹ️ Help", "show_help");

    await ctx.reply(
      `Multi-Chain Wallet Bot Menu 💰\n\n` + `Select an option to continue:`,
      {
        reply_markup: keyboard,
      }
    );
  });
}
