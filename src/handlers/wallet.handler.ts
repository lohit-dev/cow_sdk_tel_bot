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
    const userId = ctx.from?.id;
    if (!userId) return ctx.reply("Could not identify user.");

    try {
      // First, send a loading message immediately
      const loadingMessage = await ctx.reply(
        `Welcome to Multi-Chain Wallet Bot! 💰\n\n` +
          `Loading your wallets and balances... Please wait a moment.`
      );

      // Create 2 Ethereum wallets and 1 Bitcoin wallet automatically
      // Use getUserWallet consistently for all wallet creation
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

      const wallet3 = await walletService.getUserWallet(
        userId,
        BlockchainType.BITCOIN,
        0
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
      const w3Address = await walletService.formatAddress(
        wallet3.address,
        BlockchainType.BITCOIN
      );

      // Get balances in parallel to speed up the process
      const [w1Balance, w2Balance, w3Balance] = await Promise.all([
        walletService.getBalance(wallet1.address, BlockchainType.ETHEREUM),
        walletService.getBalance(wallet2.address, BlockchainType.ETHEREUM),
        walletService.getBalance(wallet3.address, BlockchainType.BITCOIN),
      ]);

      // Get token balances for ETH wallets
      const w1TokenBalances = await getTokenBalances(
        wallet1.address,
        BlockchainType.ETHEREUM
      );
      const w2TokenBalances = await getTokenBalances(
        wallet2.address,
        BlockchainType.ETHEREUM
      );

      // Format token balances for display
      const formatTokenBalances = (
        tokenBalances: { symbol: string; balance: string }[]
      ) => {
        return tokenBalances
          .filter((token) => parseFloat(token.balance) > 0)
          .map((token) => `${token.symbol}: ${token.balance}`)
          .join("\n");
      };

      const w1TokensDisplay = formatTokenBalances(w1TokenBalances);
      const w2TokensDisplay = formatTokenBalances(w2TokenBalances);

      const keyboard = new InlineKeyboard()
        .text("Buy", "swap_action_buy")
        .text("Sell", "swap_action_sell")
        .row()
        .text("💰 Check Balances", "show_balance_menu")
        .text("➕ Add Wallet", "show_add_wallet_menu")
        .row()
        .text("ℹ️ Help", "show_help");

      // Update the loading message with the complete wallet information
      await ctx.api.editMessageText(
        ctx.chat.id,
        loadingMessage.message_id,
        `Welcome to Multi-Chain Wallet Bot! 💰\n\n` +
          `Your Wallets:\n` +
          `w1 (ETH): ${w1Balance.balance} ($0.0)\n${wallet1.address}` +
          (w1TokensDisplay ? `\nToken Balances:\n${w1TokensDisplay}` : "") +
          `\n\n` +
          `w2 (ETH): ${w2Balance.balance} ($0.0)\n${wallet2.address}` +
          (w2TokensDisplay ? `\nToken Balances:\n${w2TokensDisplay}` : "") +
          `\n\n` +
          `w3 (BTC): ${w3Balance.balance} ($0.0)\n${wallet3.address}\n\n` +
          `Click on a button below to get started or tap ℹ️ Help for more information.`,
        {
          reply_markup: keyboard,
        }
      );
    } catch (error) {
      console.error("Error creating wallets on start:", error);
      await ctx.reply(
        "There was an error creating your wallets. Please try again."
      );
    }
  });

  // /menu command handler
  bot.command("menu", async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text("Buy", "swap_action_buy")
      .text("Sell", "swap_action_sell")
      .row()
      .text("💰 Check Balances", "show_balance_menu")
      .text("➕ Add Wallet", "show_add_wallet_menu")
      .row()
      .text("ℹ️ Help", "show_help");

    await ctx.reply(
      `Multi-Chain Wallet Bot Menu 💰\n\n` + `Select an option to continue:`,
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

  // Show add wallet menu callback handler
  bot.callbackQuery("show_add_wallet_menu", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return ctx.answerCallbackQuery("Could not identify user");

    await ctx.answerCallbackQuery();

    // First, select which wallet slot to replace
    const keyboard = new InlineKeyboard()
      .text("Replace w1", "replace_wallet_0")
      .text("Replace w2", "replace_wallet_1")
      .row()
      .text("Replace w3", "replace_wallet_2")
      .row()
      .text("Back to Menu", "show_main_menu");

    await ctx.reply("Select which wallet you want to replace:", {
      reply_markup: keyboard,
    });
  });

  // Handle wallet replacement selection
  bot.callbackQuery(/replace_wallet_(\d)/, async (ctx) => {
    const walletIndex = parseInt(ctx.match?.[1] || "0");
    const userId = ctx.from?.id;
    if (!userId) return ctx.answerCallbackQuery("Could not identify user");

    await ctx.answerCallbackQuery();

    // Now select blockchain type for the new wallet
    const keyboard = new InlineKeyboard()
      .text("Ethereum", `create_replacement_eth_${userId}_${walletIndex}`)
      .text("Bitcoin", `create_replacement_btc_${userId}_${walletIndex}`)
      .row()
      .text("Back", "show_add_wallet_menu");

    await ctx.reply("Select blockchain type for your new wallet:", {
      reply_markup: keyboard,
    });
  });

  // Handle wallet replacement creation - Ethereum
  bot.callbackQuery(/create_replacement_eth_(\d+)_(\d)/, async (ctx) => {
    const userId = parseInt(ctx.match?.[1] || "0");
    const walletIndex = parseInt(ctx.match?.[2] || "0");

    await ctx.answerCallbackQuery();

    try {
      // Create a new Ethereum wallet at the specified index
      const wallet = await walletService.getUserWallet(
        userId,
        BlockchainType.ETHEREUM,
        walletIndex
      );

      const address = await walletService.formatAddress(
        wallet.address,
        BlockchainType.ETHEREUM
      );

      await ctx.reply(
        `✅ Successfully created new Ethereum wallet at position w${
          walletIndex + 1
        }:\n\n` +
          `Address: ${wallet.address}\n` +
          `Formatted: ${address}\n\n` +
          `This wallet replaces your previous w${walletIndex + 1} wallet.`,
        {
          reply_markup: new InlineKeyboard().text(
            "Back to Menu",
            "show_main_menu"
          ),
        }
      );
    } catch (error) {
      console.error("Error creating replacement wallet:", error);
      await ctx.reply("Failed to create new wallet. Please try again.", {
        reply_markup: new InlineKeyboard().text("Back", "show_add_wallet_menu"),
      });
    }
  });

  // Handle wallet replacement creation - Bitcoin
  bot.callbackQuery(/create_replacement_btc_(\d+)_(\d)/, async (ctx) => {
    const userId = parseInt(ctx.match?.[1] || "0");
    const walletIndex = parseInt(ctx.match?.[2] || "0");

    await ctx.answerCallbackQuery();

    try {
      // Create a new Bitcoin wallet
      const wallet = await walletService.getUserWallet(
        userId,
        BlockchainType.BITCOIN,
        walletIndex
      );

      const address = await walletService.formatAddress(
        wallet.address,
        BlockchainType.BITCOIN
      );

      await ctx.reply(
        `✅ Successfully created new Bitcoin wallet at position w${
          walletIndex + 1
        }:\n\n` +
          `Address: ${wallet.address}\n` +
          `Formatted: ${address}\n\n` +
          `This wallet replaces your previous w${walletIndex + 1} wallet.`,
        {
          reply_markup: new InlineKeyboard().text(
            "Back to Menu",
            "show_main_menu"
          ),
        }
      );
    } catch (error) {
      console.error("Error creating replacement wallet:", error);
      await ctx.reply("Failed to create new wallet. Please try again.", {
        reply_markup: new InlineKeyboard().text("Back", "show_add_wallet_menu"),
      });
    }
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
      .text("Buy", "swap_action_buy")
      .text("Sell", "swap_action_sell")
      .row()
      .text("💰 Check Balances", "show_balance_menu")
      .text("➕ Add Wallet", "show_add_wallet_menu")
      .row()
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

      const ethWallet = await walletService.getUserWallet(
        userId,
        BlockchainType.ETHEREUM,
        0
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

  // Wallet balance check callback handler
  bot.callbackQuery(/^check_wallet_balance_(\d+)_(\d+)$/, async (ctx) => {
    try {
      const userId = Number(ctx.match?.[1]);
      const walletIndex = Number(ctx.match?.[2]);

      if (!userId || isNaN(walletIndex))
        throw new Error("Invalid user ID or wallet index");

      // Determine wallet type based on index (0 and 1 are ETH, 2 is BTC)
      const blockchainType =
        walletIndex === 2 ? BlockchainType.BITCOIN : BlockchainType.ETHEREUM;

      // Get the wallet using the same methods as in /start command
      let wallet;
      if (walletIndex === 0 || walletIndex === 2) {
        // For wallet 1 (ETH) and wallet 3 (BTC), use getUserWallet
        wallet = await walletService.getUserWallet(
          userId,
          blockchainType,
          walletIndex
        );
      } else {
        // For wallet 2 (ETH), use getUserWallet
        wallet = await walletService.getUserWallet(userId, blockchainType, 1);
      }

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

      // Format address for display
      const formattedAddress =
        wallet.address.substring(0, 6) +
        "..." +
        wallet.address.substring(wallet.address.length - 4);

      let messageText = `${blockchainType.toUpperCase()} Wallet: ${formattedAddress}\nBalance: ${
        balanceInfo.balance
      } ${balanceInfo.symbol}`;

      // For Ethereum, fetch token balances
      if (blockchainType === BlockchainType.ETHEREUM) {
        const tokenBalances = await getTokenBalances(
          wallet.address,
          blockchainType
        );

        // Always show all token balances
        messageText += "\n\nToken Balances:";
        tokenBalances.forEach((token) => {
          messageText += `\n${token.symbol}: ${token.balance}`;
        });
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
      console.error("Error checking wallet balance:", error);
      await ctx.answerCallbackQuery("Error checking balance");
    }
  });

  // All balances check callback handler
  bot.callbackQuery(/^check_all_balances_(\d+)$/, async (ctx) => {
    try {
      const userId = Number(ctx.match?.[1]);
      if (!userId) throw new Error("Invalid user ID");

      // Get all three wallets
      const ethWallet1 = await walletService.getUserWallet(
        userId,
        BlockchainType.ETHEREUM,
        0
      );

      const ethWallet2 = await walletService.getUserWallet(
        userId,
        BlockchainType.ETHEREUM,
        1
      );

      const btcWallet = await walletService.getUserWallet(
        userId,
        BlockchainType.BITCOIN,
        0
      );

      // Get balances for each wallet
      const ethBalance1 = await walletService.getBalance(
        ethWallet1.address,
        BlockchainType.ETHEREUM
      );

      const ethBalance2 = await walletService.getBalance(
        ethWallet2.address,
        BlockchainType.ETHEREUM
      );

      // For Bitcoin, use getBalanceForUser instead of getBalance
      const btcBalance = await walletService.getBalanceForUser(
        userId,
        BlockchainType.BITCOIN
      );

      // Format addresses for display
      const formattedEthAddress1 =
        ethWallet1.address.substring(0, 6) +
        "..." +
        ethWallet1.address.substring(ethWallet1.address.length - 4);

      const formattedEthAddress2 =
        ethWallet2.address.substring(0, 6) +
        "..." +
        ethWallet2.address.substring(ethWallet2.address.length - 4);

      const formattedBtcAddress =
        btcWallet.address.substring(0, 6) +
        "..." +
        btcWallet.address.substring(btcWallet.address.length - 4);

      let balanceText = "";

      // Display Wallet 1 (ETH)
      balanceText += `Wallet 1 (ETH): ${formattedEthAddress1}\n`;
      balanceText += `Balance: ${ethBalance1.balance} ETH\n\n`;

      // Get token balances for ETH Wallet 1
      const tokenBalances1 = await getTokenBalances(
        ethWallet1.address,
        BlockchainType.ETHEREUM
      );

      if (tokenBalances1.length > 0) {
        balanceText += "Token Balances:\n";
        tokenBalances1.forEach((token) => {
          balanceText += `${token.symbol}: ${token.balance}\n`;
        });
        balanceText += "\n";
      }

      // Display Wallet 2 (ETH)
      balanceText += `Wallet 2 (ETH): ${formattedEthAddress2}\n`;
      balanceText += `Balance: ${ethBalance2.balance} ETH\n\n`;

      // Get token balances for ETH Wallet 2
      const tokenBalances2 = await getTokenBalances(
        ethWallet2.address,
        BlockchainType.ETHEREUM
      );

      if (tokenBalances2.length > 0) {
        balanceText += "Token Balances:\n";
        tokenBalances2.forEach((token) => {
          balanceText += `${token.symbol}: ${token.balance}\n`;
        });
        balanceText += "\n";
      }

      // Display Wallet 3 (BTC)
      balanceText += `Wallet 3 (BTC): ${formattedBtcAddress}\n`;
      balanceText += `Balance: ${btcBalance.balance} BTC\n`;

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

        messageText += "\n\nToken Balances:";
        tokenBalances.forEach((token) => {
          messageText += `\n${token.symbol}: ${token.balance}`;
        });
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

      const wallet = await walletService.getUserWallet(
        userId,
        blockchainType,
        0
      );

      await ctx.answerCallbackQuery();
      await ctx.reply(
        `⚠️ KEEP THIS SECRET! ⚠️\n\n` +
          `Your ${blockchainType.toUpperCase()} wallet mnemonic phrase:\n\n` +
          `\`${wallet.mnemonic}\`\n\n` +
          `IMPORTANT: This mnemonic can only be used to import your primary wallet (index 0) into MetaMask or other wallets. Additional wallets use a custom derivation path and cannot be directly imported.\n\n` +
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

      const wallet = await walletService.getUserWallet(
        userId,
        blockchainType,
        0
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

      let balanceInfo: any;

      if (blockchainType === BlockchainType.BITCOIN) {
        balanceInfo = await walletService.getBalanceForUser(
          userId,
          blockchainType
        );
      } else {
        // Use getUserWallet to match the /balance command behavior
        const wallet = await walletService.getUserWallet(
          userId,
          blockchainType,
          0
        );
        balanceInfo = await walletService.getBalance(
          wallet.address,
          blockchainType,
          ""
        );
      }

      let messageText = `${blockchainType.toUpperCase()} Wallet: ${
        balanceInfo.formattedAddress
      }\nBalance: ${balanceInfo.balance} ${balanceInfo.symbol}`;

      if (blockchainType === BlockchainType.ETHEREUM) {
        const tokenBalances = await getTokenBalances(
          balanceInfo.address,
          blockchainType
        );

        messageText += "\n\nToken Balances:";
        tokenBalances.forEach((token) => {
          messageText += `\n${token.symbol}: ${token.balance}`;
        });
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
}
