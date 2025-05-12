import { createBot } from "./services/telegram/telegram.service";
import { setupHandlers } from "./handlers";
import logger from "./utils/logger";

async function startBot() {
  try {
    logger.info("Starting CoW Protocol Telegram Wallet Bot...");

    const bot = createBot();
    setupHandlers(bot);

    await bot.start();

    console.log("Bot is running!");
  } catch (error) {
    console.error("Error starting bot:", error);
    process.exit(1);
  }
}

startBot();
