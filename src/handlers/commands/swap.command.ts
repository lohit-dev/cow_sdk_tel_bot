import { Bot, InlineKeyboard } from "grammy";
import { BotContext } from "../../services/telegram/telegram.service";

export async function setupSwapCommand(bot: Bot<BotContext>) {
  bot.command("swap", async (ctx) => {
    try {
      // Reset any existing swap session data
      ctx.session.swapStep = undefined;
      ctx.session.swapAction = undefined;
      ctx.session.fromChain = undefined;
      ctx.session.toChain = undefined;
      ctx.session.sellToken = undefined;
      ctx.session.buyToken = undefined;
      ctx.session.sellAmount = undefined;
      ctx.session.buyAmount = undefined;
      ctx.session.swapType = undefined;
      ctx.session.crossChainDirection = undefined;
      ctx.session.destinationWallet = undefined;

      // Create buy/sell selection keyboard
      const keyboard = new InlineKeyboard()
        .text("Buy", "swap_action_buy")
        .text("Sell", "swap_action_sell")
        .row()
        .text("Back to Menu", "show_main_menu");

      await ctx.reply(
        "Welcome to the token swap feature! Would you like to buy or sell?",
        {
          reply_markup: keyboard,
        }
      );
    } catch (error: any) {
      console.error("Error in swap command:", error);
      await ctx.reply("Error starting swap. Please try again.");
    }
  });
}
