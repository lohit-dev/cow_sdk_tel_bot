import { Bot } from "grammy";
import { BotContext } from "../services/telegram/telegram.service";
import { setupWalletHandlers } from "./wallet.handler";
import { setupSwapHandlers } from "./swap.handler";
import { walletService } from "../services/telegram/wallet.service";

export function setupHandlers(bot: Bot<BotContext>) {
  setupWalletHandlers(bot);
  setupSwapHandlers(bot as any, walletService);

  bot.catch((err) => {
    console.error("Bot error occurred:", err);
  });
}
