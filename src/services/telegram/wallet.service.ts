import { BlockchainType, Wallet, BalanceInfo } from "../../types";
import { getBlockchainService } from "../blockchain";

export class WalletService {
  /**
   * Create a wallet directly from Telegram ID for a specific blockchain
   */
  public async createWalletFromTelegramId(
    telegramId: number,
    blockchainType: BlockchainType
  ): Promise<Wallet> {
    const service = await getBlockchainService(blockchainType);
    return service.createWalletFromTelegramId(telegramId);
  }

  /**
   * Get a user's wallet based on telegram ID for a specific blockchain
   */
  public async getUserWallet(
    telegramId: number,
    blockchainType: BlockchainType,
    walletIndex = 0
  ): Promise<Wallet> {
    const service = await getBlockchainService(blockchainType);
    return service.getUserWallet(telegramId, walletIndex);
  }

  /**
   * Get wallet balance for a given address and blockchain
   */
  public async getBalance(
    address: string,
    blockchainType: BlockchainType,
    tokenAddress?: string
  ): Promise<BalanceInfo> {
    const service = await getBlockchainService(blockchainType);
    try {
      // If no token address is provided, we'll use a default value (empty string)
      // The blockchain service implementation should handle this appropriately
      const balance = await service.getBalance(address, tokenAddress || "");
      return service.formatBalanceInfo(address, balance);
    } catch (error) {
      console.error(
        `Error in wallet service getBalance for ${blockchainType}:`,
        error
      );
      return service.formatBalanceInfo(
        address,
        "0.0",
        "Failed to fetch balance"
      );
    }
  }

  /**
   * Get wallet balance for a specific user's wallet
   * This is especially useful for Bitcoin where we need the private key
   */
  public async getBalanceForUser(
    telegramId: number,
    blockchainType: BlockchainType,
    tokenAddress?: string
  ): Promise<BalanceInfo> {
    const service = await getBlockchainService(blockchainType);
    try {
      // For Bitcoin, use the special getBalanceForUser method
      if (blockchainType === BlockchainType.BITCOIN) {
        const bitcoinService = service as any; // Type cast to access Bitcoin-specific method
        const balance = await bitcoinService.getBalanceForUser(telegramId);
        const wallet = await this.createWalletFromTelegramId(
          telegramId,
          blockchainType
        );
        return service.formatBalanceInfo(wallet.address, balance);
      }

      // For other blockchains, fall back to the regular method
      const wallet = await this.createWalletFromTelegramId(
        telegramId,
        blockchainType
      );
      return this.getBalance(wallet.address, blockchainType, tokenAddress);
    } catch (error) {
      console.error(
        `Error in wallet service getBalanceForUser for ${blockchainType}:`,
        error
      );
      return service.formatBalanceInfo(
        "(unknown)", // We don't have the address if the wallet creation failed
        "0.0",
        "Failed to fetch balance"
      );
    }
  }

  /**
   * Get balances for all wallets of a user
   */
  public async getAllBalances(telegramId: number): Promise<BalanceInfo[]> {
    try {
      const blockchainTypes = Object.values(BlockchainType);
      const balancePromises = blockchainTypes.map(async (type) => {
        const wallet = await this.createWalletFromTelegramId(
          telegramId,
          type as BlockchainType
        );
        return this.getBalance(wallet.address, type as BlockchainType);
      });

      return await Promise.all(balancePromises);
    } catch (error) {
      console.error("Error fetching all balances:", error);
      return [];
    }
  }

  /**
   * Format address for display
   */
  public async formatAddress(
    address: string,
    blockchainType: BlockchainType
  ): Promise<string> {
    const service = await getBlockchainService(blockchainType);
    return service.formatAddress(address);
  }
}

export const walletService = new WalletService();
