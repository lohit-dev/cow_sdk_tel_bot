// src/services/token/token.service.ts
import { SupportedChainId } from "@cowprotocol/cow-sdk";
import { TokenInfo } from "../../types";
import sepoliaTokens from "../../data/tokens/testnet/sepolia.json";
// Import other token lists as needed

export class TokenService {
  private tokensByChain: Record<number, TokenInfo[]> = {};

  constructor() {
    // Initialize token lists
    this.tokensByChain = {
      11155111: sepoliaTokens.tokens, // Sepolia
    };
  }

  // Find token by symbol (case-insensitive)
  findTokenBySymbol(symbol: string, chainId: number): TokenInfo | undefined {
    const tokens = this.tokensByChain[chainId] || [];
    return tokens.find(
      (token) => token.symbol.toLowerCase() === symbol.toLowerCase()
    );
  }

  // Find token by address (case-insensitive)
  findTokenByAddress(address: string, chainId: number): TokenInfo | undefined {
    const normalizedAddress = address.toLowerCase();
    const tokens = this.tokensByChain[chainId] || [];
    return tokens.find(
      (token) => token.address.toLowerCase() === normalizedAddress
    );
  }

  // Search tokens by any field
  searchTokens(query: string, chainId: number): TokenInfo[] {
    const searchTerm = query.toLowerCase();
    const tokens = this.tokensByChain[chainId] || [];

    return tokens.filter(
      (token) =>
        token.name.toLowerCase().includes(searchTerm) ||
        token.symbol.toLowerCase().includes(searchTerm) ||
        token.address.toLowerCase() === searchTerm
    );
  }
}
