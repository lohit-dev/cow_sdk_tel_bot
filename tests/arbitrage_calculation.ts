import { Token, QUOTER_ADDRESSES } from "@uniswap/sdk-core";
import { ethers } from "ethers";

// Network Configuration
const NETWORKS = {
  ethereum: {
    chainId: 1,
    rpcUrl: process.env.ETHEREUM_RPC || "https://eth.llamarpc.com",
    name: "Ethereum",
  },
  arbitrum: {
    chainId: 42161,
    rpcUrl: process.env.ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc",
    name: "Arbitrum",
  },
} as const;

// Token Definitions using Uniswap SDK Token class
const TOKENS = {
  ethereum: {
    WETH: new Token(
      1,
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      18,
      "WETH",
      "Wrapped Ether"
    ),
    SEED: new Token(
      1,
      "0x5eed99d066a8CaF10f3E4327c1b3D8b673485eED",
      18,
      "SEED",
      "Seed Token"
    ),
  },
  arbitrum: {
    WETH: new Token(
      42161,
      "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      18,
      "WETH",
      "Wrapped Ether"
    ),
    SEED: new Token(
      42161,
      "0x86f65121804D2Cdbef79F9f072D4e0c2eEbABC08",
      18,
      "SEED",
      "Seed Token"
    ),
  },
} as const;

// Pool configurations with fee tiers
const POOL_CONFIGS = {
  ethereum: [
    {
      address: "0xd36ae827a9b62b8a32f0032cad1251b94fab1dd4",
    },
  ],
  arbitrum: [
    {
      address: "0xf9f588394ec5c3b05511368ce016de5fd3812446",
    },
  ],
};

const TRADE_AMOUNT = "1000000000000000000"; // 1 token (18 decimals)

// Simplified Quoter V2 ABI - only parameter-based functions
const QUOTER_V2_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
];

// Pool ABI for getting pool state
const POOL_ABI = [
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() external view returns (uint128)",
  "function fee() external view returns (uint24)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
];

interface NetworkConfig {
  chainId: number;
  provider: ethers.providers.JsonRpcProvider;
  quoter: ethers.Contract;
  tokens: {
    WETH: Token;
    SEED: Token;
  };
  name: string;
}

interface PoolConfig {
  address: string;
}

interface QuoteResult {
  network: string;
  poolAddress: string;
  feeTier: string;
  seedToWeth: string; // 1 SEED = X WETH
  wethToSeed: string; // 1 WETH = X SEED
  actualFee: number;
  tokenOrder: string;
  gasEstimate: number;
}

class UniswapQuoterScanner {
  private networks: Map<string, NetworkConfig> = new Map();
  private poolConfigs: Map<string, PoolConfig[]> = new Map();

  constructor() {
    this.initializeNetworks();
    this.initializePoolConfigs();
  }

  private initializeNetworks(): void {
    const ethProvider = new ethers.providers.JsonRpcProvider(
      NETWORKS.ethereum.rpcUrl
    );
    const ethQuoter = new ethers.Contract(
      QUOTER_ADDRESSES[NETWORKS.ethereum.chainId],
      QUOTER_V2_ABI,
      ethProvider
    );

    this.networks.set("ethereum", {
      chainId: NETWORKS.ethereum.chainId,
      provider: ethProvider,
      quoter: ethQuoter,
      tokens: TOKENS.ethereum,
      name: NETWORKS.ethereum.name,
    });

    const arbProvider = new ethers.providers.JsonRpcProvider(
      NETWORKS.arbitrum.rpcUrl
    );
    const arbQuoter = new ethers.Contract(
      QUOTER_ADDRESSES[NETWORKS.arbitrum.chainId],
      QUOTER_V2_ABI,
      arbProvider
    );

    this.networks.set("arbitrum", {
      chainId: NETWORKS.arbitrum.chainId,
      provider: arbProvider,
      quoter: arbQuoter,
      tokens: TOKENS.arbitrum,
      name: NETWORKS.arbitrum.name,
    });
  }

  private initializePoolConfigs(): void {
    this.poolConfigs.set("ethereum", POOL_CONFIGS.ethereum);
    this.poolConfigs.set("arbitrum", POOL_CONFIGS.arbitrum);
  }

  private async getPoolInfo(
    poolAddress: string,
    network: NetworkConfig
  ): Promise<{
    isValid: boolean;
    actualFee?: number;
    token0?: string;
    token1?: string;
    token0IsSeed?: boolean;
  }> {
    try {
      const poolContract = new ethers.Contract(
        poolAddress,
        POOL_ABI,
        network.provider
      );
      const [token0, token1, fee, liquidity] = await Promise.all([
        poolContract.token0(),
        poolContract.token1(),
        poolContract.fee(),
        poolContract.liquidity(),
      ]);

      // Check if this is a SEED/WETH pool
      const token0Lower = token0.toLowerCase();
      const token1Lower = token1.toLowerCase();
      const seedLower = network.tokens.SEED.address.toLowerCase();
      const wethLower = network.tokens.WETH.address.toLowerCase();

      const hasSeed = token0Lower === seedLower || token1Lower === seedLower;
      const hasWeth = token0Lower === wethLower || token1Lower === wethLower;

      if (!hasSeed || !hasWeth || liquidity.eq(0)) {
        return { isValid: false };
      }

      return {
        isValid: true,
        actualFee: fee,
        token0,
        token1,
        token0IsSeed: token0Lower === seedLower,
      };
    } catch (error: any) {
      return { isValid: false };
    }
  }

  async analyzeNetwork(networkKey: string): Promise<QuoteResult | null> {
    const network = this.networks.get(networkKey);
    const poolConfigs = this.poolConfigs.get(networkKey);

    if (!network || !poolConfigs || poolConfigs.length === 0) {
      return null;
    }

    console.log(`\n${network.name.toUpperCase()} ANALYSIS`);
    console.log("=".repeat(50));

    const poolConfig = poolConfigs[0]; // Use first pool
    const poolInfo = await this.getPoolInfo(poolConfig.address, network);

    if (
      !poolInfo.isValid ||
      poolInfo.actualFee === undefined ||
      poolInfo.token0IsSeed === undefined
    ) {
      console.log(`❌ Invalid pool: ${poolConfig.address}`);
      return null;
    }

    console.log(`Actual Fees: ${poolInfo.actualFee / 10000}%`);
    console.log(
      `Token Order: ${poolInfo.token0IsSeed ? "SEED/WETH" : "WETH/SEED"}`
    );

    // Get quotes for both directions
    const seedIn = network.tokens.SEED;
    const wethIn = network.tokens.WETH;
    const seedOut = network.tokens.SEED;
    const wethOut = network.tokens.WETH;

    try {
      console.log(`Quote Params:`);
      console.log(`  TokenIn: ${seedIn.address} (SEED)`);
      console.log(`  TokenOut: ${wethOut.address} (WETH)`);
      console.log(`  AmountIn: 1 SEED`);
      console.log(`  Fee: ${poolInfo.actualFee}`);

      // SEED → WETH quote
      const seedToWethQuote =
        await network.quoter.callStatic.quoteExactInputSingle(
          seedIn.address,
          wethOut.address,
          poolInfo.actualFee,
          TRADE_AMOUNT,
          0
        );

      // WETH → SEED quote
      const wethToSeedQuote =
        await network.quoter.callStatic.quoteExactInputSingle(
          wethIn.address,
          seedOut.address,
          poolInfo.actualFee,
          TRADE_AMOUNT,
          0
        );

      const seedToWethRate = ethers.utils.formatUnits(seedToWethQuote, 18);
      const wethToSeedRate = ethers.utils.formatUnits(wethToSeedQuote, 18);

      console.log(`1 SEED = ${parseFloat(seedToWethRate).toFixed(8)} WETH`);
      console.log(`1 WETH = ${parseFloat(wethToSeedRate).toFixed(2)} SEED`);

      // Estimate gas based on network
      const gasEstimate = networkKey === "ethereum" ? 150000 : 80000; // Ethereum vs Arbitrum

      return {
        network: network.name,
        poolAddress: poolConfig.address,
        feeTier: `${poolInfo.actualFee / 10000}%`,
        seedToWeth: seedToWethRate,
        wethToSeed: wethToSeedRate,
        actualFee: poolInfo.actualFee,
        tokenOrder: poolInfo.token0IsSeed ? "SEED/WETH" : "WETH/SEED",
        gasEstimate,
      };
    } catch (error: any) {
      console.log(`❌ Quote failed: ${error.message}`);
      return null;
    }
  }

  async scanArbitrageOpportunities(): Promise<void> {
    console.log("🔍 UNISWAP ARBITRAGE SCANNER");
    console.log("=".repeat(50));

    // Analyze each network
    const ethereumResult = await this.analyzeNetwork("ethereum");
    const arbitrumResult = await this.analyzeNetwork("arbitrum");

    if (!ethereumResult || !arbitrumResult) {
      console.log("\n❌ INSUFFICIENT DATA FOR ARBITRAGE");
      return;
    }

    // Arbitrage Analysis
    console.log("\n\nARBITRAGE OPPORTUNITY ANALYSIS");
    console.log("=".repeat(50));

    const ethSeedPrice = parseFloat(ethereumResult.seedToWeth);
    const arbSeedPrice = parseFloat(arbitrumResult.seedToWeth);

    // Determine best buy/sell
    let buyNetwork, sellNetwork, buyPrice, sellPrice, buyGas, sellGas;
    if (ethSeedPrice < arbSeedPrice) {
      buyNetwork = "Ethereum";
      sellNetwork = "Arbitrum";
      buyPrice = ethSeedPrice;
      sellPrice = arbSeedPrice;
      buyGas = ethereumResult.gasEstimate;
      sellGas = arbitrumResult.gasEstimate;
    } else {
      buyNetwork = "Arbitrum";
      sellNetwork = "Ethereum";
      buyPrice = arbSeedPrice;
      sellPrice = ethSeedPrice;
      buyGas = arbitrumResult.gasEstimate;
      sellGas = ethereumResult.gasEstimate;
    }

    console.log(
      `Buy SEED on ${buyNetwork} at ${buyPrice.toFixed(
        8
      )} WETH | Gas estimate: ${buyGas.toLocaleString()} units`
    );
    console.log(
      `Sell SEED on ${sellNetwork} at ${sellPrice.toFixed(
        8
      )} WETH | Gas estimate: ${sellGas.toLocaleString()} units`
    );
  }

  async startMonitoring(intervalMinutes: number = 5): Promise<void> {
    console.log(`🔄 Starting monitoring (${intervalMinutes} min intervals)\n`);

    while (true) {
      const timestamp = new Date().toLocaleString();
      console.log(`\n⏰ ${timestamp}`);
      console.log("=".repeat(70));

      await this.scanArbitrageOpportunities();

      console.log(`\n⏳ Next scan in ${intervalMinutes} minutes...`);
      await new Promise((resolve) =>
        setTimeout(resolve, intervalMinutes * 60 * 1000)
      );
    }
  }
}

// Export the scanner class and configuration
export { UniswapQuoterScanner, NETWORKS, TOKENS, POOL_CONFIGS };

// Main execution
async function main(): Promise<void> {
  const scanner = new UniswapQuoterScanner();

  console.log(`✅ Scanner initialized`);
  console.log(`Trade amount: 1 SEED token`);
  console.log(`Networks: Ethereum, Arbitrum`);

  // Run single scan
  await scanner.scanArbitrageOpportunities();

  // Uncomment for continuous monitoring:
  // await scanner.startMonitoring(5);
}

if (require.main === module) {
  main().catch(console.error);
}
