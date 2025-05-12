import { Bot, Context, session, SessionFlavor } from "grammy";
import { CONFIG } from "../../config";

// Define session structure
interface SessionData {
  walletIndex: number;
  activeTokens?: { sell?: string; buy?: string };
  orderStep?: string;
  orderData?: Record<string, string>;
}

export type BotContext = Context & SessionFlavor<SessionData>;

export const createBot = () => {
  const bot = new Bot<BotContext>(CONFIG.TELEGRAM_BOT_TOKEN);

  bot.use(
    session({
      initial: (): SessionData => ({
        walletIndex: 0,
      }),
    })
  );

  return bot;
};
