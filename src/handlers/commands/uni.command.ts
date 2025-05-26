import { Bot, InlineKeyboard } from "grammy";
import { BotContext } from "../../services/telegram/telegram.service";
import { logger } from "ethers";
import { BlockchainType } from "../../types/index";
import { walletService } from "../../services/telegram/wallet.service";
import { clearUniSession } from "../../utils/utils";

export async function setUpUniCommands(bot: Bot<BotContext>) {
  bot.command("uniswap", async (ctx) => {
    try {
      clearUniSession(ctx);

      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply("Could not identify your user ID. Please try again.");
        return;
      }

      const wallet1 = await walletService.getUserWallet(
        userId,
        BlockchainType.ETHEREUM,
        0
      );

      const wallet2 = await walletService.getUserWallet(
        userId,
        BlockchainType.ETHEREUM,
        1
      );

      // Format wallet addresses for display
      const w1Address = await walletService.formatAddress(
        wallet1.address,
        BlockchainType.ETHEREUM
      );
      const w2Address = await walletService.formatAddress(
        wallet2.address,
        BlockchainType.ETHEREUM
      );

      // Prompt user to select a wallet
      await ctx.reply("Select a wallet for your Uniswap trade:", {
        reply_markup: new InlineKeyboard()
          .text(`Wallet 1: ${w1Address}`, "uni_wallet_0")
          .row()
          .text(`Wallet 2: ${w2Address}`, "uni_wallet_1")
          .row()
          .text("Cancel", "uni_cancel"),
      });

      logger.info("Uniswap wallet selection presented to user:", userId);
    } catch (error) {
      console.error("Error in /uni command:", error);
      await ctx.reply("Failed to start Uniswap flow. Please try again later.");
    }
  });
}
