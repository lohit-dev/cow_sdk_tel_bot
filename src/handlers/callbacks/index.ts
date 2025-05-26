import { Bot, InlineKeyboard } from "grammy";
import { BotContext } from "../../services/telegram/telegram.service";
import { setUpMenuCallbacks } from "./menu.callback";
import { setUpBalanceCallbacks } from "./balance.callback";
import { setupSwapCallbacks } from "./swap.callback";
// import { setUpWalletCallbacks } from "./wallet.callback";

export async function setUpCallbacks(bot: Bot<BotContext>) {
  setUpMenuCallbacks(bot);
  setUpBalanceCallbacks(bot);
  setupSwapCallbacks(bot);
  // setUpWalletCallbacks(bot);

  bot.callbackQuery("show_help", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `Multi-Chain Wallet Bot Help 💰\n\n` +
        `This bot helps you create and manage cryptocurrency wallets on multiple blockchains.\n\n` +
        `Available Commands:\n` +
        `/wallet - Show your wallets\n` +
        `/newwallet - Create additional wallet\n` +
        `/balance - Check wallet balance\n` +
        `/swap - Swap tokens across chains and DEXes\n` +
        `/mnemonic - Show your wallet's mnemonic phrase\n` +
        `/allbalances - Show balances across all chains\n` +
        `/menu - Show main menu\n\n` +
        `Each wallet is uniquely generated from your Telegram ID and can be recreated using the same ID.`,
      {
        reply_markup: new InlineKeyboard().text(
          "Back to Menu",
          "show_main_menu"
        ),
      }
    );
  });
}
