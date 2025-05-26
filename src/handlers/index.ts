import { Bot } from "grammy";
import { BotContext } from "../services/telegram/telegram.service";
import { setUpCommands } from "./commands";
import { setUpCallbacks } from "./callbacks";

export function setupHandlers(bot: Bot<BotContext>) {
  setUpCommands(bot);
  setUpCallbacks(bot);

  bot.catch((err) => {
    console.error("Bot error occurred:", err);
  });
}
