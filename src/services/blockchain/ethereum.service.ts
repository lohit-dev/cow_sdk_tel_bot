import { ethers } from "ethers";
import { BlockchainType, EthereumWallet } from "../../types";
import { BlockchainService } from "./base.service";
import { CONFIG } from "../../config";
import { createHmac } from "crypto";
import logger from "../../utils/logger";

export class EthereumService extends BlockchainService<EthereumWallet> {
  readonly blockchainType = BlockchainType.ETHEREUM;
  readonly symbol = "ETH";
  private provider: ethers.providers.JsonRpcProvider;

  constructor() {
    super();
    this.provider = new ethers.providers.JsonRpcProvider(
      CONFIG.RPC_URL ||
        "https://eth-sepolia.g.alchemy.com/v2/zN3JM2LnBeD4lFHMlO_iA8IoQA8Ws9_r"
    );
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
    // Note: bip39 requires specific entropy lengths (128, 160, 192, 224, or 256 bits)
    // We'll use the first 16 bytes (128 bits) for a 12-word mnemonic
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
  ): Promise<EthereumWallet> {
    const seed = this.getUserSeed(telegramId);

    // Use the first 32 bytes (64 chars) of the seed as private key
    const privateKey = "0x" + seed.slice(0, 64);
    const wallet = new ethers.Wallet(privateKey);

    // Generate mnemonic from the private key
    const mnemonic = this.generateMnemonicFromPrivateKey(privateKey);

    return {
      address: wallet.address,
      privateKey,
      mnemonic,
      blockchainType: BlockchainType.ETHEREUM,
    };
  }

  /**
   * Get a derived wallet for a user based on telegram ID and wallet index
   */
  async getUserWallet(
    telegramId: number | string,
    walletIndex = 0
  ): Promise<EthereumWallet> {
    // Use master mnemonic to create seed
    const bip39 = require("bip39");
    const HDKey = require("hdkey");

    const seed = bip39.mnemonicToSeedSync(CONFIG.MASTER_MNEMONIC);
    const hdkey = HDKey.fromMasterSeed(seed);

    // Create a deterministic path using the user's seed and wallet index
    const userSeed = this.getUserSeed(telegramId);
    // Use first 8 chars of seed to add user-specific data to the path
    const userPart = parseInt(userSeed.slice(0, 8), 16) % 2147483648; // 2^31

    // Standard BIP44 derivation path with user-specific data
    // m / purpose' / coin_type' / account
    // ' / 0 / wallet_index
    const path = `m/44'/60'/${userPart}'/0/${walletIndex}`;
    logger.info(`The base derivation path is: ${path}`);

    const childKey = hdkey.derive(path);

    // Add null check for privateKey
    if (!childKey.privateKey) {
      throw new Error(
        `Failed to derive private key for user ${telegramId} at path ${path}`
      );
    }

    const privateKey = "0x" + childKey.privateKey.toString("hex");
    const wallet = new ethers.Wallet(privateKey);

    // Generate mnemonic from the derived private key
    const mnemonic = this.generateMnemonicFromPrivateKey(privateKey);

    return {
      address: wallet.address,
      privateKey,
      path,
      mnemonic,
      blockchainType: BlockchainType.ETHEREUM,
    };
  }

  /**
   * Get wallet balance
   */
  async getBalance(address: string, tokenAddress?: string): Promise<string> {
    try {
      // If no token address or empty string, get native ETH balance
      if (!tokenAddress || tokenAddress === "") {
        const balance = await this.provider.getBalance(address);
        return ethers.utils.formatEther(balance);
      }

      // Otherwise, get ERC20 token balance
      const erc20Abi = [
        "function balanceOf(address owner) view returns (uint256)",
        "function decimals() view returns (uint8)",
      ];
      const contract = new ethers.Contract(
        tokenAddress,
        erc20Abi,
        this.provider
      );
      const balance = await contract.balanceOf(address);
      const decimals = await contract.decimals();

      return ethers.utils.formatUnits(balance, decimals);
    } catch (error) {
      logger.error(`Error getting balance for ${address}: ${error}`);
      return "0.0";
    }
  }

  /**
   * Format an address for display by shortening it
   */
  formatAddress(address: string): string {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }
}
