/**
 * Core type definitions for dsh-llm-router
 */

export interface RouteGroup {
  /** Unique identifier for the route group */
  id: string;
  /** Human-readable name */
  name: string;
  /** Optional description */
  description?: string;
  /** List of route group members */
  members: RouteGroupMember[];
  /** Routing strategy to use */
  strategy: RoutingStrategy;
  /** Stays cache-affinity mode (default "session") */
  stays?: "auto" | "session" | "turn" | "off";
  /** Strategy-specific configuration */
  strategyConfig?: StrategyConfig;
  /** Whether this group was auto-created (e.g., for failover) */
  auto?: boolean;
  /** Whether to hide this group from UI */
  hidden?: boolean;
  /** Whether this group is enabled */
  enabled: boolean;
}

export interface RouteGroupMember {
  /** Provider ID (e.g., 'deepseek-official', 'ollama') */
  provider: string;
  /** Model ID (e.g., 'deepseek-v4-pro', 'llama3:8b') */
  model: string;
  /** Optional account ID for multi-account providers */
  accountId?: string;
  /** Priority for 'order' strategy (0 = highest) */
  priority?: number;
  /** Weight for 'weighted' strategy */
  weight?: number;
  /** Whether this member is enabled */
  enabled: boolean;
  /** API key for this provider (or use environment variable) */
  apiKey?: string;
  /** Custom base URL for the API */
  baseUrl?: string;
  /** API protocol (openai, anthropic, or ollama) */
  protocol?: "openai" | "anthropic" | "ollama";
  /** Thinking/reasoning mode configuration */
  thinking?: {
    enabled: boolean;
    budget?: number;
  };
}

/** Available routing strategies */
export type RoutingStrategy =
  | "smart" // Select member with shortest quota remaining time
  | "order" // Use members in priority order
  | "rotate" // Rotate to next member on each turn
  | "usage" // Prioritize least-used member
  | "pace" // Use account with most quota left per hour
  | "weighted" // Weighted random selection
  | "intent"; // Route based on detected intent

export interface StrategyConfig {
  /** smart strategy: prefer members with lower latency */
  preferLowerLatency?: boolean;
  /** intent strategy: map intent to member provider:model */
  intentMapping?: Record<string, string>;
  /** weighted strategy: normalize weights to sum to 1 */
  normalizeWeights?: boolean;
}

export interface RoutingDecision {
  /** The route group used */
  group: RouteGroup;
  /** The selected member */
  member: RouteGroupMember;
  /** The strategy applied */
  strategy: RoutingStrategy;
  /** Reason for this decision */
  reason: string;
  /** Timestamp of decision */
  timestamp: number;
}

export interface QuotaStatus {
  /** Whether quota is available */
  available: boolean;
  /** Remaining quota */
  remaining: number;
  /** Total quota limit */
  limit: number;
  /** When quota resets (Unix timestamp in ms) */
  resetTime: number;
}

export interface QuotaLimits {
  /** Maximum tokens per day */
  maxTokensPerDay?: number;
  /** Maximum requests per day */
  maxRequestsPerDay?: number;
  /** Maximum tokens per hour */
  maxTokensPerHour?: number;
  /** Maximum cost per day (USD) */
  maxCostPerDay?: number;
}

export interface MiddlewareContext {
  /** The route group being used */
  group: RouteGroup;
  /** The selected member */
  member: RouteGroupMember;
  /** Shared state between middleware hooks */
  state: Map<string, any>;
  /** Reject the request with an error */
  reject: (status: number, message: string) => never;
}

export interface FallbackEvent {
  /** Route group ID */
  group: string;
  /** Failed member */
  failedMember: RouteGroupMember;
  /** Error message */
  error: string;
  /** Timestamp */
  timestamp: number;
}

export interface RoutingMetrics {
  /** Total requests routed */
  totalRequests: number;
  /** Successful requests */
  successfulRequests: number;
  /** Failed requests */
  failedRequests: number;
  /** Fallback events */
  fallbackCount: number;
  /** Average routing decision time (ms) */
  avgDecisionTime: number;
  /** Requests per route group */
  perGroup: Record<string, number>;
  /** Requests per member */
  perMember: Record<string, number>;
}
