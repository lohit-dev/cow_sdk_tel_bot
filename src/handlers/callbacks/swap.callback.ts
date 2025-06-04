import { Bot, InlineKeyboard } from "grammy";
import { BotContext } from "../../services/telegram/telegram.service";
import { BlockchainType, SwapResult, TokenInfo } from "../../types";
import { walletService } from "../../services/telegram/wallet.service";
import { tokenService } from "../../services/token/token.service";
import { cowSwapService } from "../../services/swap/cow.service";
import { gardenService } from "../../services/swap/garden.service";
import { uniswapService } from "../../services/swap/uni.service";

// Constants for swap flow
const NETWORKS = {
  ETHEREUM: { name: "Ethereum", id: 11155111, type: BlockchainType.ETHEREUM },
  BITCOIN: { name: "Bitcoin", id: 0, type: BlockchainType.BITCOIN },
};

// Supported tokens by network
const SUPPORTED_TOKENS: Record<BlockchainType, string[]> = {
  [BlockchainType.ETHEREUM]: ["WETH", "USDC", "DAI", "WBTC"],
  [BlockchainType.BITCOIN]: ["BTC"],
};

export async function setupSwapCallbacks(bot: Bot<BotContext>) {
  // Buy action - starts the swap flow
  bot.callbackQuery("swap_action_buy", async (ctx) => {
    try {
      const userId = ctx.from?.id;
      if (!userId) return ctx.answerCallbackQuery("Could not identify user");

      // Reset swap session data
      ctx.session.swapStep = "select_network";
      ctx.session.swapAction = "buy";

      // Create network selection keyboard
      const keyboard = new InlineKeyboard()
        .text(
          `${NETWORKS.ETHEREUM.name}`,
          `swap_network_${NETWORKS.ETHEREUM.type}`
        )
        .text(
          `${NETWORKS.BITCOIN.name}`,
          `swap_network_${NETWORKS.BITCOIN.type}`
        )
        .row()
        .text("Back to Menu", "show_main_menu");

      await ctx.answerCallbackQuery();
      await ctx.reply("Select the network/chain for your swap:", {
        reply_markup: keyboard,
      });
    } catch (error: any) {
      console.error("Error in buy action:", error);
      await ctx.answerCallbackQuery("Error starting swap");
    }
  });

  // Sell action - starts the swap flow
  bot.callbackQuery("swap_action_sell", async (ctx) => {
    try {
      const userId = ctx.from?.id;
      if (!userId) return ctx.answerCallbackQuery("Could not identify user");

      // Reset swap session data
      ctx.session.swapStep = "select_network";
      ctx.session.swapAction = "sell";

      // Create network selection keyboard
      const keyboard = new InlineKeyboard()
        .text(
          `${NETWORKS.ETHEREUM.name}`,
          `swap_network_${NETWORKS.ETHEREUM.type}`
        )
        .text(
          `${NETWORKS.BITCOIN.name}`,
          `swap_network_${NETWORKS.BITCOIN.type}`
        )
        .row()
        .text("Back to Menu", "show_main_menu");

      await ctx.answerCallbackQuery();
      await ctx.reply("Select the network/chain for your swap:", {
        reply_markup: keyboard,
      });
    } catch (error: any) {
      console.error("Error in sell action:", error);
      await ctx.answerCallbackQuery("Error starting swap");
    }
  });

  // Network selection handler
  bot.callbackQuery(/^swap_network_(.+)$/, async (ctx) => {
    try {
      const selectedNetwork = ctx.match![1] as BlockchainType;
      const userId = ctx.from?.id;
      if (!userId) return ctx.answerCallbackQuery("Could not identify user");

      // Save selected network to session
      ctx.session.fromChain = selectedNetwork;
      ctx.session.selectedChain = selectedNetwork;

      if (selectedNetwork === BlockchainType.ETHEREUM) {
        ctx.session.selectedChainId = NETWORKS.ETHEREUM.id;
      } else {
        ctx.session.selectedChainId = NETWORKS.BITCOIN.id;
      }

      // Get user wallet for this network
      const walletIndex = selectedNetwork === BlockchainType.BITCOIN ? 2 : 0;
      const wallet = await walletService.getUserWallet(
        userId,
        selectedNetwork,
        walletIndex
      );

      // Store wallet in session
      ctx.session.sourceWallet = wallet;

      // Move to token selection
      ctx.session.swapStep = "select_from_token";

      // Create from token selection keyboard
      const keyboard = createTokenSelectionKeyboard(selectedNetwork, "from");

      await ctx.answerCallbackQuery();
      await ctx.reply(
        `Select the asset you want to swap from on ${selectedNetwork}:`,
        {
          reply_markup: keyboard,
        }
      );
    } catch (error: any) {
      console.error("Error in network selection:", error);
      await ctx.answerCallbackQuery("Error selecting network");
    }
  });

  // From token selection handler
  bot.callbackQuery(/^swap_from_token_(.+)$/, async (ctx) => {
    try {
      const selectedToken = ctx.match![1];
      const userId = ctx.from?.id;
      if (!userId) return ctx.answerCallbackQuery("Could not identify user");

      // Validate network is selected
      if (!ctx.session.fromChain) {
        return ctx.answerCallbackQuery("Please select a network first");
      }

      // Find token info
      let tokenInfo: TokenInfo | undefined;

      if (ctx.session.fromChain === BlockchainType.BITCOIN) {
        // For Bitcoin, create a simple token info
        tokenInfo = {
          symbol: "BTC",
          name: "Bitcoin",
          address: "BTC",
          decimals: 8,
          chainId: 0,
        };
      } else {
        // For Ethereum, find token in the token service
        tokenInfo = tokenService.findTokenBySymbol(
          selectedToken,
          ctx.session.selectedChainId || NETWORKS.ETHEREUM.id,
          "uni" // Use uni as the default DEX for token lookup
        );
      }

      if (!tokenInfo) {
        return ctx.answerCallbackQuery("Token not found");
      }

      // Save from token to session
      ctx.session.sellToken = tokenInfo;

      // For cross-chain swaps, show destination chain selection
      if (
        ctx.session.fromChain === BlockchainType.ETHEREUM ||
        ctx.session.fromChain === BlockchainType.BITCOIN
      ) {
        ctx.session.swapStep = "select_to_chain";

        const oppositeChain =
          ctx.session.fromChain === BlockchainType.ETHEREUM
            ? BlockchainType.BITCOIN
            : BlockchainType.ETHEREUM;

        const keyboard = new InlineKeyboard()
          .text("Same Network", `swap_to_chain_${ctx.session.fromChain}`)
          .text("Cross-Chain", `swap_to_chain_${oppositeChain}`)
          .row()
          .text("Back", `swap_network_${ctx.session.fromChain}`);

        await ctx.answerCallbackQuery();
        await ctx.reply(
          `You selected ${selectedToken}. Do you want to swap on the same network or cross-chain?`,
          {
            reply_markup: keyboard,
          }
        );
      }
    } catch (error: any) {
      console.error("Error in from token selection:", error);
      await ctx.answerCallbackQuery("Error selecting token");
    }
  });

  // To chain selection handler for cross-chain swaps
  bot.callbackQuery(/^swap_to_chain_(.+)$/, async (ctx) => {
    try {
      const selectedChain = ctx.match![1] as BlockchainType;
      const userId = ctx.from?.id;
      if (!userId) return ctx.answerCallbackQuery("Could not identify user");

      // Save destination chain
      ctx.session.toChain = selectedChain;

      // If cross-chain, get destination wallet
      if (selectedChain !== ctx.session.fromChain) {
        ctx.session.swapType = "cross_chain";

        // Get destination wallet
        const walletIndex = selectedChain === BlockchainType.BITCOIN ? 2 : 0;
        const wallet = await walletService.getUserWallet(
          userId,
          selectedChain,
          walletIndex
        );
        ctx.session.destinationWallet = wallet;

        // For cross-chain, we need to determine the direction
        if (
          ctx.session.fromChain === BlockchainType.ETHEREUM &&
          selectedChain === BlockchainType.BITCOIN
        ) {
          ctx.session.crossChainDirection = "eth_btc";
        } else if (
          ctx.session.fromChain === BlockchainType.BITCOIN &&
          selectedChain === BlockchainType.ETHEREUM
        ) {
          ctx.session.crossChainDirection = "btc_eth";
        }
      } else {
        ctx.session.swapType = "dex";
      }

      // Move to token selection
      ctx.session.swapStep = "select_to_token";

      // Create to token selection keyboard based on destination chain
      const toTokens = SUPPORTED_TOKENS[selectedChain];

      // For same network swaps, exclude the selected from token
      const filteredTokens =
        selectedChain === ctx.session.fromChain
          ? toTokens.filter((token) => token !== ctx.session.sellToken?.symbol)
          : toTokens;

      const keyboard = new InlineKeyboard();

      // Add token buttons in rows of 2
      for (let i = 0; i < filteredTokens.length; i += 2) {
        if (filteredTokens[i]) {
          keyboard.text(
            filteredTokens[i],
            `swap_to_token_${filteredTokens[i]}`
          );
        }
        if (filteredTokens[i + 1]) {
          keyboard.text(
            filteredTokens[i + 1],
            `swap_to_token_${filteredTokens[i + 1]}`
          );
        }
        keyboard.row();
      }

      keyboard.text("Back", `swap_from_token_${ctx.session.sellToken?.symbol}`);

      await ctx.answerCallbackQuery();
      await ctx.reply(
        `Select the asset you want to receive on ${selectedChain}:`,
        {
          reply_markup: keyboard,
        }
      );
    } catch (error: any) {
      console.error("Error in destination chain selection:", error);
      await ctx.answerCallbackQuery("Error selecting destination chain");
    }
  });

  // To token selection handler
  bot.callbackQuery(/^swap_to_token_(.+)$/, async (ctx) => {
    try {
      const selectedToken = ctx.match![1];
      const userId = ctx.from?.id;
      if (!userId) return ctx.answerCallbackQuery("Could not identify user");

      // Validate from token is selected
      if (!ctx.session.sellToken) {
        return ctx.answerCallbackQuery("Please select a source token first");
      }

      // Find token info
      let tokenInfo: TokenInfo | undefined;

      if (ctx.session.toChain === BlockchainType.BITCOIN) {
        // For Bitcoin, create a simple token info
        tokenInfo = {
          symbol: "BTC",
          name: "Bitcoin",
          address: "BTC",
          decimals: 8,
          chainId: 0,
        };
      } else {
        // For Ethereum, find token in the token service
        tokenInfo = tokenService.findTokenBySymbol(
          selectedToken,
          NETWORKS.ETHEREUM.id,
          "uni" // Use uni as the default DEX for token lookup
        );
      }

      if (!tokenInfo) {
        return ctx.answerCallbackQuery("Token not found");
      }

      // Save to token to session
      ctx.session.buyToken = tokenInfo;

      // Move to amount input
      ctx.session.swapStep = "enter_amount";

      await ctx.answerCallbackQuery();

      let swapDescription = "";
      if (ctx.session.swapType === "cross_chain") {
        swapDescription = `You want to swap ${ctx.session.sellToken.symbol} on ${ctx.session.fromChain} for ${tokenInfo.symbol} on ${ctx.session.toChain}.\n\n`;
      } else {
        swapDescription = `You want to swap ${ctx.session.sellToken.symbol} for ${tokenInfo.symbol} on ${ctx.session.fromChain}.\n\n`;
      }

      await ctx.reply(
        `${swapDescription}` +
          `Please enter the amount of ${ctx.session.sellToken.symbol} you want to swap:`
      );
    } catch (error: any) {
      console.error("Error in to token selection:", error);
      await ctx.answerCallbackQuery("Error selecting token");
    }
  });

  // Amount input handler (text message)
  bot.on("message:text", async (ctx) => {
    try {
      // Only process if we're in the enter_amount step
      if (ctx.session.swapStep !== "enter_amount") return;

      const userId = ctx.from.id;
      const amountText = ctx.message.text.trim();

      // Validate amount is a number
      const amount = parseFloat(amountText);
      if (isNaN(amount) || amount <= 0) {
        return ctx.reply("Please enter a valid positive number.");
      }

      // Save amount to session
      ctx.session.sellAmount = amountText;

      // Move to confirmation step
      ctx.session.swapStep = "confirm";

      // Create confirmation keyboard
      const keyboard = new InlineKeyboard()
        .text("Confirm", "swap_confirm")
        .text("Cancel", "show_main_menu");

      // Get estimated output amount and fees
      let estimatedOutput = "calculating...";
      let feeInfo = "calculating...";
      let swapDescription = "";

      // For cross-chain swaps, provide information about the process
      if (ctx.session.swapType === "cross_chain") {
        swapDescription = `Cross-Chain Swap: ${ctx.session.fromChain} → ${ctx.session.toChain}\n`;
        feeInfo = "This will use GardenJS for cross-chain swapping";

        // Try to get quote from Garden service
        try {
          // Note: You may need to implement a getQuote method in your garden service
          estimatedOutput = "Quote will be calculated during execution";
        } catch (error) {
          console.error("Error getting Garden quote:", error);
          estimatedOutput = "Quote will be calculated during execution";
        }
      }
      // For Ethereum DEX swaps, provide fee comparison
      else if (ctx.session.fromChain === BlockchainType.ETHEREUM) {
        swapDescription = `DEX Swap on ${ctx.session.fromChain}\n`;
        feeInfo = "Will compare CoW and Uniswap to find the best rate";
      }

      await ctx.reply(
        `Swap Summary:\n\n` +
          `${swapDescription}` +
          `From: ${amount} ${ctx.session.sellToken!.symbol} (${
            ctx.session.fromChain
          })\n` +
          `To: ${estimatedOutput} ${ctx.session.buyToken!.symbol} (${
            ctx.session.toChain || ctx.session.fromChain
          })\n\n` +
          `${feeInfo}\n\n` +
          `Do you want to proceed with this swap?`,
        {
          reply_markup: keyboard,
        }
      );
    } catch (error: any) {
      console.error("Error processing amount input:", error);
      await ctx.reply("Error processing your input. Please try again.");
    }
  });

  // Swap confirmation handler - THIS IS THE KEY FIX
  bot.callbackQuery("swap_confirm", async (ctx) => {
    try {
      const userId = ctx.from?.id;
      if (!userId) return ctx.answerCallbackQuery("Could not identify user");

      // Validate we have all required data
      if (
        !ctx.session.sellToken ||
        !ctx.session.buyToken ||
        !ctx.session.sellAmount ||
        !ctx.session.sourceWallet
      ) {
        return ctx.answerCallbackQuery(
          "Missing swap information. Please start over."
        );
      }

      await ctx.answerCallbackQuery();

      // Show processing message
      const processingMsg = await ctx.reply("Processing your swap...");

      let swapResult: SwapResult;

      // Execute the swap based on the swap type
      if (ctx.session.swapType === "cross_chain") {
        // For cross-chain swaps, use the Garden service
        swapResult = await executeGardenSwap(ctx);
      } else {
        // For DEX swaps, use the appropriate service based on blockchain
        if (ctx.session.fromChain === BlockchainType.BITCOIN) {
          // Bitcoin same-chain swaps also use Garden
          swapResult = await executeGardenSwap(ctx);
        } else {
          // For Ethereum swaps, compare and use the best DEX
          swapResult = await executeBestDEXSwap(ctx);
        }
      }

      // Delete the processing message
      await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id);

      // Show result to user
      if (swapResult.success) {
        const keyboard = new InlineKeyboard().text(
          "Back to Menu",
          "show_main_menu"
        );

        await ctx.reply(
          `✅ Swap successful!\n\n` +
            `${swapResult.message}\n\n` +
            (swapResult.txHash ? `Transaction: ${swapResult.txHash}\n` : "") +
            (swapResult.orderId ? `Order ID: ${swapResult.orderId}\n` : "") +
            {
              reply_markup: keyboard,
            }
        );
      } else {
        const keyboard = new InlineKeyboard()
          .text(
            "Try Again",
            ctx.session.swapAction === "buy"
              ? "swap_action_buy"
              : "swap_action_sell"
          )
          .text("Back to Menu", "show_main_menu");

        await ctx.reply(`❌ Swap failed!\n\n` + `${swapResult.message}`, {
          reply_markup: keyboard,
        });
      }

      // Reset swap session data
      resetSwapSession(ctx);
    } catch (error: any) {
      console.error("Error confirming swap:", error);
      await ctx.reply("Error processing your swap. Please try again.");
    }
  });
}

// Helper function to create token selection keyboard
function createTokenSelectionKeyboard(
  blockchainType: BlockchainType,
  direction: "from" | "to"
): InlineKeyboard {
  const tokens = SUPPORTED_TOKENS[blockchainType];
  const keyboard = new InlineKeyboard();

  // Add token buttons in rows of 2
  for (let i = 0; i < tokens.length; i += 2) {
    if (tokens[i]) {
      keyboard.text(tokens[i], `swap_${direction}_token_${tokens[i]}`);
    }
    if (tokens[i + 1]) {
      keyboard.text(tokens[i + 1], `swap_${direction}_token_${tokens[i + 1]}`);
    }
    keyboard.row();
  }

  keyboard.text("Back to Menu", "show_main_menu");

  return keyboard;
}

// Execute swap using Garden service for Bitcoin swaps or cross-chain swaps - FIXED
async function executeGardenSwap(ctx: BotContext): Promise<SwapResult> {
  try {
    const userId = ctx.from!.id;

    // Ensure we have destination wallet for cross-chain swaps
    if (
      ctx.session.swapType === "cross_chain" &&
      !ctx.session.destinationWallet
    ) {
      throw new Error("Destination wallet not found for cross-chain swap");
    }

    // Get the correct Bitcoin address for the swap
    let btcAddress: string | undefined;

    if (ctx.session.fromChain === BlockchainType.BITCOIN) {
      // For Bitcoin source, use source wallet address
      btcAddress = ctx.session.sourceWallet!.address;
    } else if (ctx.session.toChain === BlockchainType.BITCOIN) {
      // For Bitcoin destination, use destination wallet address
      btcAddress = ctx.session.destinationWallet!.address;
    }

    console.log(`Executing Garden swap with BTC address: ${btcAddress}`);

    // For cross-chain swaps or Bitcoin swaps, use the Garden service
    return await gardenService.executeSwap(
      ctx as any,
      userId,
      ctx.session.fromChain!,
      ctx.session.toChain || ctx.session.fromChain!, // Use toChain if set, otherwise same as fromChain
      ctx.session.sellToken!.symbol,
      ctx.session.buyToken!.symbol,
      ctx.session.sellAmount!,
      ctx.session.sourceWallet!.privateKey!,
      btcAddress // Pass the correct Bitcoin address
    );
  } catch (error: any) {
    console.error("Error executing Garden swap:", error);
    return {
      success: false,
      message: `Error executing swap: ${error.message || "Unknown error"}`,
    };
  }
}

// Execute swap using the best DEX for Ethereum swaps
async function executeBestDEXSwap(ctx: BotContext): Promise<SwapResult> {
  try {
    // Get wallet
    const wallet = ctx.session.sourceWallet as any;

    console.log("Comparing DEXes to find the best rate...");

    // Default to CoW if we can't get quotes
    let useCow = true;

    // Step 1: Get quotes from both DEXes
    console.log("Getting quotes from both DEXes...");

    // Get CoW quote
    const cowQuote = await cowSwapService.getQuote(
      wallet,
      ctx.session.sellToken!.symbol,
      ctx.session.buyToken!.symbol,
      ctx.session.sellAmount!,
      50, // 0.5% slippage
      ctx.session.selectedChainId
    );

    // Get Uniswap quote
    const uniQuote = await uniswapService.getQuote(
      wallet,
      ctx.session.sellToken!.symbol,
      ctx.session.buyToken!.symbol,
      ctx.session.sellAmount!,
      300, // 3% slippage
      ctx.session.selectedChainId
    );

    // Step 2: Compare quotes and choose the best one
    if (cowQuote.success && uniQuote.success) {
      console.log("Both DEXes returned quotes, comparing...");

      // Parse the expected buy amounts to compare
      const cowAmount = parseFloat(cowQuote.buyAmount!);
      const uniAmount = parseFloat(uniQuote.buyAmount!);

      console.log(
        `CoW expected output: ${cowAmount} ${ctx.session.buyToken!.symbol}`
      );
      console.log(
        `Uniswap expected output: ${uniAmount} ${ctx.session.buyToken!.symbol}`
      );

      // Choose the DEX with the higher output amount (which means lower fees/better rate)
      if (cowAmount > uniAmount) {
        console.log("CoW offers better rate, will execute with CoW");
        useCow = true;
      } else {
        console.log("Uniswap offers better rate, will execute with Uniswap");
        useCow = false;
      }
    } else if (cowQuote.success) {
      console.log("Only CoW returned a valid quote, will use CoW");
      useCow = true;
    } else if (uniQuote.success) {
      console.log("Only Uniswap returned a valid quote, will use Uniswap");
      useCow = false;
    } else {
      // Both failed to provide quotes
      console.log("Both DEXes failed to provide a quote");
      return {
        success: false,
        message: "Failed to get quotes from any DEX. Please try again later.",
      };
    }

    // Step 3: Execute the swap with the selected DEX
    let swapResult: SwapResult;

    if (useCow) {
      console.log("Executing swap with CoW Protocol...");
      swapResult = await cowSwapService.executeSwap(
        wallet,
        ctx.session.sellToken!.symbol,
        ctx.session.buyToken!.symbol,
        ctx.session.sellAmount!,
        50, // 0.5% slippage
        ctx.session.selectedChainId
      );

      if (swapResult.success) {
        swapResult.message = `Swap executed successfully with CoW Protocol (better rate).`;
      }
    } else {
      console.log("Executing swap with Uniswap...");
      swapResult = await uniswapService.executeSwap(
        wallet,
        ctx.session.sellToken!.symbol,
        ctx.session.buyToken!.symbol,
        ctx.session.sellAmount!,
        300, // 3% slippage
        ctx.session.selectedChainId
      );

      if (swapResult.success) {
        swapResult.message = `Swap executed successfully with Uniswap (better rate).`;
      }
    }

    return swapResult;
  } catch (error: any) {
    console.error("Error executing DEX swap:", error);
    return {
      success: false,
      message: `Error executing swap: ${error.message || "Unknown error"}`,
    };
  }
}

// Reset swap session data
function resetSwapSession(ctx: BotContext): void {
  ctx.session.swapStep = undefined;
  ctx.session.swapAction = undefined;
  ctx.session.fromChain = undefined;
  ctx.session.toChain = undefined;
  ctx.session.sellToken = undefined;
  ctx.session.buyToken = undefined;
  ctx.session.sellAmount = undefined;
  ctx.session.buyAmount = undefined;
  ctx.session.swapType = undefined;
  ctx.session.crossChainDirection = undefined;
  ctx.session.destinationWallet = undefined;
}
