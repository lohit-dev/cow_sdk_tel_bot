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
  ): Promise<EthereumWallet> {
    // Generate mnemonic from user's telegram ID
    const mnemonic = this.generateUserMnemonic(telegramId);

    // Generate HD wallet from the mnemonic
    const hdNode = ethers.utils.HDNode.fromMnemonic(mnemonic);

    // Derive child wallet using standard path with wallet index
    const path = `m/44'/60'/0'/0/${walletIndex}`;
    logger.info(`Deriving wallet with path: ${path}`);

    const wallet = hdNode.derivePath(path);

    return {
      address: wallet.address,
      privateKey: wallet.privateKey,
      mnemonic,
      blockchainType: BlockchainType.ETHEREUM,
    };
  }

  /**
   * Create the primary wallet from Telegram ID (alias for getUserWallet with index 0)
   */
  async createWalletFromTelegramId(
    telegramId: number | string
  ): Promise<EthereumWallet> {
    return this.getUserWallet(telegramId, 0);
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
