/**
 * Cost Optimizer
 * Tracks and optimizes LLM usage costs
 */

export interface PricingModel {
  provider: string;
  model: string;
  inputPricePerToken: number; // USD per 1K tokens
  outputPricePerToken: number; // USD per 1K tokens
  fixedPricePerRequest?: number; // Optional fixed price
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  provider: string;
  model: string;
}

export interface CostReport {
  totalCost: number;
  totalRequests: number;
  totalTokens: number;
  avgCostPerRequest: number;
  avgCostPerToken: number;
  topExpensiveModels: { model: string; cost: number }[];
  costByProvider: { provider: string; cost: number }[];
  savingsFromLocalModels: number;
}

export class CostOptimizer {
  private pricing: Map<string, PricingModel> = new Map();
  private requestHistory: {
    timestamp: number;
    cost: number;
    provider: string;
    model: string;
    tokens: number;
  }[] = [];
  private maxHistorySize: number = 10000;

  // Default pricing (USD per 1K tokens)
  private defaultPricing: PricingModel[] = [
    {
      provider: "openai",
      model: "gpt-4",
      inputPricePerToken: 0.03,
      outputPricePerToken: 0.06,
    },
    {
      provider: "openai",
      model: "gpt-3.5-turbo",
      inputPricePerToken: 0.0015,
      outputPricePerToken: 0.002,
    },
    {
      provider: "anthropic",
      model: "claude-3-opus",
      inputPricePerToken: 0.015,
      outputPricePerToken: 0.075,
    },
    {
      provider: "anthropic",
      model: "claude-3-sonnet",
      inputPricePerToken: 0.003,
      outputPricePerToken: 0.015,
    },
    {
      provider: "anthropic",
      model: "claude-3-haiku",
      inputPricePerToken: 0.00025,
      outputPricePerToken: 0.00125,
    },
    {
      provider: "deepseek",
      model: "deepseek-v4-pro",
      inputPricePerToken: 0.001,
      outputPricePerToken: 0.002,
    },
    {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      inputPricePerToken: 0.0005,
      outputPricePerToken: 0.001,
    },
    {
      provider: "qwen37plus",
      model: "qwen3.7-plus",
      inputPricePerToken: 0.001,
      outputPricePerToken: 0.002,
    },
    {
      provider: "ollama",
      model: "SparkLLM/Spark-X2.5-1.7B",
      inputPricePerToken: 0,
      outputPricePerToken: 0,
    },
    {
      provider: "ollama",
      model: "llama3.1:8b",
      inputPricePerToken: 0,
      outputPricePerToken: 0,
    },
  ];

  constructor() {
    // Load default pricing
    this.defaultPricing.forEach((p) => {
      this.setPricing(
        p.provider,
        p.model,
        p.inputPricePerToken,
        p.outputPricePerToken,
      );
    });
  }

  setPricing(
    provider: string,
    model: string,
    inputPrice: number,
    outputPrice: number,
  ): void {
    this.pricing.set(`${provider}/${model}`, {
      provider,
      model,
      inputPricePerToken: inputPrice,
      outputPricePerToken: outputPrice,
    });
  }

  estimateCost(
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): CostEstimate {
    const key = `${provider}/${model}`;
    const pricing = this.pricing.get(key);

    if (!pricing) {
      // Unknown model, return zero cost estimate
      return {
        inputTokens,
        outputTokens,
        estimatedCost: 0,
        provider,
        model,
      };
    }

    const inputCost = (inputTokens / 1000) * pricing.inputPricePerToken;
    const outputCost = (outputTokens / 1000) * pricing.outputPricePerToken;
    const totalCost = inputCost + outputCost;

    return {
      inputTokens,
      outputTokens,
      estimatedCost: totalCost,
      provider,
      model,
    };
  }

  recordRequest(
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): void {
    const estimate = this.estimateCost(
      provider,
      model,
      inputTokens,
      outputTokens,
    );

    this.requestHistory.push({
      timestamp: Date.now(),
      cost: estimate.estimatedCost,
      provider,
      model,
      tokens: inputTokens + outputTokens,
    });

    // Keep history manageable
    if (this.requestHistory.length > this.maxHistorySize) {
      this.requestHistory = this.requestHistory.slice(-this.maxHistorySize);
    }
  }

  getReport(hours: number = 24): CostReport {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const recentRequests = this.requestHistory.filter(
      (r) => r.timestamp >= cutoff,
    );

    const totalCost = recentRequests.reduce((sum, r) => sum + r.cost, 0);
    const totalTokens = recentRequests.reduce((sum, r) => sum + r.tokens, 0);
    const totalRequests = recentRequests.length;

    // Group by model
    const costByModel = new Map<string, number>();
    recentRequests.forEach((r) => {
      const key = `${r.provider}/${r.model}`;
      costByModel.set(key, (costByModel.get(key) || 0) + r.cost);
    });

    const topExpensiveModels = Array.from(costByModel.entries())
      .map(([model, cost]) => ({ model, cost }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5);

    // Group by provider
    const costByProvider = new Map<string, number>();
    recentRequests.forEach((r) => {
      costByProvider.set(
        r.provider,
        (costByProvider.get(r.provider) || 0) + r.cost,
      );
    });

    const costByProviderList = Array.from(costByProvider.entries())
      .map(([provider, cost]) => ({ provider, cost }))
      .sort((a, b) => b.cost - a.cost);

    // Calculate savings from local models
    const localCost = recentRequests
      .filter((r) => r.provider === "ollama")
      .reduce((sum, r) => sum + r.cost, 0);

    // Estimate what local requests would cost with cloud models
    const avgCloudCost =
      recentRequests
        .filter((r) => r.provider !== "ollama" && r.cost > 0)
        .reduce((sum, r) => sum + r.cost, 0) /
      Math.max(1, recentRequests.filter((r) => r.provider !== "ollama").length);

    const localRequestCount = recentRequests.filter(
      (r) => r.provider === "ollama",
    ).length;
    const savingsFromLocalModels = localRequestCount * avgCloudCost;

    return {
      totalCost,
      totalRequests,
      totalTokens,
      avgCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0,
      avgCostPerToken: totalTokens > 0 ? totalCost / totalTokens : 0,
      topExpensiveModels,
      costByProvider: costByProviderList,
      savingsFromLocalModels,
    };
  }

  getCheapestModel(
    inputTokens: number,
    outputTokens: number,
  ): PricingModel | null {
    let cheapest: PricingModel | null = null;
    let minCost = Infinity;

    this.pricing.forEach((pricing) => {
      const cost = this.estimateCost(
        pricing.provider,
        pricing.model,
        inputTokens,
        outputTokens,
      ).estimatedCost;
      if (cost < minCost) {
        minCost = cost;
        cheapest = pricing;
      }
    });

    return cheapest;
  }

  optimizeForCost(inputTokens: number, outputTokens: number): string {
    const cheapest = this.getCheapestModel(inputTokens, outputTokens);
    if (cheapest) {
      return `${cheapest.provider}/${cheapest.model}`;
    }
    return "unknown";
  }

  getPricingList(): PricingModel[] {
    return Array.from(this.pricing.values());
  }

  reset(): void {
    this.requestHistory = [];
  }
}
