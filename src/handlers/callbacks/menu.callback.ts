import { Bot, InlineKeyboard } from "grammy";
import { BotContext } from "../../services/telegram/telegram.service";

export async function setUpMenuCallbacks(bot: Bot<BotContext>) {
  bot.callbackQuery("show_wallets_menu", async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return ctx.answerCallbackQuery("Could not identify user");

    const keyboard = new InlineKeyboard()
      .text("Ethereum Wallet", `wallet_eth_${userId}`)
      .text("Bitcoin Wallet", `wallet_btc_${userId}`)
      .row()
      .text("Back to Menu", "show_main_menu");

    await ctx.answerCallbackQuery();
    await ctx.reply("Select a wallet to view:", {
      reply_markup: keyboard,
    });
  });

  // Show balance menu callback handler
  bot.callbackQuery("show_balance_menu", async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return ctx.answerCallbackQuery("Could not identify user");

    const keyboard = new InlineKeyboard()
      .text("Wallet 1", `check_wallet_balance_${userId}_0`)
      .text("Wallet 2", `check_wallet_balance_${userId}_1`)
      .row()
      .text("Wallet 3", `check_wallet_balance_${userId}_2`)
      .row()
      .text("All Balances", `check_all_balances_${userId}`)
      .row()
      .text("Back to Menu", "show_main_menu");

    await ctx.answerCallbackQuery();
    await ctx.reply("Select which wallet balance to check:", {
      reply_markup: keyboard,
    });
  });

  // Show new wallet menu callback handler
  bot.callbackQuery("show_new_wallet_menu", async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return ctx.answerCallbackQuery("Could not identify user");

    const keyboard = new InlineKeyboard()
      .text("Ethereum", `create_wallet_eth_${userId}`)
      .text("Bitcoin", `create_wallet_btc_${userId}`)
      .row()
      .text("Back to Menu", "show_main_menu");

    await ctx.answerCallbackQuery();
    await ctx.reply("Select blockchain type for your new wallet:", {
      reply_markup: keyboard,
    });
  });

  // Show add wallet menu callback handler
  bot.callbackQuery("show_add_wallet_menu", async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return ctx.answerCallbackQuery("Could not identify user");

    await ctx.answerCallbackQuery();

    // First, select which wallet slot to replace
    const keyboard = new InlineKeyboard()
      .text("Replace w1", "replace_wallet_0")
      .text("Replace w2", "replace_wallet_1")
      .row()
      .text("Replace w3", "replace_wallet_2")
      .row()
      .text("Back to Menu", "show_main_menu");

    await ctx.reply("Select which wallet you want to replace:", {
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery("show_main_menu", async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text("Buy", "swap_action_buy")
      .text("Sell", "swap_action_sell")
      .row()
      .text("💰 Check Balances", "show_balance_menu")
      .text("➕ Add Wallet", "show_add_wallet_menu")
      .row()
      .text("ℹ️ Help", "show_help");

    await ctx.answerCallbackQuery();
    await ctx.reply(
      `Multi-Chain Wallet Bot Menu 💰\n\n` + `Select an option below:`,
      {
        reply_markup: keyboard,
      }
    );
  });
}

export const getUserId = (ctx: BotContext): number | undefined => {
  const userId = ctx.from?.id;
  if (!userId) {
    ctx.answerCallbackQuery("Could not identify user").catch(console.error);
  }
  return userId;
};
