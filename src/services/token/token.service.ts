import { TokenInfo } from "../../types";
import cowSepoliaTokens from "../../data/tokens/cow/testnet/sepolia.json";
import uniSepoliaTokens from "../../data/tokens/uni/testnet/sepolia.json";

export class TokenService {
  private tokensByChain: Record<number, TokenInfo[]> = {};
  private tokensByDex: Record<string, Record<number, TokenInfo[]>> = {};

  constructor() {
    this.tokensByDex = {
      cow: {
        11155111: cowSepoliaTokens.tokens,
      },
      uni: {
        11155111: uniSepoliaTokens.tokens,
      },
    };

    this.tokensByChain = {
      11155111: [...cowSepoliaTokens.tokens, ...uniSepoliaTokens.tokens],
    };
  }

  // Find token by symbol (case-insensitive)
  findTokenBySymbol(
    symbol: string,
    chainId: number,
    dex?: string
  ): TokenInfo | undefined {
    if (dex) {
      const tokens = this.tokensByDex[dex]?.[chainId] || [];
      return tokens.find(
        (token) => token.symbol.toLowerCase() === symbol.toLowerCase()
      );
    } else {
      const tokens = this.tokensByChain[chainId] || [];
      return tokens.find(
        (token) => token.symbol.toLowerCase() === symbol.toLowerCase()
      );
    }
  }

  // Find token by address (case-insensitive)
  findTokenByAddress(
    address: string,
    chainId: number,
    dex?: string
  ): TokenInfo | undefined {
    const normalizedAddress = address.toLowerCase();

    if (dex) {
      const tokens = this.tokensByDex[dex]?.[chainId] || [];
      return tokens.find(
        (token) => token.address.toLowerCase() === normalizedAddress
      );
    } else {
      const tokens = this.tokensByChain[chainId] || [];
      return tokens.find(
        (token) => token.address.toLowerCase() === normalizedAddress
      );
    }
  }

  // Search tokens by any field
  searchTokens(query: string, chainId: number, dex?: string): TokenInfo[] {
    const searchTerm = query.toLowerCase();

    let tokens: TokenInfo[] = [];
    if (dex) {
      tokens = this.tokensByDex[dex]?.[chainId] || [];
    } else {
      tokens = this.tokensByChain[chainId] || [];
    }

    return tokens.filter(
      (token) =>
        token.name.toLowerCase().includes(searchTerm) ||
        token.symbol.toLowerCase().includes(searchTerm) ||
        token.address.toLowerCase() === searchTerm
    );
  }
}
