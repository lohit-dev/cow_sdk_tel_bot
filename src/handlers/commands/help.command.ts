import { Bot, InlineKeyboard } from "grammy";
import { BotContext } from "../../services/telegram/telegram.service";

export async function setUpHelpCommand(bot: Bot<BotContext>) {
  bot.command("help", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `Multi-Chain Wallet Bot Help 💰\n\n` +
        `This bot helps you create and manage cryptocurrency wallets on multiple blockchains.\n\n` +
        `Available Commands:\n` +
        `/wallet - Show your wallets\n` +
        `/newwallet - Create additional wallet\n` +
        `/balance - Check wallet balance\n` +
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
