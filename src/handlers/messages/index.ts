import { Bot, InlineKeyboard } from "grammy";
import { BotContext } from "../../services/telegram/telegram.service";
import { clearSwapSession, clearUniSession } from "../../utils/utils";
import { uniswapService } from "../../services/swap/uni.service";
import logger from "../../utils/logger";
import { BlockchainType, EthereumWallet } from "../../types";
import { tokenService } from "../../services/token/token.service";

export async function setUpMessages(bot: Bot<BotContext>) {
  bot.on("message:text", async (ctx) => {
    const uniStep = ctx.session.uniSwap?.step;
    const swapStep = ctx.session.swapStep;

    // Skip if not in any swap flow
    if (!swapStep && !uniStep) return;

    // Handle regular swap steps
    if (swapStep) {
      logger.info(
        `Processing message for swap step: ${swapStep}, text: ${ctx.message.text}`
      );

      switch (swapStep) {
        case "enter_amount": {
          // Handle amount input for regular DEX swaps
          const amount = ctx.message.text.trim();

          // Validate amount
          if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            await ctx.reply("Please enter a valid amount greater than 0.");
            return;
          }

          // Store the amount in session
          ctx.session.amount = amount;

          // Show swap confirmation instead of asking for tokens again
          const buyToken = ctx.session.buyToken;
          const sellToken = ctx.session.sellToken;

          if (!buyToken || !sellToken) {
            await ctx.reply(
              "Missing token information. Please start the swap process again."
            );
            clearSwapSession(ctx);
            return;
          }

          // Show swap confirmation
          await ctx.reply(
            `Ready to swap ${amount} ${sellToken.symbol} for ${buyToken.symbol}.\n\n` +
              `Confirm this swap?`,
            {
              reply_markup: new InlineKeyboard()
                .text("Confirm", "swap_confirm")
                .text("Cancel", "swap_cancel"),
            }
          );

          // Set the next step to confirmation
          ctx.session.swapStep = "confirm";
          break;
        }

        case "enter_cross_chain_amount": {
          // Handle cross-chain amount input
          const amountText = ctx.message.text.trim();
          const amount = parseFloat(amountText);

          logger.info(
            `Cross-chain amount entered: ${amountText}, parsed: ${amount}`
          );

          // Validate amount
          if (isNaN(amount) || amount <= 0) {
            await ctx.reply(
              "Please enter a valid positive number for the amount.",
              {
                reply_markup: new InlineKeyboard().text(
                  "Cancel",
                  "swap_cancel"
                ),
              }
            );
            return;
          }

          // Store the amount in session
          ctx.session.crossChainAmount = amountText;

          // Get the source and destination wallets from session
          const sourceWallet = ctx.session.sourceWallet;
          const destinationWallet = ctx.session.destinationWallet;
          const fromChain = ctx.session.fromChain;
          const toChain = ctx.session.toChain;
          const direction = ctx.session.crossChainDirection;

          logger.info(`Cross-chain swap details: 
                    Direction: ${direction}
                    From: ${fromChain} (${sourceWallet?.address?.substring(
            0,
            10
          )}...)
                    To: ${toChain} (${destinationWallet?.address?.substring(
            0,
            10
          )}...)
                    Amount: ${amountText}`);

          if (
            !sourceWallet ||
            !destinationWallet ||
            !fromChain ||
            !toChain ||
            !direction
          ) {
            logger.warn(`Missing cross-chain swap information: 
                      sourceWallet: ${!!sourceWallet}
                      destinationWallet: ${!!destinationWallet}
                      fromChain: ${fromChain}
                      toChain: ${toChain}
                      direction: ${direction}`);

            await ctx.reply(
              "Missing swap information. Please start again with /swap"
            );
            clearSwapSession(ctx);
            return;
          }

          // Determine asset symbols based on chains
          const fromAssetSymbol =
            fromChain === BlockchainType.ETHEREUM ? "WBTC" : "BTC";
          const toAssetSymbol =
            toChain === BlockchainType.ETHEREUM ? "WBTC" : "BTC";

          // Show confirmation message
          let confirmationMessage = `📝 **Cross-chain Swap Summary**\n\n`;
          confirmationMessage += `From: ${fromAssetSymbol} (${fromChain})\n`;
          confirmationMessage += `To: ${toAssetSymbol} (${toChain})\n`;
          confirmationMessage += `Amount: ${amountText} ${
            fromChain === BlockchainType.ETHEREUM ? "ETH" : "BTC"
          }\n\n`;

          if (direction === "btc_eth") {
            confirmationMessage += `ℹ️ For BTC → ETH swaps, you'll need to send BTC to a deposit address that will be provided after confirmation.\n\n`;
          }

          confirmationMessage += `Do you want to proceed with this swap?`;

          logger.info(`Sending cross-chain confirmation message`);

          await ctx.reply(confirmationMessage, {
            parse_mode: "Markdown",
            reply_markup: new InlineKeyboard()
              .text("Confirm", "swap_cross_chain_confirm")
              .text("Cancel", "swap_cancel"),
          });
          break;
        }

        case "enter_sell_token": {
          const tokenQuery = ctx.message.text.trim();
          const chainId = ctx.session.selectedChainId || 11155111;

          // Search for the token
          const tokens = tokenService.searchTokens(tokenQuery, chainId);

          if (tokens.length === 0) {
            await ctx.reply(
              `Token "${tokenQuery}" not found. Please try another token.`
            );
            return;
          }

          // If multiple tokens found, let the user select one
          if (tokens.length > 1) {
            const keyboard = new InlineKeyboard();

            tokens.slice(0, 5).forEach((token) => {
              keyboard.text(
                `${token.symbol} (${token.name})`,
                `swap_select_sell_token_${token.address}`
              );
              keyboard.row();
            });

            await ctx.reply(
              `Multiple tokens found for "${tokenQuery}". Please select one:`,
              { reply_markup: keyboard }
            );
            return;
          }

          // If only one token found, use it directly
          const token = tokens[0];
          ctx.session.sellToken = token;

          // If we're in buy flow and already have a buy token, go to amount
          if (ctx.session.swapAction === "buy" && ctx.session.buyToken) {
            const buyToken = ctx.session.buyToken;

            // Check if the buy token is the same as the sell token
            if (
              token.address.toLowerCase() === buyToken.address.toLowerCase()
            ) {
              await ctx.reply(
                "You cannot swap a token for itself. Please select a different token."
              );
              return;
            }

            // Ask for the amount
            await ctx.reply(
              `You selected ${token.symbol} (${token.name}) as the token to sell and ${buyToken.symbol} (${buyToken.name}) as the token to buy.\n\n` +
                `Enter the amount of ${token.symbol} you want to swap:`,
              { parse_mode: "Markdown" }
            );

            // Set the next step to handle amount input
            ctx.session.swapStep = "enter_amount";
            return;
          }

          // If we're in sell flow, ask for buy token
          await ctx.reply(
            `You selected ${token.symbol} (${token.name}) as the token to sell.\n\n` +
              `Now enter the token you want to buy (symbol, name, or address):`
          );

          ctx.session.swapStep = "enter_buy_token";
          break;
        }

        case "enter_buy_token": {
          const tokenQuery = ctx.message.text.trim();
          const chainId = ctx.session.selectedChainId || 11155111;

          // Search for the token
          const tokens = tokenService.searchTokens(tokenQuery, chainId);

          if (tokens.length === 0) {
            await ctx.reply(
              `Token "${tokenQuery}" not found. Please try another token.`
            );
            return;
          }

          // If multiple tokens found, let the user select one
          if (tokens.length > 1) {
            const keyboard = new InlineKeyboard();

            tokens.slice(0, 5).forEach((token) => {
              keyboard.text(
                `${token.symbol} (${token.name})`,
                `swap_select_buy_token_${token.address}`
              );
              keyboard.row();
            });

            await ctx.reply(
              `Multiple tokens found for "${tokenQuery}". Please select one:`,
              { reply_markup: keyboard }
            );
            return;
          }

          // If only one token found, use it directly
          const token = tokens[0];
          ctx.session.buyToken = token;

          // If we're in sell flow and already have a sell token, go to amount
          if (ctx.session.swapAction === "sell" && ctx.session.sellToken) {
            const sellToken = ctx.session.sellToken;

            // Check if the buy token is the same as the sell token
            if (
              token.address.toLowerCase() === sellToken.address.toLowerCase()
            ) {
              await ctx.reply(
                "You cannot swap a token for itself. Please select a different token."
              );
              return;
            }

            // Ask for the amount
            await ctx.reply(
              `You selected ${sellToken.symbol} (${sellToken.name}) as the token to sell and ${token.symbol} (${token.name}) as the token to buy.\n\n` +
                `Enter the amount of ${sellToken.symbol} you want to swap:`,
              { parse_mode: "Markdown" }
            );

            // Set the next step to handle amount input
            ctx.session.swapStep = "enter_amount";
            return;
          }

          // If we're in buy flow, ask for sell token
          await ctx.reply(
            `You selected ${token.symbol} (${token.name}) as the token to buy.\n\n` +
              `Now enter the token you want to sell (symbol, name, or address):`
          );

          ctx.session.swapStep = "enter_sell_token";
          break;
        }

        default:
          logger.warn(`Unhandled swap step: ${swapStep}`);
          break;
      }
    }

    // Handle Uniswap steps
    if (uniStep) {
      console.log(`Processing message:text in uni step: ${uniStep}`);

      switch (uniStep) {
        case "enter_sell_token": {
          try {
            const sellTokenQuery = ctx.message.text.trim();
            const chainId = ctx.session.uniSwap!.chainId;

            if (!chainId) {
              await ctx.reply(
                "Chain ID not found. Please start again with /uni"
              );
              clearUniSession(ctx);
              return;
            }

            // Search for the token
            const sellToken = await uniswapService.findToken(
              sellTokenQuery,
              chainId
            );

            if (!sellToken) {
              await ctx.reply(
                `Token "${sellTokenQuery}" not found. Please try again with a different symbol, name, or address.`,
                {
                  reply_markup: new InlineKeyboard().text(
                    "Cancel",
                    "uni_cancel"
                  ),
                }
              );
              return;
            }

            // Store token in session
            ctx.session.uniSwap!.sellToken = sellToken;
            ctx.session.uniSwap!.step = "enter_buy_token";

            // Prompt for buy token
            await ctx.reply(
              `Selected sell token: ${sellToken.symbol} (${sellToken.name})`
            );
            await ctx.reply(
              "Now enter the token you want to buy (symbol, name, or address):",
              {
                reply_markup: new InlineKeyboard().text("Cancel", "uni_cancel"),
              }
            );

            logger.info(
              "Uniswap buy token prompt presented to user:",
              ctx.from?.id
            );
          } catch (error) {
            console.error("Error processing sell token:", error);
            await ctx.reply("Failed to process token. Please try again.");
          }
          break;
        }

        case "enter_buy_token": {
          try {
            const buyTokenQuery = ctx.message.text.trim();
            const chainId = ctx.session.uniSwap!.chainId;
            const sellToken = ctx.session.uniSwap!.sellToken;

            if (!chainId || !sellToken) {
              await ctx.reply(
                "Missing information. Please start again with /uni"
              );
              clearUniSession(ctx);
              return;
            }

            // Search for the token
            const buyToken = await uniswapService.findToken(
              buyTokenQuery,
              chainId
            );

            if (!buyToken) {
              await ctx.reply(
                `Token "${buyTokenQuery}" not found. Please try again with a different symbol, name, or address.`,
                {
                  reply_markup: new InlineKeyboard().text(
                    "Cancel",
                    "uni_cancel"
                  ),
                }
              );
              return;
            }

            // Check if buying the same token
            if (
              buyToken.address.toLowerCase() === sellToken.address.toLowerCase()
            ) {
              await ctx.reply(
                "You cannot swap a token for itself. Please choose a different token to buy.",
                {
                  reply_markup: new InlineKeyboard().text(
                    "Cancel",
                    "uni_cancel"
                  ),
                }
              );
              return;
            }

            // Store token in session
            ctx.session.uniSwap!.buyToken = buyToken;
            ctx.session.uniSwap!.step = "enter_amount";

            // Prompt for amount
            await ctx.reply(
              `Selected buy token: ${buyToken.symbol} (${buyToken.name})`
            );
            await ctx.reply(
              `How much ${sellToken.symbol} do you want to swap? Enter the amount:`,
              {
                reply_markup: new InlineKeyboard().text("Cancel", "uni_cancel"),
              }
            );

            logger.info(
              "Uniswap amount prompt presented to user:",
              ctx.from?.id
            );
          } catch (error) {
            console.error("Error processing buy token:", error);
            await ctx.reply("Failed to process token. Please try again.");
          }
          break;
        }

        case "enter_amount": {
          try {
            const amountText = ctx.message.text.trim();
            const amount = parseFloat(amountText);

            // Validate amount
            if (isNaN(amount) || amount <= 0) {
              await ctx.reply(
                "Please enter a valid positive number for the amount.",
                {
                  reply_markup: new InlineKeyboard().text(
                    "Cancel",
                    "uni_cancel"
                  ),
                }
              );
              return;
            }

            // Store amount in session
            ctx.session.uniSwap!.amount = amountText;

            // Get tokens from session
            const sellToken = ctx.session.uniSwap!.sellToken!;
            const buyToken = ctx.session.uniSwap!.buyToken!;
            const wallet = ctx.session.uniSwap!.wallet! as EthereumWallet;
            const chainId = ctx.session.uniSwap!.chainId!;

            // Format confirmation message
            const networkName =
              chainId === 1 ? "Ethereum Mainnet" : "Sepolia Testnet";
            const message = `Please confirm your swap:\n\nNetwork: ${networkName}\nWallet: ${wallet.address.substring(
              0,
              6
            )}...${wallet.address.substring(38)}\n\nSell: ${amountText} ${
              sellToken.symbol
            }\nBuy: ${buyToken.symbol}\n\nDo you want to proceed?`;

            // Show confirmation buttons
            await ctx.reply(message, {
              reply_markup: new InlineKeyboard()
                .text("Confirm", "uni_confirm")
                .row()
                .text("Cancel", "uni_cancel"),
            });

            logger.info(
              "Uniswap swap confirmation presented to user:",
              ctx.from?.id
            );
          } catch (error) {
            console.error("Error processing amount:", error);
            await ctx.reply("Failed to process amount. Please try again.");
          }
          break;
        }

        default:
          logger.warn(`Unhandled uni step: ${uniStep}`);
          break;
      }
    }
  });
}
