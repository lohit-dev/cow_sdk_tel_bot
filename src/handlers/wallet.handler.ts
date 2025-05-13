import { Bot, Context, InlineKeyboard } from "grammy";
import { walletService } from "../services/telegram/wallet.service";
import { BlockchainType } from "../types";
import { loadTokens } from "../utils/utils";

async function getTokenBalances(
  address: string,
  blockchain: BlockchainType
): Promise<{ symbol: string; balance: string; address: string }[]> {
  try {
    if (blockchain !== BlockchainType.ETHEREUM) return [];

    const tokens = loadTokens(blockchain);
    const balancePromises = tokens.map(async (token: any) => {
      try {
        const balanceInfo = await walletService.getBalance(
          address,
          blockchain,
          token.address
        );

        return {
          symbol: token.symbol,
          balance: balanceInfo.balance,
          address: token.address,
        };
      } catch (error) {
        console.error(
          `Error fetching balance for token ${token.symbol}:`,
          error
        );
        return {
          symbol: token.symbol,
          balance: "0.0",
          address: token.address,
        };
      }
    });

    return await Promise.all(balancePromises);
  } catch (error) {
    console.error(`Error getting token balances:`, error);
    return [];
  }
}

export function setupWalletHandlers(bot: Bot<Context>) {
  bot.command("start", async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text("🔑 My Wallets", "show_wallets_menu")
      .text("💰 Check Balances", "show_balance_menu")
      .row()
      .text("➕ Create New Wallet", "show_new_wallet_menu")
      .text("ℹ️ Help", "show_help");

    await ctx.reply(
      `Welcome to Multi-Chain Wallet Bot! 💰\n\n` +
        `I can help you create and manage wallets on different blockchains.\n\n` +
        `Select an option below or use these commands:\n` +
        `/wallet - Show your wallets\n` +
        `/newwallet - Create additional wallet\n` +
        `/balance - Check wallet balance\n` +
        `/mnemonic - Show your wallet's mnemonic phrase\n` +
        `/allbalances - Show balances across all chains\n` +
        `/menu - Show this menu again`,
      {
        reply_markup: keyboard,
      }
    );
  });

  // /menu command handler
  bot.command("menu", async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text("🔑 My Wallets", "show_wallets_menu")
      .text("💰 Check Balances", "show_balance_menu")
      .row()
      .text("➕ Create New Wallet", "show_new_wallet_menu")
      .text("ℹ️ Help", "show_help");

    await ctx.reply(
      `Multi-Chain Wallet Bot Menu 💰\n\n` + `Select an option below:`,
      {
        reply_markup: keyboard,
      }
    );
  });

  // Show wallets menu callback handler
  bot.callbackQuery("show_wallets_menu", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return ctx.answerCallbackQuery("Could not identify user");

    const keyboard = new InlineKeyboard()
      .text("Ethereum Wallet", `wallet_eth_${userId}`)
      .text("Bitcoin Wallet", `wallet_btc_${userId}`)
      .row()
      .text("Back to Menu", "show_main_menu");

    await ctx.answerCallbackQuery();
    await ctx.reply("Select a wallet to view:", {
      reply_markup: keyboard,
    });
  });

  // Show balance menu callback handler
  bot.callbackQuery("show_balance_menu", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return ctx.answerCallbackQuery("Could not identify user");

    const keyboard = new InlineKeyboard()
      .text("ETH Balance", `check_balance_eth_${userId}`)
      .text("BTC Balance", `check_balance_btc_${userId}`)
      .row()
      .text("All Balances", `check_all_balances_${userId}`)
      .row()
      .text("Back to Menu", "show_main_menu");

    await ctx.answerCallbackQuery();
    await ctx.reply("Select which balance to check:", {
      reply_markup: keyboard,
    });
  });

  // Show new wallet menu callback handler
  bot.callbackQuery("show_new_wallet_menu", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return ctx.answerCallbackQuery("Could not identify user");

    const keyboard = new InlineKeyboard()
      .text("Ethereum", `create_wallet_eth_${userId}`)
      .text("Bitcoin", `create_wallet_btc_${userId}`)
      .row()
      .text("Back to Menu", "show_main_menu");

    await ctx.answerCallbackQuery();
    await ctx.reply("Select blockchain type for your new wallet:", {
      reply_markup: keyboard,
    });
  });

  // Show help callback handler
  bot.callbackQuery("show_help", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `Multi-Chain Wallet Bot Help 💰\n\n` +
        `This bot helps you create and manage cryptocurrency wallets on multiple blockchains.\n\n` +
        `Available Commands:\n` +
        `/wallet - Show your wallets\n` +
        `/newwallet - Create additional wallet\n` +
        `/balance - Check wallet balance\n` +
        `/mnemonic - Show your wallet's mnemonic phrase\n` +
        `/allbalances - Show balances across all chains\n` +
        `/menu - Show main menu\n\n` +
        `Each wallet is uniquely generated from your Telegram ID and can be recreated using the same ID.`,
      {
        reply_markup: new InlineKeyboard().text(
          "Back to Menu",
          "show_main_menu"
        ),
      }
    );
  });

  // Show main menu callback handler
  bot.callbackQuery("show_main_menu", async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text("🔑 My Wallets", "show_wallets_menu")
      .text("💰 Check Balances", "show_balance_menu")
      .row()
      .text("➕ Create New Wallet", "show_new_wallet_menu")
      .text("ℹ️ Help", "show_help");

    await ctx.answerCallbackQuery();
    await ctx.reply(
      `Multi-Chain Wallet Bot Menu 💰\n\n` + `Select an option below:`,
      {
        reply_markup: keyboard,
      }
    );
  });

  // /wallet command handler
  bot.command("wallet", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return ctx.reply("Could not identify user.");

    try {
      const args = ctx.match?.toString().trim().toLowerCase() || "eth";
      const blockchainType = args.startsWith("btc")
        ? BlockchainType.BITCOIN
        : BlockchainType.ETHEREUM;

      const wallet = await walletService.createWalletFromTelegramId(
        userId,
        blockchainType
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

  // Create wallet callback handler
  bot.callbackQuery(/^create_wallet_([^_]+)_(\d+)$/, async (ctx) => {
    try {
      const blockchainType =
        ctx.match?.[1] === "btc"
          ? BlockchainType.BITCOIN
          : BlockchainType.ETHEREUM;
      const userId = Number(ctx.match?.[2]);

      if (!userId) throw new Error("Invalid user ID");

      const keyboard = new InlineKeyboard();

      // Add buttons for wallet indices 1-5
      for (let i = 1; i <= 5; i++) {
        keyboard.text(
          `Index ${i}`,
          `create_wallet_idx_${blockchainType}_${userId}_${i}`
        );

        // Add a new row after every 3 buttons
        if (i % 3 === 0 && i < 5) {
          keyboard.row();
        }
      }

      await ctx.answerCallbackQuery();
      await ctx.reply(
        `Select index for your new ${blockchainType.toUpperCase()} wallet:\n\n` +
          `The index determines which wallet will be created. Each index creates a unique wallet.`,
        {
          reply_markup: keyboard,
        }
      );
    } catch (error) {
      console.error("Error in blockchain selection:", error);
      await ctx.answerCallbackQuery("Error selecting blockchain");
    }
  });

  // Create wallet with index callback handler
  bot.callbackQuery(/^create_wallet_idx_([^_]+)_(\d+)_(\d+)$/, async (ctx) => {
    try {
      const blockchainType = ctx.match?.[1] as BlockchainType;
      const userId = Number(ctx.match?.[2]);
      const walletIndex = Number(ctx.match?.[3]);

      if (!userId || isNaN(walletIndex))
        throw new Error("Invalid callback data");

      const wallet = await walletService.getUserWallet(
        userId,
        blockchainType,
        walletIndex
      );

      const keyboard = new InlineKeyboard()
        .text("Check Balance", `balance_${blockchainType}_${wallet.address}`)
        .text(
          "Show Mnemonic",
          `mnemonic_hd_${blockchainType}_${userId}_${walletIndex}`
        );

      await ctx.answerCallbackQuery();
      await ctx.reply(
        `New ${blockchainType.toUpperCase()} wallet (index: ${walletIndex}) created:\n` +
          `\`${wallet.address}\`\n\n` +
          `Path: ${wallet.path || "N/A"}`,
        {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        }
      );
    } catch (error) {
      console.error("Error creating wallet with index:", error);
      await ctx.answerCallbackQuery("Error creating wallet");
    }
  });

  // /balance command handler
  bot.command("balance", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return ctx.reply("Could not identify user.");

    try {
      const args = ctx.match?.toString().trim().toLowerCase() || "eth";
      const blockchainType = args.startsWith("btc")
        ? BlockchainType.BITCOIN
        : BlockchainType.ETHEREUM;

      // Get the main wallet by default
      const wallet = await walletService.createWalletFromTelegramId(
        userId,
        blockchainType
      );

      const balanceInfo = await walletService.getBalance(
        wallet.address,
        blockchainType,
        ""
      );

      let messageText = `${blockchainType.toUpperCase()} Wallet: ${await walletService.formatAddress(
        wallet.address,
        blockchainType
      )}\nBalance: ${balanceInfo.balance} ${balanceInfo.symbol}`;

      // For Ethereum, fetch token balances
      if (blockchainType === BlockchainType.ETHEREUM) {
        const tokenBalances = await getTokenBalances(
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

  // /mnemonic command handler - Show mnemonic phrase for main wallet
  bot.command("mnemonic", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return ctx.reply("Could not identify user.");

    try {
      const args = ctx.match?.toString().trim().toLowerCase() || "eth";
      const blockchainType = args.startsWith("btc")
        ? BlockchainType.BITCOIN
        : BlockchainType.ETHEREUM;

      const wallet = await walletService.createWalletFromTelegramId(
        userId,
        blockchainType
      );

      await ctx.reply(
        `⚠️ KEEP THIS SECRET! ⚠️\n\n` +
          `Your ${blockchainType.toUpperCase()} wallet mnemonic phrase:\n\n` +
          `\`${wallet.mnemonic}\`\n\n` +
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

  // /allbalances command handler
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

      const ethWallet = await walletService.createWalletFromTelegramId(
        userId,
        BlockchainType.ETHEREUM
      );
      const tokenBalances = await getTokenBalances(
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

  // Balance callback handler
  bot.callbackQuery(/^balance_([^_]+)_(.+)$/, async (ctx) => {
    try {
      const blockchainType = ctx.match?.[1] as BlockchainType;
      const address = ctx.match?.[2];
      const userId = ctx.from?.id;

      if (!address || !blockchainType) throw new Error("Invalid callback data");
      if (!userId) throw new Error("Could not identify user");

      let balanceInfo: any;

      if (blockchainType === BlockchainType.BITCOIN) {
        balanceInfo = await walletService.getBalanceForUser(
          userId,
          blockchainType
        );
      } else {
        balanceInfo = await walletService.getBalance(
          address,
          blockchainType,
          ""
        );
      }

      let messageText = `Balance for ${balanceInfo.formattedAddress}: ${balanceInfo.balance} ${balanceInfo.symbol}`;

      if (blockchainType === BlockchainType.ETHEREUM) {
        const tokenBalances = await getTokenBalances(address, blockchainType);

        if (tokenBalances.length > 0) {
          messageText += "\n\nToken Balances:";
          tokenBalances.forEach((token) => {
            messageText += `\n${token.symbol}: ${token.balance}`;
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

  // Mnemonic callback handler for main wallet
  bot.callbackQuery(/^mnemonic_([^_]+)_(\d+)$/, async (ctx) => {
    try {
      const blockchainType = ctx.match?.[1] as BlockchainType;
      const userId = Number(ctx.match?.[2]);

      if (!userId || !blockchainType) throw new Error("Invalid callback data");

      const wallet = await walletService.createWalletFromTelegramId(
        userId,
        blockchainType
      );

      await ctx.answerCallbackQuery();
      await ctx.reply(
        `⚠️ KEEP THIS SECRET! ⚠️\n\n` +
          `Your ${blockchainType.toUpperCase()} wallet mnemonic phrase:\n\n` +
          `\`${wallet.mnemonic}\`\n\n` +
          `Never share this with anyone! Anyone with this phrase can access your funds.`,
        {
          parse_mode: "Markdown",
        }
      );
    } catch (error) {
      console.error("Error in mnemonic callback:", error);
      await ctx.answerCallbackQuery("Error fetching mnemonic");
    }
  });

  // Mnemonic callback handler for HD wallets
  bot.callbackQuery(/^mnemonic_hd_([^_]+)_(\d+)_(\d+)$/, async (ctx) => {
    try {
      const blockchainType = ctx.match?.[1] as BlockchainType;
      const userId = Number(ctx.match?.[2]);
      const walletIndex = Number(ctx.match?.[3]);

      if (!userId || isNaN(walletIndex) || !blockchainType)
        throw new Error("Invalid callback data");

      const wallet = await walletService.getUserWallet(
        userId,
        blockchainType,
        walletIndex
      );

      await ctx.answerCallbackQuery();
      await ctx.reply(
        `⚠️ KEEP THIS SECRET! ⚠️\n\n` +
          `Your ${blockchainType.toUpperCase()} wallet mnemonic phrase (index: ${walletIndex}):\n\n` +
          `\`${wallet.mnemonic}\`\n\n` +
          `Path: ${wallet.path}\n\n` +
          `Never share this with anyone! Anyone with this phrase can access your funds.`,
        {
          parse_mode: "Markdown",
        }
      );
    } catch (error) {
      console.error("Error in HD mnemonic callback:", error);
      await ctx.answerCallbackQuery("Error fetching mnemonic");
    }
  });

  // Wallet display callback handler
  bot.callbackQuery(/^wallet_([^_]+)_(\d+)$/, async (ctx) => {
    try {
      const blockchainType =
        ctx.match?.[1] === "btc"
          ? BlockchainType.BITCOIN
          : BlockchainType.ETHEREUM;
      const userId = Number(ctx.match?.[2]);

      if (!userId) throw new Error("Invalid user ID");

      const wallet = await walletService.createWalletFromTelegramId(
        userId,
        blockchainType
      );

      const keyboard = new InlineKeyboard()
        .text("Check Balance", `balance_${blockchainType}_${wallet.address}`)
        .text("Show Mnemonic", `mnemonic_${blockchainType}_${userId}`)
        .row()
        .text("Back to Wallets", "show_wallets_menu");

      await ctx.answerCallbackQuery();
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
      await ctx.answerCallbackQuery("Error fetching wallet");
    }
  });

  // Balance check callback handler
  bot.callbackQuery(/^check_balance_([^_]+)_(\d+)$/, async (ctx) => {
    try {
      const blockchainType =
        ctx.match?.[1] === "btc"
          ? BlockchainType.BITCOIN
          : BlockchainType.ETHEREUM;
      const userId = Number(ctx.match?.[2]);

      if (!userId) throw new Error("Invalid user ID");

      const balanceInfo = await walletService.getBalanceForUser(
        userId,
        blockchainType
      );

      let messageText = `${blockchainType.toUpperCase()} Wallet: ${
        balanceInfo.formattedAddress
      }\nBalance: ${balanceInfo.balance} ${balanceInfo.symbol}`;

      if (blockchainType === BlockchainType.ETHEREUM) {
        // Use createWalletFromTelegramId to match the /balance command behavior
        const wallet = await walletService.createWalletFromTelegramId(
          userId,
          blockchainType
        );
        const tokenBalances = await getTokenBalances(
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

      const keyboard = new InlineKeyboard()
        .text("View Wallet", `wallet_${blockchainType}_${userId}`)
        .row()
        .text("Back to Balances", "show_balance_menu");

      await ctx.answerCallbackQuery();
      await ctx.reply(messageText, {
        reply_markup: keyboard,
      });
    } catch (error) {
      console.error("Error checking balance:", error);
      await ctx.answerCallbackQuery("Error checking balance");
    }
  });

  // All balances check callback handler
  bot.callbackQuery(/^check_all_balances_(\d+)$/, async (ctx) => {
    try {
      const userId = Number(ctx.match?.[1]);
      if (!userId) throw new Error("Invalid user ID");

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

      const ethWallet = await walletService.createWalletFromTelegramId(
        userId,
        BlockchainType.ETHEREUM
      );
      const tokenBalances = await getTokenBalances(
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
}
