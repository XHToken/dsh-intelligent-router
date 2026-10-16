/**
 * Monitoring Dashboard
 * Tracks metrics and provides insights for LLM routing
 */

export interface RoutingMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  fallbackCount: number;
  avgLatency: number;
  totalTokens: number;
  totalCost: number;
}

export interface MemberMetrics {
  memberId: string;
  provider: string;
  model: string;
  requests: number;
  successes: number;
  failures: number;
  fallbacks: number;
  avgLatency: number;
  tokensUsed: number;
  cost: number;
  lastUsed: number;
}

export interface TimeSeriesData {
  timestamp: number;
  requests: number;
  latency: number;
  tokens: number;
  cost: number;
}

export class MonitoringDashboard {
  private metrics: RoutingMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    fallbackCount: 0,
    avgLatency: 0,
    totalTokens: 0,
    totalCost: 0,
  };

  private memberMetrics: Map<string, MemberMetrics> = new Map();
  private timeSeries: TimeSeriesData[] = [];
  private maxTimeSeriesPoints: number = 1000;

  recordRequest(
    memberId: string,
    latency: number,
    tokens: number,
    cost: number,
    success: boolean,
    fallback: boolean = false,
  ): void {
    // Update global metrics
    this.metrics.totalRequests++;
    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }
    if (fallback) {
      this.metrics.fallbackCount++;
    }

    // Update average latency
    this.metrics.avgLatency =
      (this.metrics.avgLatency * (this.metrics.totalRequests - 1) + latency) /
      this.metrics.totalRequests;

    this.metrics.totalTokens += tokens;
    this.metrics.totalCost += cost;

    // Update member metrics
    let member = this.memberMetrics.get(memberId);
    if (!member) {
      member = {
        memberId,
        provider: "",
        model: "",
        requests: 0,
        successes: 0,
        failures: 0,
        fallbacks: 0,
        avgLatency: 0,
        tokensUsed: 0,
        cost: 0,
        lastUsed: 0,
      };
      this.memberMetrics.set(memberId, member);
    }

    member.requests++;
    if (success) member.successes++;
    else member.failures++;
    if (fallback) member.fallbacks++;
    member.avgLatency =
      (member.avgLatency * (member.requests - 1) + latency) / member.requests;
    member.tokensUsed += tokens;
    member.cost += cost;
    member.lastUsed = Date.now();

    // Record time series
    this.timeSeries.push({
      timestamp: Date.now(),
      requests: 1,
      latency,
      tokens,
      cost,
    });

    // Keep only recent data
    if (this.timeSeries.length > this.maxTimeSeriesPoints) {
      this.timeSeries = this.timeSeries.slice(-this.maxTimeSeriesPoints);
    }
  }

  updateMemberInfo(memberId: string, provider: string, model: string): void {
    const member = this.memberMetrics.get(memberId);
    if (member) {
      member.provider = provider;
      member.model = model;
    }
  }

  getMetrics(): RoutingMetrics {
    return { ...this.metrics };
  }

  getMemberMetrics(memberId: string): MemberMetrics | undefined {
    return this.memberMetrics.get(memberId);
  }

  getAllMemberMetrics(): MemberMetrics[] {
    return Array.from(this.memberMetrics.values());
  }

  getTimeSeries(hours: number = 1): TimeSeriesData[] {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    return this.timeSeries.filter((p) => p.timestamp >= cutoff);
  }

  getSuccessRate(): number {
    if (this.metrics.totalRequests === 0) return 0;
    return (this.metrics.successfulRequests / this.metrics.totalRequests) * 100;
  }

  getFallbackRate(): number {
    if (this.metrics.totalRequests === 0) return 0;
    return (this.metrics.fallbackCount / this.metrics.totalRequests) * 100;
  }

  getAvgLatency(): number {
    return this.metrics.avgLatency;
  }

  getTotalCost(): number {
    return this.metrics.totalCost;
  }

  getTopMembers(limit: number = 5): MemberMetrics[] {
    return this.getAllMemberMetrics()
      .sort((a, b) => b.requests - a.requests)
      .slice(0, limit);
  }

  getLeastUsedMembers(): MemberMetrics[] {
    return this.getAllMemberMetrics().sort((a, b) => a.requests - b.requests);
  }

  reset(): void {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      fallbackCount: 0,
      avgLatency: 0,
      totalTokens: 0,
      totalCost: 0,
    };
    this.memberMetrics.clear();
    this.timeSeries = [];
  }
}
