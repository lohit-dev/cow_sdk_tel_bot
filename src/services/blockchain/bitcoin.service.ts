import { BlockchainType, BitcoinWallet } from "../../types";
import { BlockchainService } from "./base.service";
import { CONFIG } from "../../config";
import { createHmac } from "crypto";
import {
  BitcoinWallet as CatalogBitcoinWallet,
  BitcoinNetwork,
  BitcoinProvider,
} from "@catalogfi/wallets";

export class BitcoinService extends BlockchainService<BitcoinWallet> {
  readonly blockchainType = BlockchainType.BITCOIN;
  readonly symbol = "BTC";
  private network: BitcoinNetwork;

  constructor() {
    super();
    this.network = BitcoinNetwork.Testnet;
  }

  /**
   * Generate a deterministic seed from Telegram ID + server secret
   */
  private getUserSeed(telegramId: number | string): string {
    const hmac = createHmac("sha256", CONFIG.SERVER_SECRET);
    hmac.update(telegramId.toString());
    return hmac.digest("hex");
  }

  /**
   * Generate a mnemonic from user's seed
   */
  private generateUserMnemonic(telegramId: number | string): string {
    const userSeed = this.getUserSeed(telegramId);
    const seedBuffer = Buffer.from(userSeed, "hex");

    // Generate mnemonic from entropy using BIP39
    const bip39 = require("bip39");
    return bip39.entropyToMnemonic(seedBuffer);
  }

  /**
   * Get a wallet for a user based on telegram ID and wallet index
   * This is the single unified method for all wallet creation
   */
  async getUserWallet(
    telegramId: number | string,
    walletIndex = 0
  ): Promise<BitcoinWallet> {
    // Generate mnemonic from user's telegram ID
    const mnemonic = this.generateUserMnemonic(telegramId);

    // Generate HD wallet from the mnemonic
    const bip39 = require("bip39");
    const HDKey = require("hdkey");

    // Convert mnemonic to seed
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const hdkey = HDKey.fromMasterSeed(seed);

    // Derive child wallet using standard BIP44 path with wallet index for Bitcoin (coin type 0)
    const path = `m/44'/0'/0'/0/${walletIndex}`;

    const childKey = hdkey.derive(path);

    // Add null check for privateKey
    if (!childKey.privateKey) {
      throw new Error(
        `Failed to derive private key for user ${telegramId} at path ${path}`
      );
    }

    // Get private key without 0x prefix for Bitcoin
    const privateKeyHex = childKey.privateKey.toString("hex");
    const privateKey = privateKeyHex; // No 0x prefix for Bitcoin

    // Use CatalogFi wallet library to create a Bitcoin wallet from the private key
    try {
      const bitcoinWallet = CatalogBitcoinWallet.fromPrivateKey(
        privateKey, // Pass without 0x prefix
        new BitcoinProvider(this.network)
      );

      const btc_address = await bitcoinWallet.getAddress();
      const btc_publicKey = await bitcoinWallet.getPublicKey();

      return {
        address: btc_address,
        blockchainType: BlockchainType.BITCOIN,
        mnemonic: mnemonic,
        privateKey: "0x" + privateKey, // Store with 0x prefix for consistency
        publicKey: btc_publicKey,
      };
    } catch (error) {
      console.error("Error creating Bitcoin wallet:", error);
      throw new Error(`Failed to create Bitcoin wallet for user ${telegramId}`);
    }
  }

  /**
   * Create the primary wallet from Telegram ID (alias for getUserWallet with index 0)
   */
  async createWalletFromTelegramId(
    telegramId: number | string
  ): Promise<BitcoinWallet> {
    return this.getUserWallet(telegramId, 0);
  }

  /**
   * Get wallet balance for a specific Telegram user's wallet
   * @param telegramId The Telegram ID of the user
   */
  async getBalanceForUser(telegramId: number | string): Promise<string> {
    try {
      // Get the wallet for this user
      const wallet = await this.createWalletFromTelegramId(telegramId);

      // Create a Bitcoin wallet with the private key
      const privateKey = wallet.privateKey.startsWith("0x")
        ? wallet.privateKey.slice(2) // Remove 0x prefix if present
        : wallet.privateKey;

      const bitcoinWallet = CatalogBitcoinWallet.fromPrivateKey(
        privateKey,
        new BitcoinProvider(this.network)
      );

      // Use the wallet's built-in getBalance method
      const balance = await bitcoinWallet.getBalance();

      // Return the balance as a string
      return balance.toString();
    } catch (error) {
      console.error("Error fetching Bitcoin balance:", error);
      return "0.0 (Network error)";
    }
  }

  getBalance(address: string): Promise<string> {
    throw new Error(
      "Method not implemented and not needed for bitcoin atleast as we have getBalanceForUser"
    );
  }

  /**
   * Format an address for display by shortening it
   */
  formatAddress(address: string): string {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }
}
