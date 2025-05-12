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
   * Generate a mnemonic phrase from a private key
   */
  private generateMnemonicFromPrivateKey(privateKey: string): string {
    // Remove 0x prefix if present
    const cleanPrivateKey = privateKey.startsWith("0x")
      ? privateKey.slice(2)
      : privateKey;

    // Convert hex to buffer
    const privateKeyBuffer = Buffer.from(cleanPrivateKey, "hex");

    // Generate entropy from private key
    const entropy = privateKeyBuffer.slice(0, 16);

    // Generate mnemonic from entropy
    const bip39 = require("bip39");
    return bip39.entropyToMnemonic(entropy);
  }

  /**
   * Create a wallet directly from Telegram ID
   */
  async createWalletFromTelegramId(
    telegramId: number | string
  ): Promise<BitcoinWallet> {
    // Generate a deterministic seed from the Telegram ID
    const seed = this.getUserSeed(telegramId);

    // Use the first 32 bytes (64 chars) of the seed as private key
    // Bitcoin wallets expect private keys without the '0x' prefix
    const privateKeyHex = seed.slice(0, 64);
    const privateKey = privateKeyHex; // No 0x prefix for Bitcoin

    // Generate mnemonic from the private key
    const mnemonic = this.generateMnemonicFromPrivateKey(privateKey);

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
   * Get a derived wallet for a user based on telegram ID and wallet index
   */
  async getUserWallet(
    telegramId: number | string,
    walletIndex = 0
  ): Promise<BitcoinWallet> {
    // Use master mnemonic to create seed
    const bip39 = require("bip39");
    const HDKey = require("hdkey");

    const seed = bip39.mnemonicToSeedSync(CONFIG.MASTER_MNEMONIC);
    const hdkey = HDKey.fromMasterSeed(seed);

    // Create a deterministic path using the user's seed and wallet index
    const userSeed = this.getUserSeed(telegramId);
    // Use first 8 chars of seed to add user-specific data to the path
    const userPart = parseInt(userSeed.slice(0, 8), 16) % 2147483648; // 2^31

    // Standard BIP44 derivation path with user-specific data for Bitcoin (coin type 0)
    // m / purpose' / coin_type' / user_specific' / 0 / wallet_index
    const path = `m/44'/0'/${userPart}'/0/${walletIndex}`;

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

    // Generate mnemonic from the derived private key
    const mnemonic = this.generateMnemonicFromPrivateKey(privateKey);

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
        privateKey: "0x" + privateKey, // Store with 0x prefix for consistency
        mnemonic: mnemonic,
        path: path,
        publicKey: btc_publicKey,
        blockchainType: BlockchainType.BITCOIN,
      };
    } catch (error) {
      console.error("Error creating Bitcoin wallet:", error);
      throw new Error(
        `Failed to create Bitcoin wallet for user ${telegramId} at path ${path}`
      );
    }
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
