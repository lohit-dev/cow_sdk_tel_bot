import {
  Garden,
  GardenConfigWithWallets,
  OrderActions,
  SecretManager,
  SwapParams,
} from "@gardenfi/core";
import { Asset, SupportedAssets } from "@gardenfi/orderbook";
import { DigestKey, Environment } from "@gardenfi/utils";
import { Bot } from "grammy";
import { BotContext } from "../telegram/telegram.service";
import logger from "../../utils/logger";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia, sepolia } from "viem/chains";
import { CONFIG } from "../../config";
import { ethers } from "ethers";
import { BlockchainType } from "../../types";

export interface WalletData {
  address: string;
  privateKey?: string;
  publicKey?: string;
  mnemonic?: string;
  chain: string;
  balance?: string;
  connected: boolean;
  contractDeployed?: boolean;
  client?: any;
}

export interface SwapResult {
  success: boolean;
  message: string;
  orderId?: string;
  depositAddress?: string;
  txHash?: string;
  isBitcoinSource?: boolean;
  isBitcoinDestination?: boolean;
  fromAsset?: {
    symbol: string;
    chain: string;
  };
  toAsset?: {
    symbol: string;
    chain: string;
  };
  sendAmount?: string;
  receiveAmount?: string;
  error?: any;
}

export class GardenService {
  private garden!: Garden;
  private bot: Bot<BotContext>;
  private orderUserMap: Map<string, number>;
  private listenersInitialized: boolean = false;
  private environment: Environment;
  private digestKey: string;

  constructor(bot: Bot<BotContext>) {
    this.bot = bot;
    this.orderUserMap = new Map();
    this.environment = Environment.TESTNET;

    // Generate a random digest key
    this.digestKey = DigestKey.generateRandom().val?.digestKey!;

    // Initialize Garden instance
    this.initGarden();

    // Set up event listeners
    this.setupEventListeners();
  }

  /**
   * Initialize Garden instance with digest key
   */
  private initGarden() {
    try {
      // Initialize Garden with the digest key but without wallets
      // We'll add wallets dynamically when needed
      this.garden = Garden.fromWallets({
        environment: this.environment,
        digestKey: this.digestKey,
        wallets: {},
      });

      logger.info("Garden instance initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize Garden instance:", error);
      throw error;
    }
  }

  /**
   * Set up event listeners for Garden
   */
  private setupEventListeners() {
    if (this.listenersInitialized) return;

    this.garden.on("error", (order, error) => {
      logger.error(
        `Garden error for order ID: ${order.create_order.create_id}`,
        error
      );

      // Notify user about the error if we have their ID
      const userId = this.orderUserMap.get(order.create_order.create_id);
      if (userId) {
        this.bot.api
          .sendMessage(
            userId,
            `⚠️ Error with your swap (ID: ${order.create_order.create_id}):\n${
              error || JSON.stringify(error)
            }`
          )
          .catch((err) => {
            logger.error("Failed to send error notification to user:", err);
          });
      }
    });

    this.garden.on("success", async (order, action, txHash) => {
      logger.info(
        `Garden success for order ID: ${order.create_order.create_id}, Action: ${action}, TxHash: ${txHash}`
      );

      // Notify user about the success if we have their ID
      const userId = this.orderUserMap.get(order.create_order.create_id);
      if (userId) {
        // Format message based on action type
        let message = "";

        if (action === OrderActions.Initiate) {
          message = `🔄 Swap initiated successfully!\n\nOrder ID: \`${order.create_order.create_id}\`\nTransaction: \`${txHash}\`\n\nYour funds have been locked in the contract. The bot will automatically complete the swap when conditions are met.`;
        } else if (action === OrderActions.Redeem) {
          message = `✅ Swap completed successfully!\n\nOrder ID: \`${order.create_order.create_id}\`\nTransaction: \`${txHash}\`\n\nYour funds have been sent to your destination wallet.`;
        } else if (action === OrderActions.Refund) {
          message = `🔙 Swap refunded!\n\nOrder ID: \`${order.create_order.create_id}\`\nTransaction: \`${txHash}\`\n\nYour funds have been returned to your source wallet.`;
        }

        if (message) {
          this.bot.api
            .sendMessage(userId, message, {
              parse_mode: "Markdown",
            })
            .catch((err) => {
              logger.error("Failed to send success notification to user:", err);
            });
        }
      }
    });

    // Start the execution loop to handle redeems and refunds
    this.garden.execute().catch((error) => {
      logger.error("Error in Garden execution loop:", error);
    });

    this.listenersInitialized = true;
    logger.info("Garden event listeners initialized");
  }

  /**
   * Configure wallets for Garden
   */
  private configureWallets(evmPrivateKey?: string, bitcoinPrivateKey?: string) {
    try {
      const wallets: any = {};

      // Configure EVM wallet if provided
      if (evmPrivateKey) {
        // Create Viem account from private key
        const account = privateKeyToAccount(
          `0x${evmPrivateKey.replace(/^0x/, "")}`
        );

        // Create wallet client
        const evmWalletClient = createWalletClient({
          account,
          chain: this.environment === Environment.TESTNET ? sepolia : undefined,
          transport: http(),
        });

        wallets.evm = evmWalletClient;
      }

      // Create a new Garden instance with the updated wallets
      this.garden = Garden.fromWallets({
        environment: this.environment,
        digestKey: this.digestKey,
        wallets: wallets,
      });

      // Re-setup event listeners for the new instance
      this.setupEventListeners();

      return wallets;
    } catch (error) {
      logger.error("Failed to configure wallets:", error);
      throw error;
    }
  }

  /**
   * Helper to construct order pair string
   */
  private constructOrderPair(fromAsset: Asset, toAsset: Asset): string {
    return `${fromAsset.chain}:${fromAsset.atomicSwapAddress}::${toAsset.chain}:${toAsset.atomicSwapAddress}`;
  }

  /**
   * Execute a swap between Bitcoin and EVM chains
   */
  public async executeSwap(
    userId: number,
    fromChain: BlockchainType,
    toChain: BlockchainType,
    fromAssetSymbol: string,
    toAssetSymbol: string,
    sendAmount: string,
    privateKey: string,
    btcAddress?: string
  ): Promise<SwapResult> {
    try {
      logger.info(
        `Executing swap: ${fromChain} ${fromAssetSymbol} -> ${toChain} ${toAssetSymbol}`
      );

      // Configure wallets based on the chains involved
      if (
        fromChain === BlockchainType.ETHEREUM &&
        toChain === BlockchainType.BITCOIN
      ) {
        // ETH -> BTC: Need EVM wallet
        this.configureWallets(privateKey);
      } else if (
        fromChain === BlockchainType.BITCOIN &&
        toChain === BlockchainType.ETHEREUM
      ) {
        // BTC -> ETH: Need Bitcoin wallet
        this.configureWallets(undefined, privateKey);
      }

      // Determine the assets based on chain and symbol
      let fromAsset: Asset | undefined;
      let toAsset: Asset | undefined;

      // Find the assets in the supported assets
      if (
        fromChain === BlockchainType.ETHEREUM &&
        toChain === BlockchainType.BITCOIN
      ) {
        // ETH -> BTC
        fromAsset =
          this.environment === Environment.TESTNET
            ? SupportedAssets.testnet.ethereum_sepolia_WBTC
            : SupportedAssets.mainnet.ethereum_WBTC;
        toAsset =
          this.environment === Environment.TESTNET
            ? SupportedAssets.testnet.bitcoin_testnet_BTC
            : SupportedAssets.mainnet.bitcoin_BTC;
      } else if (
        fromChain === BlockchainType.BITCOIN &&
        toChain === BlockchainType.ETHEREUM
      ) {
        // BTC -> ETH
        toAsset =
          this.environment === Environment.TESTNET
            ? SupportedAssets.testnet.ethereum_sepolia_WBTC
            : SupportedAssets.mainnet.ethereum_WBTC;
        fromAsset =
          this.environment === Environment.TESTNET
            ? SupportedAssets.testnet.bitcoin_testnet_BTC
            : SupportedAssets.mainnet.bitcoin_BTC;
      } else {
        throw new Error(
          `Unsupported chain combination: ${fromChain} -> ${toChain}`
        );
      }

      if (!fromAsset || !toAsset) {
        throw new Error(
          `Assets not found for ${fromChain} ${fromAssetSymbol} -> ${toChain} ${toAssetSymbol}`
        );
      }

      // Construct the order pair
      const orderPair = this.constructOrderPair(fromAsset, toAsset);

      // Get quote
      logger.info(`Getting quote for ${orderPair} with amount ${sendAmount}`);
      const quoteResult = await this.garden.quote.getQuote(
        orderPair,
        Number(sendAmount),
        false
      );

      if (quoteResult.error) {
        logger.error("Quote error:", quoteResult.error);
        return {
          success: false,
          message: `Failed to get quote: ${quoteResult.error}`,
          error: quoteResult.error,
        };
      }

      // Choose the first quote
      const quotes = Object.entries(quoteResult.val.quotes);
      if (quotes.length === 0) {
        return {
          success: false,
          message: "No quotes available for this swap",
        };
      }

      const [strategyId, receiveAmount] = quotes[0];

      // Prepare swap parameters
      const swapParams: SwapParams = {
        fromAsset,
        toAsset,
        sendAmount,
        receiveAmount: receiveAmount.toString(),
        additionalData: {
          strategyId,
          // Add BTC address if destination is Bitcoin
          ...(toChain === BlockchainType.BITCOIN && btcAddress
            ? { btcAddress }
            : {}),
        },
      };

      // Execute the swap
      logger.info("Creating swap with params:", swapParams);
      const swapResult = await this.garden.swap(swapParams);

      if (swapResult.error) {
        logger.error("Swap creation error:", swapResult.error);
        return {
          success: false,
          message: `Failed to create swap: ${swapResult.error}`,
          error: swapResult.error,
        };
      }

      const order = swapResult.val;
      const orderId = order.create_order.create_id;

      // Store the user ID for this order
      this.orderUserMap.set(orderId, userId);

      // Determine if this is a Bitcoin source or destination
      const isBitcoinSource = fromChain === BlockchainType.BITCOIN;
      const isBitcoinDestination = toChain === BlockchainType.BITCOIN;

      // For EVM to any chain, we need to initiate the swap
      let txHash = undefined;

      if (fromChain === BlockchainType.ETHEREUM) {
        // Initiate the swap for EVM source
        logger.info(`Initiating EVM swap for order ${orderId}`);
        const initResult = await this.garden.evmHTLC?.initiate(order);

        if (initResult?.error) {
          logger.error("EVM initiation error:", initResult?.error);
          return {
            success: false,
            message: `Failed to initiate swap: ${initResult?.error}`,
            error: initResult?.error,
          };
        }

        txHash = initResult?.val;
      }

      // For Bitcoin source, we need to return the deposit address
      let depositAddress = undefined;

      if (isBitcoinSource) {
        // Get the deposit address for Bitcoin source
        depositAddress = order.create_order.initiator_destination_address;
      }

      return {
        success: true,
        message: "Swap created successfully",
        orderId,
        depositAddress,
        txHash,
        isBitcoinSource,
        isBitcoinDestination,
        fromAsset: {
          symbol: fromAssetSymbol,
          chain: fromChain,
        },
        toAsset: {
          symbol: toAssetSymbol,
          chain: toChain,
        },
        sendAmount,
        receiveAmount: receiveAmount.toString(),
      };
    } catch (error) {
      logger.error("Error executing swap:", error);
      return {
        success: false,
        message: `Error executing swap: ${
          (error as Error).message || JSON.stringify(error)
        }`,
        error,
      };
    }
  }
}

// Export a singleton instance
export const gardenService = new GardenService(null as any); // Will be initialized properly in index.ts
