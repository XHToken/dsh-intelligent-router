/**
 * Quota Tracking System
 * Tracks usage and enforces limits for each route group member
 */

export interface QuotaLimits {
  maxTokensPerDay?: number;
  maxRequestsPerDay?: number;
  maxTokensPerHour?: number;
  maxRequestsPerHour?: number;
  maxCostPerDay?: number;
}

export interface QuotaUsage {
  tokensUsed: number;
  requestsMade: number;
  costIncurred: number;
  lastResetTime: number;
}

export interface QuotaStatus {
  available: boolean;
  remaining: number;
  limit: number;
  usage: number;
  resetTime: number;
}

export class QuotaTracker {
  private usage: Map<string, QuotaUsage> = new Map();
  private limits: Map<string, QuotaLimits> = new Map();

  setLimits(memberId: string, limits: QuotaLimits): void {
    this.limits.set(memberId, limits);
  }

  getUsage(memberId: string): QuotaUsage {
    return (
      this.usage.get(memberId) || {
        tokensUsed: 0,
        requestsMade: 0,
        costIncurred: 0,
        lastResetTime: Date.now(),
      }
    );
  }

  recordUsage(memberId: string, tokens: number, cost: number = 0): void {
    const current = this.getUsage(memberId);
    current.tokensUsed += tokens;
    current.requestsMade += 1;
    current.costIncurred += cost;
    this.usage.set(memberId, current);
  }

  checkQuota(memberId: string): QuotaStatus {
    const usage = this.getUsage(memberId);
    const limits = this.limits.get(memberId) || {};
    // Check daily limits
    if (limits.maxTokensPerDay && usage.tokensUsed >= limits.maxTokensPerDay) {
      return {
        available: false,
        remaining: 0,
        limit: limits.maxTokensPerDay,
        usage: usage.tokensUsed,
        resetTime: usage.lastResetTime + 24 * 60 * 60 * 1000,
      };
    }

    if (
      limits.maxRequestsPerDay &&
      usage.requestsMade >= limits.maxRequestsPerDay
    ) {
      return {
        available: false,
        remaining: 0,
        limit: limits.maxRequestsPerDay,
        usage: usage.requestsMade,
        resetTime: usage.lastResetTime + 24 * 60 * 60 * 1000,
      };
    }

    // Return available status
    const remaining = limits.maxTokensPerDay
      ? limits.maxTokensPerDay - usage.tokensUsed
      : Infinity;

    return {
      available: true,
      remaining,
      limit: limits.maxTokensPerDay || Infinity,
      usage: usage.tokensUsed,
      resetTime: usage.lastResetTime + 24 * 60 * 60 * 1000,
    };
  }

  resetUsage(memberId: string): void {
    this.usage.set(memberId, {
      tokensUsed: 0,
      requestsMade: 0,
      costIncurred: 0,
      lastResetTime: Date.now(),
    });
  }

  getUsageReport(memberId: string): { usage: QuotaUsage; limits: QuotaLimits } {
    return {
      usage: this.getUsage(memberId),
      limits: this.limits.get(memberId) || {},
    };
  }

  getAllUsage(): Map<string, QuotaUsage> {
    return this.usage;
  }
}
