/**
 * Settings schema for dsh-llm-router
 * Uses @deepseek-ai/schemastery for DSH native settings UI integration
 *
 * Key differences from zod:
 * - No .optional() needed (fields are optional by default)
 * - Use .description() instead of .describe()
 * - Use z.union([z.const(...)]) instead of z.enum()
 * - Use z.dict() instead of z.record()
 * - Use .volatile() for DSH-editable fields
 */

import z from "@deepseek-ai/schemastery";

/** Routing strategy union type */
export const RoutingStrategySchema: any = z.union([
  z.const("smart").description("Smart routing: local model for small tasks, cloud model for large tasks"),
  z.const("order").description("Use members in priority order"),
  z.const("rotate").description("Rotate to next member on each turn"),
  z.const("usage").description("Prioritize least-used member"),
  z.const("pace").description("Use account with most quota left per hour"),
  z.const("weighted").description("Weighted random selection"),
  z.const("intent").description("Route based on detected intent"),
]);

/** Route group member schema */
export const RouteGroupMemberSchema: any = z.object({
  provider: z
    .string()
    .required()
    .description("Provider ID (e.g., deepseek, ollama, openai, anthropic)"),
  model: z
    .string()
    .required()
    .description("Model ID (e.g., deepseek-v4-flash, llama3.2, gpt-4)"),
  accountId: z
    .string()
    .description("Account ID for multi-account providers"),
  priority: z
    .number()
    .min(0)
    .description("Priority for order strategy (0 = highest)"),
  weight: z
    .number()
    .min(0)
    .description("Weight for weighted strategy"),
  enabled: z
    .boolean()
    .default(true)
    .description("Enable/disable this member"),
  apiKey: z
    .string()
    .description("API key for this provider (or use environment variable)"),
  baseUrl: z
    .string()
    .description("Custom base URL for the API"),
  protocol: z
    .string()
    .description("API protocol (openai/anthropic/ollama/anthropic-messages/openai-responses)"),
  thinking: z
    .object({
      enabled: z.boolean().default(false).description("Enable thinking/reasoning mode"),
      budget: z.number().description("Thinking token budget (for Anthropic)"),
    })
    .description("Thinking/reasoning mode configuration"),
});

/** Route group schema */
export const RouteGroupSchema: any = z.object({
  id: z.string().required().description("Unique group identifier"),
  name: z.string().default("Default").description("Human-readable group name"),
  description: z.string().description("Group description"),
  members: z
    .array(RouteGroupMemberSchema)
    .required()
    .description("Route group members"),
  strategy: RoutingStrategySchema.required().description("Routing strategy"),
  stays: z
    .union([
      z.const("auto").description("Stays within a turn always, across turns while the vendor cache is fresh (~5min)"),
      z.const("session").description("Stays on the last successful member for the entire session"),
      z.const("turn").description("Stays only within a single turn (~2min window)"),
      z.const("off").description("No staying; pure strategy ordering"),
    ])
    .default("session")
    .description("Stays: cache-affinity mode"),
  strategyConfig: z
    .object({
      preferLowerLatency: z.boolean().description("Prefer members with lower latency"),
      intentMapping: z
        .dict(
          z.object({
            provider: z.string(),
            model: z.string(),
            priority: z.number(),
          }),
        )
        .description("Map intent to member provider:model"),
      normalizeWeights: z.boolean().description("Normalize weights to sum to 1"),
    })
    .description("Strategy-specific configuration"),
  auto: z.boolean().description("Auto-created group"),
  hidden: z.boolean().description("Hidden from UI"),
  enabled: z.boolean().default(true).description("Enable/disable this group"),
  rules: z
    .array(
      z.object({
        minTokens: z.number().description("Minimum token threshold"),
        hasImage: z.boolean().description("Message must contain image"),
        anyReasoning: z.boolean().description("Any reasoning"),
        anyAgent: z.boolean().description("Any agent"),
        intent: z.string().description("Intent to match"),
        target: z
          .object({
            provider: z.string(),
            model: z.string(),
          })
          .description("Target model for this rule"),
      }),
    )
    .description("Routing rules (top-to-bottom, first match wins)"),
  classifierModel: z
    .object({
      provider: z.string(),
      model: z.string(),
    })
    .description("Intent classifier model"),
});

/** Intent routing configuration */
export const IntentRoutingSchema: any = z.object({
  enabled: z.boolean().default(false).description("Enable intent-based routing"),
  classifierProvider: z.string().description("Provider for intent classifier"),
  classifierModel: z.string().description("Model for intent classifier"),
  confidenceThreshold: z
    .number()
    .min(0)
    .max(1)
    .default(0.7)
    .description("Minimum confidence to use classified intent"),
  cacheEnabled: z.boolean().default(true).description("Cache classification results"),
  cacheTTL: z.number().default(300000).description("Cache TTL in milliseconds"),
});

/** Quota tracking configuration */
export const QuotaTrackingSchema: any = z.object({
  enabled: z.boolean().default(true).description("Enable quota tracking"),
  syncWithTokenMeter: z.boolean().default(true).description("Sync with DSH TokenMeter"),
  limits: z
    .object({
      maxTokensPerDay: z.number().description("Daily token limit"),
      maxRequestsPerDay: z.number().description("Daily request limit"),
      maxTokensPerHour: z.number().description("Hourly token limit"),
      maxCostPerDay: z.number().description("Daily cost limit in USD"),
    })
    .description("Usage limits"),
  warnings: z
    .object({
      tokenThreshold: z.number().min(0).max(1).default(0.8).description("Token warning threshold"),
      requestThreshold: z.number().min(0).max(1).default(0.8).description("Request warning threshold"),
    })
    .description("Warning thresholds"),
});

/** Fallback configuration */
export const FallbackSchema: any = z.object({
  enabled: z.boolean().default(true).description("Enable automatic fallback"),
  maxRetries: z.number().min(0).default(3).description("Maximum retry attempts"),
  retryDelay: z.number().min(0).default(1000).description("Delay between retries in ms"),
  recoverableErrors: z
    .array(z.string())
    .default(["RATE_LIMIT", "QUOTA", "TIMEOUT", "SERVER_ERROR", "NETWORK_ERROR", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "fetch failed"])
    .description("Error types that trigger fallback (case-insensitive pattern matching)"),
  timeouts: z
    .object({
      connect: z.number().default(5000).description("Connection timeout in ms"),
      request: z.number().default(30000).description("Request timeout in ms"),
      stream: z.number().default(60000).description("Stream timeout in ms"),
    })
    .description("Timeout configuration"),
});

/** Complete router settings schema */
export const RouterSettingsSchema: any = z.object({
  enabled: z.boolean().default(true).description("Enable LLM Router"),
  defaultGroup: z.string().default("default").volatile().description("Default route group ID"),
  routeGroups: z
    .array(RouteGroupSchema)
    .required()
    .volatile()
    .description("Route group definitions"),
  intentRouting: IntentRoutingSchema.volatile().description("Intent routing configuration"),
  quotaTracking: QuotaTrackingSchema.volatile().description("Quota tracking configuration"),
  fallback: FallbackSchema.volatile().description("Fallback configuration"),
  advanced: z
    .object({
      logLevel: z
        .union([z.const("error"), z.const("warn"), z.const("info"), z.const("debug")])
        .default("info")
        .description("Logging level"),
      metricsEnabled: z.boolean().default(true).description("Collect routing metrics"),
      cacheEnabled: z.boolean().default(true).description("Cache routing decisions"),
      cacheTTL: z.number().default(60000).description("Cache TTL in milliseconds"),
    })
    .volatile()
    .description("Advanced settings"),
});

// Export types for TypeScript compatibility
export type RouterSettings = any;
export type RouteGroup = any;
export type RouteGroupMember = any;
export type RoutingStrategy = string;
export type IntentRoutingConfig = any;
export type QuotaTrackingConfig = any;
export type FallbackConfig = any;
export type MiddlewareConfig = any;
