import { Bot, InlineKeyboard } from "grammy";
import { BotContext } from "../../services/telegram/telegram.service";
import { walletService } from "../../services/telegram/wallet.service";
import { BlockchainType } from "../../types";

export async function setUpWalletCommands(bot: Bot<BotContext>) {
  bot.command("wallet", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return ctx.reply("Could not identify user.");

    try {
      const args = ctx.match?.toString().trim().toLowerCase() || "eth";
      const blockchainType = args.startsWith("btc")
        ? BlockchainType.BITCOIN
        : BlockchainType.ETHEREUM;

      const wallet = await walletService.getUserWallet(
        userId,
        blockchainType,
        0
      );

      const keyboard = new InlineKeyboard()
        .text("Check Balance", `balance_${blockchainType}_${wallet.address}`)
        .text("Show Mnemonic", `mnemonic_${blockchainType}_${userId}`);

      await ctx.reply(
        `Your ${blockchainType.toUpperCase()} wallet address:\n` +
          `\`${wallet.address}\`\n\n` +
          `This wallet is uniquely generated from your Telegram ID.`,
        {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        }
      );
    } catch (error) {
      console.error("Error fetching wallet:", error);
      await ctx.reply("Error fetching your wallet. Please try again later.");
    }
  });

  // /newwallet command handler
  bot.command("newwallet", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return ctx.reply("Could not identify user.");

    try {
      const keyboard = new InlineKeyboard()
        .text("Ethereum", `create_wallet_eth_${userId}`)
        .text("Bitcoin", `create_wallet_btc_${userId}`);

      await ctx.reply("Select blockchain type for your new wallet:", {
        reply_markup: keyboard,
      });
    } catch (error) {
      console.error("Error showing wallet options:", error);
      await ctx.reply("Error showing wallet options. Please try again later.");
    }
  });
}
