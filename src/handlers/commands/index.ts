import { Bot } from "grammy";
import { BotContext } from "../../services/telegram/telegram.service";
import { setUpBalanceCommands } from "./balance.command";
import { setUpWalletCommands } from "./wallet.command";
import { setupStartCommand } from "./start.command";
import { setUpUniCommands } from "./uni.command";
import { setUpHelpCommand } from "./help.command";
import { setupSwapCommand } from "./swap.command";

export async function setUpCommands(bot: Bot<BotContext>) {
  setupStartCommand(bot);
  setUpBalanceCommands(bot);
  setUpWalletCommands(bot);
  setUpUniCommands(bot);
  setUpHelpCommand(bot);
  setupSwapCommand(bot);
}
