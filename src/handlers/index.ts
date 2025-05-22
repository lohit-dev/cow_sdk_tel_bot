import { Bot } from "grammy";
import { BotContext } from "../services/telegram/telegram.service";
// import { setupUniHandlers } from "./uni.handler";
import { walletService } from "../services/telegram/wallet.service";
import { setupSwapHandlers } from "./swap.handler";
import { setupWalletHandlers } from "./wallet.handler";

export function setupHandlers(bot: Bot<BotContext>) {
  setupWalletHandlers(bot as any);
  setupSwapHandlers(bot as any, walletService);
  // setupUniHandlers(bot as any, walletService);

  bot.catch((err) => {
    console.error("Bot error occurred:", err);
  });
}
