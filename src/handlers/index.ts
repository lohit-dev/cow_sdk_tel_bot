import { Bot } from "grammy";
import { BotContext } from "../services/telegram/telegram.service";
import { setupWalletHandlers } from "./wallet.handler";

export function setupHandlers(bot: Bot<BotContext>) {
  setupWalletHandlers(bot);

  bot.catch((err) => {
    console.error("Bot error occurred:", err);
  });
}
