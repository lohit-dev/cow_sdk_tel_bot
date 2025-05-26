import { Bot, InlineKeyboard } from "grammy";
import { BotContext } from "../../services/telegram/telegram.service";
import { BlockchainType } from "../../types";
import { walletService } from "../../services/telegram/wallet.service";

export async function setUpBalanceCallbacks(bot: Bot<BotContext>) {
  bot.callbackQuery("show_balance_menu", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return ctx.answerCallbackQuery("Could not identify user");

    const keyboard = new InlineKeyboard()
      .text("Wallet 1", `check_wallet_balance_${userId}_0`)
      .text("Wallet 2", `check_wallet_balance_${userId}_1`)
      .row()
      .text("Wallet 3", `check_wallet_balance_${userId}_2`)
      .row()
      .text("All Balances", `check_all_balances_${userId}`)
      .row()
      .text("Back to Menu", "show_main_menu");

    await ctx.answerCallbackQuery();
    await ctx.reply("Select which wallet balance to check:", {
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery(/^check_wallet_balance_(\d+)_(\d+)$/, async (ctx) => {
    try {
      const userId = Number(ctx.match![1]);
      const walletIndex = Number(ctx.match![2]);
      const blockchainType =
        walletIndex === 2 ? BlockchainType.BITCOIN : BlockchainType.ETHEREUM;

      const { messageText, keyboard } = await getBalanceMessage(
        userId,
        blockchainType,
        walletIndex
      );
      await ctx.answerCallbackQuery();
      await ctx.reply(messageText, { reply_markup: keyboard });
    } catch (error) {
      console.error("Error checking wallet balance:", error);
      await ctx.answerCallbackQuery("Error checking balance");
    }
  });

  bot.callbackQuery(/^check_all_balances_(\d+)$/, async (ctx) => {
    try {
      const userId = Number(ctx.match![1]);

      const wallets = await Promise.all([
        walletService.getUserWallet(userId, BlockchainType.ETHEREUM, 0),
        walletService.getUserWallet(userId, BlockchainType.ETHEREUM, 1),
        walletService.getUserWallet(userId, BlockchainType.BITCOIN, 0),
      ]);

      const [ethWallet1, ethWallet2, btcWallet] = wallets;

      const balances = await Promise.all([
        walletService.getBalance(ethWallet1.address, BlockchainType.ETHEREUM),
        walletService.getBalance(ethWallet2.address, BlockchainType.ETHEREUM),
        walletService.getBalanceForUser(userId, BlockchainType.BITCOIN),
      ]);

      const [ethBalance1, ethBalance2, btcBalance] = balances;

      const tokenBalances1 = await walletService.getTokenBalances(
        ethWallet1.address,
        BlockchainType.ETHEREUM
      );
      const tokenBalances2 = await walletService.getTokenBalances(
        ethWallet2.address,
        BlockchainType.ETHEREUM
      );

      let balanceText = `Wallet 1 (ETH): ${formatAddress(
        ethWallet1.address
      )}\nBalance: ${ethBalance1.balance} ETH\n`;
      if (tokenBalances1.length) {
        balanceText +=
          "Token Balances:\n" +
          tokenBalances1.map((t) => `${t.symbol}: ${t.balance}`).join("\n") +
          "\n";
      }

      balanceText += `\nWallet 2 (ETH): ${formatAddress(
        ethWallet2.address
      )}\nBalance: ${ethBalance2.balance} ETH\n`;
      if (tokenBalances2.length) {
        balanceText +=
          "Token Balances:\n" +
          tokenBalances2.map((t) => `${t.symbol}: ${t.balance}`).join("\n") +
          "\n";
      }

      balanceText += `\nWallet 3 (BTC): ${formatAddress(
        btcWallet.address
      )}\nBalance: ${btcBalance.balance} BTC`;

      const keyboard = new InlineKeyboard()
        .text("Back to Balances", "show_balance_menu")
        .row()
        .text("Back to Main Menu", "show_main_menu");

      await ctx.answerCallbackQuery();
      await ctx.reply(`Your wallet balances:\n\n${balanceText}`, {
        reply_markup: keyboard,
      });
    } catch (error) {
      console.error("Error checking all balances:", error);
      await ctx.answerCallbackQuery("Error checking balances");
    }
  });

  bot.callbackQuery(/^balance_([^_]+)_(.+)$/, async (ctx) => {
    try {
      const blockchainType = ctx.match![1] as BlockchainType;
      const address = ctx.match![2];
      const userId = ctx.from?.id;

      if (!address || !userId) throw new Error("Invalid user or address");

      const balanceInfo =
        blockchainType === BlockchainType.BITCOIN
          ? await walletService.getBalanceForUser(userId, blockchainType)
          : await walletService.getBalance(address, blockchainType);

      let messageText = `Balance for ${formatAddress(address)}: ${
        balanceInfo.balance
      } ${balanceInfo.symbol}`;

      if (blockchainType === BlockchainType.ETHEREUM) {
        const tokenBalances = await walletService.getTokenBalances(
          address,
          blockchainType
        );
        if (tokenBalances.length) {
          messageText += "\n\nToken Balances:";
          tokenBalances.forEach(({ symbol, balance }) => {
            messageText += `\n${symbol}: ${balance}`;
          });
        }
      }

      await ctx.answerCallbackQuery();
      await ctx.reply(messageText);
    } catch (error) {
      console.error("Error in balance callback:", error);
      await ctx.answerCallbackQuery("Error checking balance");
    }
  });
}

/* ********************** */
// Helpers for this file
/* ********************** */

const formatAddress = (address: string) =>
  `${address.slice(0, 6)}...${address.slice(-4)}`;

const createBalanceKeyboard = (
  blockchainType: BlockchainType,
  userId: number
) =>
  new InlineKeyboard()
    .text("View Wallet", `wallet_${blockchainType}_${userId}`)
    .row()
    .text("Back to Balances", "show_balance_menu");

const getBalanceMessage = async (
  userId: number,
  blockchainType: BlockchainType,
  walletIndex: number
) => {
  const wallet = await walletService.getUserWallet(
    userId,
    blockchainType,
    walletIndex
  );
  const balanceInfo =
    blockchainType === BlockchainType.BITCOIN
      ? await walletService.getBalanceForUser(userId, blockchainType)
      : await walletService.getBalance(wallet.address, blockchainType);

  let messageText = `${blockchainType.toUpperCase()} Wallet: ${formatAddress(
    wallet.address
  )}\nBalance: ${balanceInfo.balance} ${balanceInfo.symbol}`;

  if (blockchainType === BlockchainType.ETHEREUM) {
    const tokenBalances = await walletService.getTokenBalances(
      wallet.address,
      blockchainType
    );
    if (tokenBalances.length) {
      messageText += "\n\nToken Balances:";
      tokenBalances.forEach(({ symbol, balance }) => {
        messageText += `\n${symbol}: ${balance}`;
      });
    }
  }

  return {
    messageText,
    keyboard: createBalanceKeyboard(blockchainType, userId),
  };
};
