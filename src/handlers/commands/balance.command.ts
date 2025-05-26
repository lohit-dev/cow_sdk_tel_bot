import { Bot } from "grammy";
import { BotContext } from "../../services/telegram/telegram.service";
import { BlockchainType } from "../../types";
import { walletService } from "../../services/telegram/wallet.service";

export async function setUpBalanceCommands(bot: Bot<BotContext>) {
  // balance needs a wallet so we take id and create a wallet and find it's balance
  //  `balance_${blockchainType}_${wallet.address}` need's this kind of passing
  bot.command("balance", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return ctx.reply("Could not identify user.");

    try {
      const args = ctx.match?.toString().trim().toLowerCase();
      const blockchainType = args.startsWith("btc")
        ? BlockchainType.BITCOIN
        : BlockchainType.ETHEREUM;

      const wallet = await walletService.getUserWallet(
        userId,
        blockchainType,
        0
      );

      let balanceInfo: any;
      if (blockchainType === BlockchainType.BITCOIN) {
        balanceInfo = await walletService.getBalanceForUser(
          userId,
          blockchainType
        );
      } else {
        balanceInfo = await walletService.getBalance(
          wallet.address,
          blockchainType,
          ""
        );
      }

      let messageText = `${blockchainType.toUpperCase()} Wallet: ${await walletService.formatAddress(
        wallet.address,
        blockchainType
      )}\nBalance: ${balanceInfo.balance} ${balanceInfo.symbol}`;

      if (blockchainType === BlockchainType.ETHEREUM) {
        const tokenBalances = await walletService.getTokenBalances(
          wallet.address,
          blockchainType
        );

        if (tokenBalances.length > 0) {
          messageText += "\n\nToken Balances:";
          tokenBalances.forEach((token) => {
            messageText += `\n${token.symbol}: ${token.balance}`;
          });
        }
      }

      await ctx.reply(messageText);
    } catch (error) {
      console.error("Error checking balance:", error);
      await ctx.reply("Error checking balance. Please try again later.");
    }
  });

  // Secret command we are not gonna make a button and show it
  bot.command("mnemonic", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return ctx.reply("Could not identify user.");

    try {
      const args = ctx.match?.toString().trim().toLowerCase();
      const blockchainType = args.startsWith("btc")
        ? BlockchainType.BITCOIN
        : BlockchainType.ETHEREUM;

      const wallet = await walletService.getUserWallet(
        userId,
        blockchainType,
        0
      );

      await ctx.reply(
        `⚠️ KEEP THIS SECRET! ⚠️\n\n` +
          `Your ${blockchainType.toUpperCase()} wallet mnemonic phrase:\n\n` +
          `\`${wallet.mnemonic}\`\n\n` +
          `IMPORTANT: This mnemonic can only be used to import your primary wallet (wallet 1) into MetaMask or other wallets. Additional wallets use a custom derivation path and cannot be directly imported.\n\n` +
          `Never share this with anyone! Anyone with this phrase can access your funds.`,
        {
          parse_mode: "Markdown",
        }
      );
    } catch (error) {
      console.error("Error fetching mnemonic:", error);
      await ctx.reply(
        "Error fetching your mnemonic phrase. Please try again later."
      );
    }
  });

  // same as balances but this one does for everything
  bot.command("allbalances", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return ctx.reply("Could not identify user.");

    try {
      const tokenAddresses: Record<BlockchainType, string> = {} as Record<
        BlockchainType,
        string
      >;

      tokenAddresses[BlockchainType.ETHEREUM] = "";
      tokenAddresses[BlockchainType.BITCOIN] = "";

      const balances = await walletService.getAllBalances(userId);

      if (balances.length === 0) {
        return ctx.reply("No wallets found.");
      }

      let balanceText = "";
      for (const balance of balances) {
        balanceText += `${balance.blockchainType.toUpperCase()} Wallet: ${
          balance.formattedAddress
        }\n`;
        balanceText += `Balance: ${balance.balance} ${balance.symbol}\n\n`;
      }

      const ethWallet = await walletService.getUserWallet(
        userId,
        BlockchainType.ETHEREUM,
        0
      );
      const tokenBalances = await walletService.getTokenBalances(
        ethWallet.address,
        BlockchainType.ETHEREUM
      );

      if (tokenBalances.length > 0) {
        balanceText += "Ethereum Token Balances:\n";
        tokenBalances.forEach((token) => {
          balanceText += `${token.symbol}: ${token.balance}\n`;
        });
      }

      if (!balanceText) {
        balanceText = "No wallets found.";
      }

      await ctx.reply(`Your wallet balances:\n\n${balanceText}`);
    } catch (error) {
      console.error("Error checking balances:", error);
      await ctx.reply("Error checking balances. Please try again later.");
    }
  });
}
