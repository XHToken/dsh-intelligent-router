/**
 * Core router implementation for dsh-llm-router
 * Handles intelligent LLM request routing with failover
 */

import type { Context } from "@cordis/core";
import type {
  GenerateOptions,
  StreamChunk,
  LlmAdapter,
} from "@deepseek-ai/dsh-llm";
import type {
  RouteGroup,
  RouteGroupMember,
  RoutingMetrics,
} from "./types";
import type {
  FallbackConfig,
  QuotaTrackingConfig,
} from "./settings-schema";
import { MiddlewareManager } from "./middleware";
import { LLMClient, type LLMClientConfig } from "./llm-client";
import { QuotaTracker } from "./quota-tracker";
import { MonitoringDashboard } from "./monitoring";
import { CostOptimizer } from "./cost-optimizer";
import { readConfigFromSettings } from "./config-store";
import {
  filterEnabled,
  orderCandidates,
  nextRotateIndex,
  rotateOrder,
  usageOrder,
  smartOrder,
  affinityOrder,
  AFFINITY_TURN_MS,
  AFFINITY_AUTO_MS,
  type StaysMode,
  type AffinityRecord,
} from "./strategies";

export interface MagpieRouterConfig {
  routeGroups: RouteGroup[];
  defaultGroup: string;
  quotaTracking: QuotaTrackingConfig;
  fallback: FallbackConfig;
  advanced?: {
    logLevel: "error" | "warn" | "info" | "debug";
    metricsEnabled: boolean;
    cacheEnabled: boolean;
    cacheTTL: number;
  };
}

export class MagpieRouter implements LlmAdapter {
  private groups: Map<string, RouteGroup>;
  private lastUsedIndex: Map<string, number> = new Map();
  private usageCounts: Map<string, number> = new Map();
  /** Stays cache affinity: last successful member per session/group key. */
  private lastAffinity: Map<string, AffinityRecord> = new Map();
  private middlewareManager: MiddlewareManager;
  private quotaTracker: QuotaTracker;
  private monitoring: MonitoringDashboard;
  private costOptimizer: CostOptimizer;
  private rawConfig: any; // Live schemastery config reference
  private config: MagpieRouterConfig; // Resolved config (updated on each stream)
  private metrics: RoutingMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    fallbackCount: 0,
    avgDecisionTime: 0,
    perGroup: {},
    perMember: {},
  };

  constructor(
    private ctx: Context,
    config: any,
  ) {
    this.rawConfig = config;
    this.config = {} as MagpieRouterConfig;
    try {
      const cfg = this.resolveLiveConfig();
      this.config = cfg;
      const routeGroups = cfg?.routeGroups || [];
      this.groups = new Map(routeGroups.map((g: any) => [g.id, g]));
      this.middlewareManager = new MiddlewareManager();
      this.quotaTracker = new QuotaTracker();
      this.monitoring = new MonitoringDashboard();
      this.costOptimizer = new CostOptimizer();

      // Configure quota limits only if enabled
      if (cfg?.quotaTracking?.enabled) {
        this.configureQuotaLimits();
      }
    } catch (error) {
      console.error("[dsh-llm-router] Error in constructor:", error);
      this.groups = new Map();
      this.middlewareManager = new MiddlewareManager();
      this.quotaTracker = new QuotaTracker();
      this.monitoring = new MonitoringDashboard();
      this.costOptimizer = new CostOptimizer();
    }
  }

  /**
   * Resolve live config.
   * Priority: settings service (Settings UI saves here) → schemastery config → defaults
   */
  private resolveLiveConfig(): any {
    // 1. Try settings service (where Settings UI saves config)
    const settingsConfig = readConfigFromSettings(this.ctx);
    if (settingsConfig.routeGroups?.length > 0) {
      return settingsConfig;
    }

    // 2. Fallback to schemastery config (cordis.patch.yml)
    const config = this.rawConfig;
    if (!config) return settingsConfig;

    const resolve = (v: any): any => {
      if (v === undefined || v === null) return v;
      if (typeof v.get === "function") return v.get();
      return v;
    };

    const resolved: any = {};
    for (const key of Object.keys(config)) {
      resolved[key] = resolve(config[key]);
    }

    // Merge: schemastery values override settings only if settings is empty
    return { ...settingsConfig, ...resolved };
  }

  /**
   * Refresh groups and config from live schemastery references
   * Called before each stream() to pick up Settings UI Save changes
   */
  private refreshFromConfig(): any {
    try {
      const cfg = this.resolveLiveConfig();
      this.config = cfg;
      const routeGroups = cfg?.routeGroups || [];
      this.groups = new Map(routeGroups.map((g: any) => [g.id, g]));
      return cfg;
    } catch {
      // Keep existing config on error
      return this.config;
    }
  }

  /**
   * Configure quota limits from route group settings
   */
  private configureQuotaLimits(): void {
    for (const group of this.groups.values()) {
      for (const member of group.members) {
        const memberId = `${member.provider}/${member.model}`;
        // Default limits (can be configured via settings)
        this.quotaTracker.setLimits(memberId, {
          maxTokensPerDay: 1000000, // 1M tokens/day
          maxRequestsPerDay: 1000, // 1000 requests/day
        });
      }
    }
  }

  /**
   * Provider info required by DSH LLM adapter interface
   */
  providerInfo(provider: string) {
    return {
      id: provider,
      name: "Auto Router",
    };
  }

  /**
   * Provider retry policy
   * Must return a complete ResolvedRetryPolicy or undefined (DSH defaults).
   * Incomplete policy (missing retryableCodes) causes DSH turn-tail crash:
   * "Cannot read properties of undefined (reading 'includes')"
   */
  providerRetryPolicy(_provider: string) {
    return {
      mode: "normal" as const,
      maxRetries: this.config.fallback?.maxRetries ?? 3,
      retryableCodes: [
        "RATE_LIMIT", "QUOTA", "TIMEOUT", "SERVER", "SERVER_ERROR",
        "NETWORK", "NETWORK_ERROR", "ECONNREFUSED", "ECONNRESET",
        "ETIMEDOUT", "OVERLOADED", "SERVICE_UNAVAILABLE",
      ],
      initialDelayMs: this.config.fallback?.retryDelay ?? 1000,
      maxDelayMs: 30000,
      jitterRatio: 0.2,
    };
  }

  /**
   * List available models (参考 dsh-smart-router: minimal fields)
   */
  async listModels(provider: string): Promise<any[]> {
    return [
      {
        provider,
        id: "AUTO",
        name: "AUTO - Intelligent Router",
        description:
          "Automatically routes to the best model based on your configuration",
        inputModalities: ["text", "image"],
      },
    ];
  }

  /**
   * Resolve model info (参考 dsh-smart-router: include reasoning)
   */
  async resolveModel(_provider: string, model: string, _signal?: AbortSignal) {
    return {
      provider: _provider,
      id: model,
      name: "AUTO - Intelligent Router",
      description:
        "Automatically routes to the best model based on your configuration",
      inputModalities: ["text", "image"],
      context: { contextWindow: 983616 },
      defaultMaxTokens: 128000,
      reasoning: {
        efforts: [
          { id: "low", name: "Low", description: "Low reasoning effort" },
          { id: "high", name: "High", description: "High reasoning effort" },
        ],
        defaultEffort: "low",
      },
    };
  }

  /**
   * Prepare a call to the model
   * Required by DSH LLM adapter interface
   */
  async prepareCall(provider: string, model: string, _signal?: AbortSignal) {
    // Return a prepared call configuration
    return {
      model: await this.resolveModel(provider, model, _signal),
      stream: (options: any) => this.stream(options),
    };
  }

  /**
   * Route a request through the waterfall handler
   * Determines the target provider/model, then creates new options
   * and dispatches via ctx.llm.stream() (which re-enters the waterfall
   * but passes through since provider != "auto")
   */
  async *route(options: any, next: () => AsyncIterable<any>): AsyncIterable<any> {
    // Refresh config (resolved once, reused below)
    const cfg = this.refreshFromConfig();

    // Resolve route group
    const groupId = cfg?.defaultGroup || this.groups.keys().next().value || "default";
    const group = this.groups.get(groupId);

    // No models configured (or group disabled) → pass through to DSH default
    if (!group || group.enabled === false || !group.members || group.members.length === 0) {
      yield* next();
      return;
    }

    // Evaluate rules
    let ruleTarget: { provider: string; model: string } | undefined;
    const rules = (group as any).rules;
    if (Array.isArray(rules) && rules.length > 0) {
      try {
        ruleTarget = await this.evaluateRules(rules, options, group);
      } catch {
        // Rule evaluation failed - continue with strategy
      }
    }

    // Get candidates
    const candidates = ruleTarget
      ? [
          { provider: ruleTarget.provider, model: ruleTarget.model, enabled: true },
          ...this.getCandidates(group, options).filter(
            (m: any) => !(m.provider === ruleTarget!.provider && m.model === ruleTarget!.model)
          ),
        ]
      : this.getCandidates(group, options);

    if (!candidates || candidates.length === 0) {
      yield* next();
      return;
    }

    // Try to modify options in-place so next() dispatches to target adapter
    // This ensures DSH tags the response with the CORRECT provider (not "auto")
    const target = candidates[0];
    if (!Object.isFrozen(options)) {
      options.provider = target.provider;
      options.model = target.model;
      yield* next();
      return;
    }

    // Options frozen: delegate via llm.stream with new options
    const llm = (this.ctx as any).llm;
    let lastError: any;

    for (const member of candidates) {
      if (!member) continue;

      try {
        const newOptions: any = { ...options };
        newOptions.provider = member.provider;
        newOptions.model = member.model;
        yield* llm.stream(newOptions);
        return;
      } catch (error: any) {
        lastError = error;
        if (!this.shouldFallback(error, cfg?.fallback)) {
          throw error;
        }
      }
    }

    throw lastError ?? new Error("All route candidates failed");
  }

  /**
   * Stream a request through the router
   * 参考 dsh-smart-router: resolveChain → delegate per candidate
   */
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const startTime = Date.now();
    this.metrics.totalRequests++;

    // Refresh config (resolveLiveConfig is resolved once here, not re-resolved)
    const cfg = this.refreshFromConfig();

    // Resolve route group
    const groupId = cfg?.defaultGroup || this.groups.keys().next().value || "default";
    const group = this.groups.get(groupId);

    // No models → clear error
    if (!group || !group.members || group.members.length === 0) {
      yield {
        type: "finish" as const,
        reason: {
          kind: "error" as const,
          failure: { message: "No models configured. Configure via Settings UI.", code: "NO_ROUTE" },
        },
      };
      return;
    }

    // Group explicitly disabled via Settings UI → don't route through it
    if (group.enabled === false) {
      yield {
        type: "finish" as const,
        reason: {
          kind: "error" as const,
          failure: { message: `Route group "${groupId}" is disabled.`, code: "GROUP_DISABLED" },
        },
      };
      return;
    }

    // Evaluate rules
    let ruleTarget: { provider: string; model: string } | undefined;
    const rules = (group as any).rules;
    if (Array.isArray(rules) && rules.length > 0) {
      try {
        ruleTarget = await this.evaluateRules(rules, options, group);
      } catch {
      }
    }

    // Build candidate chain
    const candidates = ruleTarget
      ? [
          { provider: ruleTarget.provider, model: ruleTarget.model, enabled: true },
          ...this.getCandidates(group, options).filter(
            (m: any) => !(m.provider === ruleTarget!.provider && m.model === ruleTarget!.model)
          ),
        ]
      : this.getCandidates(group, options);


    if (!candidates || candidates.length === 0) {
      yield {
        type: "finish" as const,
        reason: {
          kind: "error" as const,
          failure: { message: "No enabled members in route group.", code: "NO_ROUTE" },
        },
      };
      return;
    }

    // Delegate to each candidate
    const llm = (this.ctx as any).llm;
    let lastError: any;
    let actualAttempts = 0;

    for (const member of candidates) {
      if (!member) continue;
      actualAttempts++;
      try {
        yield* this.delegateTo(options, member, llm);
        // Success: record usage + metrics + stays affinity
        this.recordAffinity(group, options, member);
        this.recordUsage(member);
        this.metrics.successfulRequests++;
        this.updateMetrics(groupId, member as any, Date.now() - startTime);
        return;
      } catch (error: any) {
        lastError = error;
        this.metrics.failedRequests++;
        // Drop the affinity record if the failed member was the sticky one,
        // so session mode never keeps retrying a broken member first.
        this.clearAffinityOnMismatch(group, options, member);

        // Check if we should fallback
        if (!this.shouldFallback(error, cfg?.fallback)) throw error;

        // Emit fallback event
        this.ctx.emit?.("router/fallback", {
          group: groupId,
          failedMember: member,
          error: error?.message ?? String(error),
          code: error?.code ?? error?.routeFailure?.code,
          timestamp: Date.now(),
        });
        this.metrics.fallbackCount++;

        // Check max retries
        if (actualAttempts >= (cfg?.fallback?.maxRetries ?? 3)) break;

        // Delay before retry
        if (cfg?.fallback?.retryDelay > 0) {
          await this.delay(cfg.fallback.retryDelay);
        }
      }
    }

    // All routes failed - throw so DSH adapterStream converts to error finish chunk
    throw lastError ?? new Error("All route candidates failed");
  }

  /**
   * Delegate one request to a concrete provider/model
   */
  private async *delegateTo(options: any, member: any, llm: any): AsyncIterable<StreamChunk> {
    const { reasoningEffort: _re, maxTokens: _mt, temperature: _t, stop: _s, provider: _p, model: _m, ...rest } = options;

    if (!llm || typeof llm.prepareCall !== "function") {
      throw new Error(
        `route ${member.provider}/${member.model} failed: DSH llm.prepareCall unavailable`,
      );
    }

    const config: any = { provider: member.provider, model: member.model };
    const prepared = await llm.prepareCall(config, options.signal);
    if (!prepared || !prepared.config) {
      throw new Error(
        `route ${member.provider}/${member.model} failed: prepareCall returned no config`,
      );
    }

    const forwarded: any = {
      ...rest,
      provider: prepared.config.provider,
      model: prepared.config.model,
      ...(prepared.config.reasoningEffort === undefined ? {} : { reasoningEffort: prepared.config.reasoningEffort }),
      ...(prepared.config.maxTokens === undefined ? {} : { maxTokens: prepared.config.maxTokens }),
      ...(prepared.config.temperature === undefined ? {} : { temperature: prepared.config.temperature }),
      ...(prepared.config.stop === undefined ? {} : { stop: prepared.config.stop }),
    };

    let produced = false;
    let chunkCount = 0;
    for await (const chunk of prepared.stream(forwarded)) {
      chunkCount++;
      if (chunkCount <= 3 || (chunk as any)?.type === "finish") {
      }
      if (chunk && (chunk as any).type === "finish" && (chunk as any).reason?.kind === "error") {
        if (!produced) {
          const failure = (chunk as any).reason?.failure;
          // Carry the DSH-normalized failure's code/status onto the thrown
          // error so shouldFallback's code/HTTP-status steps can classify it.
          throw Object.assign(
            new Error(`route ${member.provider}/${member.model} failed: ${failure?.message ?? "unknown"}`),
            {
              routeFailure: failure,
              ...(typeof failure?.code === "string" ? { code: failure.code } : {}),
              ...(typeof failure?.status === "number" ? { status: failure.status } : {}),
            },
          );
        }
      }
      produced = true;
      yield chunk;
    }
  }

  /**
   * Legacy stream method (kept for compatibility)
   */
  async *legacyStream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.refreshFromConfig();
    const cfg = this.resolveLiveConfig();

    try {
      if (!options) throw new Error("Options is undefined");

      let groupId: string;
      if (options.provider?.startsWith("group/")) {
        groupId = options.provider.substring(6);
      } else if (options.model === "AUTO") {
        groupId = cfg?.defaultGroup || this.groups.keys().next().value || "default";
      } else {
        groupId = this.resolveGroup(options);
      }

      const group = this.groups.get(groupId);
      if (!group || !group.members || group.members.length === 0) {
        throw new Error("No models configured in LLM Router.");
      }

      let ruleOverride: { provider: string; model: string } | undefined;
      const rules = (group as any).rules;
      if (Array.isArray(rules) && rules.length > 0) {
        try {
          ruleOverride = await this.evaluateRules(rules, options, group);
        } catch { /* continue */ }
      }

      const candidates = ruleOverride
        ? [
            { provider: ruleOverride.provider, model: ruleOverride.model, enabled: true },
            ...this.getCandidates(group, options).filter(
              (m: any) => !(m.provider === ruleOverride!.provider && m.model === ruleOverride!.model)
            ),
          ]
        : this.getCandidates(group, options);

      if (!candidates || candidates.length === 0) {
        throw new Error(`No enabled members in route group ${groupId}`);
      }

      let lastError: Error | undefined;

      for (const member of candidates) {
        if (!member) continue;
        let hasYielded = false;

        try {
          const stream = this.dispatchToMember(member, options);
          for await (const chunk of stream) {
            hasYielded = true;
            yield chunk;
          }
          return;
        } catch (error: any) {
          lastError = error;
          if (hasYielded) throw error;
          // use the cfg resolved at the top of legacyStream (this.config may predate refresh)
          if (!this.shouldFallback(error, cfg?.fallback)) throw error;
        }
      }

      throw lastError ?? new Error("All route candidates failed");
    } catch (error: any) {
      this.metrics.failedRequests++;
      throw error;
    }
  }

  /**
   * Resolve which route group to use
   */
  private resolveGroup(options: GenerateOptions): string {
    // If provider starts with 'group/', use that group
    if (options.provider?.startsWith("group/")) {
      return options.provider.substring(6);
    }

    // If model is specified and matches a route group member, use that group's strategy
    if (options.model) {
      for (const group of this.groups.values()) {
        if (group.enabled === false) continue;
        for (const member of group.members) {
          if (member.enabled !== false && member.model === options.model) {
            return group.id;
          }
        }
      }
    }

    // Otherwise use default group
    return this.config.defaultGroup;
  }

  /**
   * Estimate token count from messages (approximate: 1 token ≈ 4 chars)
   */
  private estimateTokens(options: GenerateOptions): number {
    try {
      let totalChars = 0;
      const messages = (options as any)?.messages || [];
      for (const msg of messages) {
        if (typeof msg.content === "string") {
          totalChars += msg.content.length;
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part?.type === "text" && part.text) totalChars += part.text.length;
          }
        }
      }
      return Math.ceil(totalChars / 4);
    } catch {
      return 0;
    }
  }

  /**
   * Check if message contains images
   */
  private hasImage(options: GenerateOptions): boolean {
    try {
      const messages = (options as any)?.messages || [];
      for (const msg of messages) {
        if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part?.type === "image" || part?.type === "image_url") return true;
          }
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if a model is local (ollama)
   */
  private isLocalModel(member: any): boolean {
    const provider = (member?.provider || "").toLowerCase();
    const protocol = (member?.protocol || "").toLowerCase();
    return provider.includes("ollama") || protocol.includes("ollama");
  }

  /**
   * Classify intent using the configured classifierModel
   * Returns the matched intent string or null
   */
  private async classifyIntent(
    options: GenerateOptions,
    group: any,
    intents: string[],
  ): Promise<string | null> {
    try {
      const classifier = group?.classifierModel;
      if (!classifier?.model || !classifier?.provider) return null;
      if (intents.length === 0) return null;

      const llm = (this.ctx as any).llm;
      if (!llm || typeof llm.stream !== "function") return null;

      // Get the last user message text
      const messages = (options as any)?.messages || [];
      const lastUserMsg = [...messages].reverse().find((m: any) => m?.role === "user");
      let text = "";
      if (lastUserMsg) {
        if (typeof lastUserMsg.content === "string") {
          text = lastUserMsg.content;
        } else if (Array.isArray(lastUserMsg.content)) {
          text = lastUserMsg.content
            .filter((p: any) => p?.type === "text")
            .map((p: any) => p?.text || "")
            .join("\n");
        }
      }
      if (!text) return null;

      // Truncate long messages (keep first 3000 + last 1000 chars)
      if (text.length > 4000) {
        text = text.substring(0, 3000) + "\n…\n" + text.substring(text.length - 1000);
      }

      // Build classification prompt
      const intentList = intents.map((intent: string, i: number) => `${i + 1}. ${intent}`).join("\n");
      const prompt = `You route a user's message by what it asks for. Given numbered kinds of request and the user's message, answer with the number of the kind the message is, or 0 if none. Answer with the number only.\n\nKinds:\n${intentList}\n\nThe user's message:\n<message>\n${text}\n</message>\n\nThe number of its kind (0 for none):`;

      // Call classifier model via prepareCall (参考 dsh-smart-router)
      const llmSvc = (this.ctx as any).llm;
      let response = "";
      const prepared = await llmSvc.prepareCall(
        { provider: classifier.provider, model: classifier.model, maxTokens: 200 },
        (options as any).signal,
      );
      const forwarded: any = {
        provider: prepared.config.provider,
        model: prepared.config.model,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        ...(prepared.config.maxTokens === undefined ? {} : { maxTokens: prepared.config.maxTokens }),
      };
      for await (const chunk of prepared.stream(forwarded)) {
        if (chunk && chunk.type === "text-delta" && typeof (chunk as any).text === "string") {
          response += (chunk as any).text;
        }
      }

      // Parse the number from response
      const numMatch = response.match(/\b(\d+)\b/);
      if (!numMatch) return null;
      const num = parseInt(numMatch[1], 10);
      if (num >= 1 && num <= intents.length) {
        return intents[num - 1];
      }
      return null;
    } catch (e) {
      console.error("[dsh-llm-router] Intent classification failed:", e);
      return null;
    }
  }

  /**
   * Evaluate Rules against the current request
   * Rules are checked top-to-bottom; first match wins
   *
   * Rule conditions:
   *   minTokens: message must have ≥ N tokens
   *   hasImage: message must contain an image
   *   anyReasoning: model must support reasoning
   *   anyAgent: request must be from an agent
   *   intent: message intent must match (uses classifierModel)
   */
  private async evaluateRules(
    rules: any[],
    options: GenerateOptions,
    group: any,
  ): Promise<{ provider: string; model: string } | undefined> {
    const estimatedTokens = this.estimateTokens(options);
    const hasImg = this.hasImage(options);
    const isAgent = !!(options as any)?.agent || !!(options as any)?.toolUse;

    // Collect unique intents from rules that need classification
    const intentRules = rules.filter((r: any) => r.intent);
    let classifiedIntent: string | null = null;
    if (intentRules.length > 0) {
      const uniqueIntents = [...new Set(intentRules.map((r: any) => r.intent))];
      classifiedIntent = await this.classifyIntent(options, group, uniqueIntents);
    }

    // Check each rule top-to-bottom
    for (const rule of rules) {
      let matches = true;

      // Condition: minTokens
      if (rule.minTokens && estimatedTokens < rule.minTokens) {
        matches = false;
      }

      // Condition: hasImage
      if (rule.hasImage && !hasImg) {
        matches = false;
      }

      // Condition: anyReasoning - skip for now (most models support reasoning)
      // This condition is a placeholder for future reasoning capability detection
      if (rule.anyReasoning) {
        // Currently always passes - reasoning detection not yet implemented
      }

      // Condition: anyAgent
      if (rule.anyAgent && !isAgent) {
        matches = false;
      }

      // Condition: intent
      if (rule.intent && classifiedIntent !== rule.intent) {
        matches = false;
      }

      if (matches && rule.target?.model) {
        this.log(
          "info",
          `Rule matched → ${rule.target.provider}/${rule.target.model}`,
        );
        return { provider: rule.target.provider, model: rule.target.model };
      }
    }

    return undefined;
  }

  /**
   * Get candidate members based on strategy
   */
  private getCandidates(group: RouteGroup, options?: GenerateOptions): RouteGroupMember[] {
    try {
      if (!group || !group.members || !Array.isArray(group.members)) {
        return [];
      }

      const enabledMembers = filterEnabled(group.members);

      let ordered: RouteGroupMember[];
      switch (group.strategy) {
        case "order":
          ordered = orderCandidates(enabledMembers);
          break;
        case "rotate":
          ordered = this.rotateCandidates(group, enabledMembers);
          break;
        case "usage":
          ordered = usageOrder(enabledMembers, this.usageCounts);
          break;
        case "smart":
          // Estimate task size: < 4096 tokens → local first, ≥ 4096 → cloud first
          ordered = smartOrder(
            enabledMembers,
            options ? this.estimateTokens(options) : 0,
          );
          break;
        default:
          ordered = orderCandidates(enabledMembers);
      }

      // Stays: move the last successful member to the front while fresh.
      // Applied after strategy ordering; rule targets (set by callers) stay first.
      return this.applyAffinity(group, ordered, options);
    } catch (e) {
      console.error("[dsh-llm-router] Error in getCandidates:", e);
      return [];
    }
  }

  /**
   * Rotate strategy: round-robin selection (state lives in lastUsedIndex;
   * pure ordering comes from ./strategies so tests can cover it directly).
   * nextRotateIndex returns -1 when there are no enabled members and
   * sanitizes non-finite persisted indices, so a temporary "all disabled"
   * state no longer poisons rotation permanently.
   */
  private rotateCandidates(
    group: RouteGroup,
    enabledMembers?: RouteGroupMember[],
  ): RouteGroupMember[] {
    const members = enabledMembers ?? filterEnabled(group.members);
    const nextIndex = nextRotateIndex(
      this.lastUsedIndex.get(group.id) ?? -1,
      members.length,
    );
    if (nextIndex < 0) {
      return [];
    }

    this.lastUsedIndex.set(group.id, nextIndex);

    // Return members starting from nextIndex
    return rotateOrder(members, nextIndex);
  }

  // ── Stays (cache affinity) ──────────────────────────────────────────────

  /** Read the group's stays mode; unknown/missing values fall back to "session". */
  private getStaysMode(group: RouteGroup): StaysMode {
    const v = (group as any)?.stays;
    return v === "off" || v === "turn" || v === "auto" || v === "session"
      ? v
      : "session";
  }

  /** Affinity state key: prefer the DSH-stamped sessionId, fall back to group id. */
  private affinityKey(group: RouteGroup, options?: any): string {
    const sid = options?.sessionId;
    return sid ? `${group.id}#${sid}` : group.id;
  }

  /** Record the successful member as the sticky target (off mode never writes). */
  private recordAffinity(
    group: RouteGroup,
    options: any,
    member: RouteGroupMember,
  ): void {
    if (this.getStaysMode(group) === "off") return;
    this.lastAffinity.set(this.affinityKey(group, options), {
      provider: member.provider,
      model: member.model,
      ts: Date.now(),
    });
    // Lazy hygiene: prune stale entries when the map grows large.
    if (this.lastAffinity.size > 200) {
      const cutoff = Date.now() - 600_000;
      for (const [key, rec] of this.lastAffinity) {
        if (rec.ts < cutoff) this.lastAffinity.delete(key);
      }
    }
  }

  /** If the failed candidate was the sticky member, drop the record. */
  private clearAffinityOnMismatch(
    group: RouteGroup,
    options: any,
    member: RouteGroupMember,
  ): void {
    const key = this.affinityKey(group, options);
    const rec = this.lastAffinity.get(key);
    if (rec && rec.provider === member.provider && rec.model === member.model) {
      this.lastAffinity.delete(key);
    }
  }

  /** Move the last successful member to the front while its window is fresh. */
  private applyAffinity(
    group: RouteGroup,
    ordered: RouteGroupMember[],
    options?: any,
  ): RouteGroupMember[] {
    const mode = this.getStaysMode(group);
    if (mode === "off" || ordered.length < 2) return ordered;
    const result = affinityOrder(
      ordered,
      this.lastAffinity.get(this.affinityKey(group, options)),
      mode,
      Date.now(),
      { turn: AFFINITY_TURN_MS, auto: AFFINITY_AUTO_MS },
    );
    if (result[0] !== ordered[0]) {
      this.log(
        "debug",
        `stays hit: ${result[0].provider}/${result[0].model} (mode=${mode})`,
      );
    }
    return result;
  }



  /**
   * Dispatch request to a specific member
   * Uses the standalone LLM client to directly call the provider API
   */
  private async *dispatchToMember(
    member: RouteGroupMember,
    options: GenerateOptions,
  ): AsyncIterable<StreamChunk> {
    const memberId = `${member.provider}/${member.model}`;
    const startTime = Date.now();
    const cfg = this.resolveLiveConfig();

    // Check quota only if enabled
    if (cfg?.quotaTracking?.enabled) {
      const quotaStatus = this.quotaTracker.checkQuota(memberId);
      if (!quotaStatus.available) {
        throw new Error(
          `Quota exceeded for ${memberId}: ${quotaStatus.remaining} remaining`,
        );
      }
    }

    // Use DSH's LLM system via prepareCall + stream (参考 dsh-smart-router delegate)
    const llm = (this.ctx as any).llm;

    let streamSource: AsyncIterable<StreamChunk>;

    if (llm && typeof llm.prepareCall === "function") {
      // Build config for target provider/model
      const config: any = {
        provider: member.provider,
        model: member.model,
      };

      const prepared = await llm.prepareCall(config, (options as any).signal);

      // Forwarded options: strip config fields from original,
      // rebuild from prepared.config (callConfigEquals must pass)
      const {
        reasoningEffort: _re, maxTokens: _mt, temperature: _t,
        stop: _s, provider: _p, model: _m, ...rest
      } = options as any;

      const forwarded: any = {
        ...rest,
        provider: prepared.config.provider,
        model: prepared.config.model,
        ...(prepared.config.reasoningEffort === undefined ? {} : { reasoningEffort: prepared.config.reasoningEffort }),
        ...(prepared.config.maxTokens === undefined ? {} : { maxTokens: prepared.config.maxTokens }),
        ...(prepared.config.temperature === undefined ? {} : { temperature: prepared.config.temperature }),
        ...(prepared.config.stop === undefined ? {} : { stop: prepared.config.stop }),
      };

      streamSource = prepared.stream(forwarded);
    } else {
      // Fallback: use standalone LLMClient (for testing or standalone mode)
      const clientConfig: LLMClientConfig = {
        provider: member.provider,
        model: member.model,
        apiKey: member.apiKey,
        baseUrl: member.baseUrl,
        protocol: member.protocol,
        thinking: member.thinking,
      };
      const client = new LLMClient(clientConfig);
      streamSource = client.stream(options);
    }

    // Stream with monitoring (参考 dsh-smart-router delegate: error chunk handling)
    let tokensUsed = 0;
    let produced = false;
    try {
      for await (const chunk of streamSource) {
        // Terminal error chunks: convert to throw BEFORE any output (chain fallback)
        if (
          chunk && (chunk as any).type === "finish" &&
          (chunk as any).reason?.kind === "error"
        ) {
          const failure = (chunk as any).reason?.failure;
          if (!produced) {
            throw Object.assign(
              new Error(`route ${memberId} failed: ${failure?.message ?? "unknown"}`),
              { routeFailure: failure },
            );
          }
        }

        // Count tokens (approximate)
        if (chunk.type === "text-delta" || chunk.type === "tool-call-delta") {
          tokensUsed +=
            (chunk as any).text?.length ||
            (chunk as any).argumentsDelta?.length ||
            0;
        }
        produced = true;
        yield chunk;
      }

      // Record successful usage
      const latency = Date.now() - startTime;
      const costEstimate = this.costOptimizer.estimateCost(
        member.provider,
        member.model,
        tokensUsed / 2, // Approximate input tokens
        tokensUsed / 2, // Approximate output tokens
      );

      this.quotaTracker.recordUsage(
        memberId,
        tokensUsed,
        costEstimate.estimatedCost,
      );
      this.monitoring.recordRequest(
        memberId,
        latency,
        tokensUsed,
        costEstimate.estimatedCost,
        true,
      );
      this.monitoring.updateMemberInfo(memberId, member.provider, member.model);
      this.costOptimizer.recordRequest(
        member.provider,
        member.model,
        tokensUsed / 2,
        tokensUsed / 2,
      );
    } catch (error) {
      // Record failure
      const latency = Date.now() - startTime;
      this.monitoring.recordRequest(memberId, latency, tokensUsed, 0, false);
      throw error;
    }
  }

  /**
   * Check if quota is available for a member
   */
  private async checkQuota(member: RouteGroupMember): Promise<boolean> {
    const memberId = `${member.provider}/${member.model}`;
    const status = this.quotaTracker.checkQuota(memberId);
    return status.available;
  }

  /**
   * Record usage for a member
   */
  private recordUsage(member: RouteGroupMember): void {
    const key = `${member.provider}:${member.model}`;
    const current = this.usageCounts.get(key) ?? 0;
    this.usageCounts.set(key, current + 1);
  }

  /**
   * Check if error should trigger fallback
   * Error classification: TRANSIENT → fallback, PERMANENT/UNKNOWN → no fallback
   *
   * TRANSIENT (fallback):
   *   - Node.js network codes: ECONNREFUSED, ECONNRESET, ETIMEDOUT, EAI_AGAIN
   *   - HTTP status: 429, 500, 502, 503, 504, 529
   *   - Error codes: RATE_LIMIT, OVERLOADED, SERVICE_UNAVAILABLE
   *
   * PERMANENT (no fallback):
   *   - HTTP status: 400, 401, 403, 404, 422
   *   - Error codes: AUTH, INVALID_API_KEY, MODEL_NOT_FOUND, INVALID_REQUEST
   *
   * UNKNOWN (no fallback - safe default):
   *   - Everything else
   */
  private static readonly TRANSIENT_CODES = new Set([
    "econnrefused", "econnreset", "etimedout", "eai_again", "ehostunreach", "enetunreach",
  ]);
  private static readonly TRANSIENT_HTTP = new Set([429, 500, 502, 503, 504, 529]);
  private static readonly TRANSIENT_ERRORS = new Set([
    "rate_limit", "ratelimit", "overloaded", "service_unavailable", "too_many_requests",
  ]);
  private static readonly PERMANENT_HTTP = new Set([400, 401, 403, 404, 422]);
  private static readonly PERMANENT_ERRORS = new Set([
    "auth", "authentication", "invalid_api_key", "api_key", "model_not_found",
    "invalid_request", "invalid_request_error", "not_found", "forbidden", "unauthorized",
  ]);
  /**
   * Network/connection indicators matched against the combined error text
   * (code + message + cause.code + routeFailure.code/message). Provider SDKs
   * such as Anthropic's APIConnectionError surface connection failures as a
   * bare "Connection error." message with no machine code — DSH normalizes it
   * into an error finish chunk, so message matching is the only signal left.
   */
  private static readonly NETWORK_PATTERNS = [
    "econnrefused", "econnreset", "etimedout", "eai_again", "enotfound",
    "enetunreach", "ehostunreach", "epipe", "socket hang up", "fetch failed",
    "connection error", "connection refused", "connection reset",
    "network error", "network request failed",
  ];

  private shouldFallback(error: any, config: any): boolean {
    try {
      if (!config || config.enabled === false) return false;

      // Custom override from config (advanced users)
      const custom = config.recoverableErrors;
      if (Array.isArray(custom) && custom.length > 0) {
        const texts: string[] = [];
        if (typeof error?.code === "string") texts.push(error.code);
        if (typeof error?.message === "string") texts.push(error.message);
        if (typeof error?.cause?.code === "string") texts.push(error.cause.code);
        if (typeof error?.routeFailure?.code === "string") texts.push(error.routeFailure.code);
        if (typeof error?.routeFailure?.message === "string") texts.push(error.routeFailure.message);
        const combined = texts.join(" ").toLowerCase();
        return custom.some((p: string) =>
          typeof p === "string" && combined.includes(p.toLowerCase())
        );
      }

      // Built-in classification
      // 1. Check error.cause.code (Node.js network errors)
      const causeCode = (error?.cause?.code || "").toLowerCase();
      if (MagpieRouter.TRANSIENT_CODES.has(causeCode)) return true;

      // 2. Check HTTP status code
      const status = error?.status || error?.statusCode || error?.cause?.status;
      if (typeof status === "number") {
        if (MagpieRouter.TRANSIENT_HTTP.has(status)) return true;
        if (MagpieRouter.PERMANENT_HTTP.has(status)) return false;
      }

      // 3. Check error.code
      const errCode = (error?.code || "").toLowerCase().replace(/[\s-]/g, "_");
      if (MagpieRouter.TRANSIENT_ERRORS.has(errCode)) return true;
      if (MagpieRouter.PERMANENT_ERRORS.has(errCode)) return false;

      // 4. Extract HTTP status from message (e.g., "429 Too Many Requests")
      const msg = (error?.message || "").toLowerCase();
      const statusMatch = msg.match(/\b(4\d{2}|5\d{2})\b/);
      if (statusMatch) {
        const code = parseInt(statusMatch[1], 10);
        if (MagpieRouter.TRANSIENT_HTTP.has(code)) return true;
        if (MagpieRouter.PERMANENT_HTTP.has(code)) return false;
      }

      // 5. Network/connection indicators across all error text fields.
      // Catches SDK-level connection failures (e.g. Anthropic's
      // "Connection error." finish chunk) that carry no machine code.
      const combinedText = [
        error?.code,
        error?.message,
        error?.cause?.code,
        error?.cause?.message,
        error?.routeFailure?.code,
        error?.routeFailure?.message,
      ]
        .filter((s): s is string => typeof s === "string")
        .join(" ")
        .toLowerCase();
      if (MagpieRouter.NETWORK_PATTERNS.some((p) => combinedText.includes(p))) {
        return true;
      }

      // 6. Unknown → no fallback (safe default)
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get monitoring metrics
   */
  getMonitoringMetrics() {
    return {
      metrics: this.monitoring.getMetrics(),
      successRate: this.monitoring.getSuccessRate(),
      fallbackRate: this.monitoring.getFallbackRate(),
      avgLatency: this.monitoring.getAvgLatency(),
      totalCost: this.monitoring.getTotalCost(),
      topMembers: this.monitoring.getTopMembers(5),
      memberMetrics: this.monitoring.getAllMemberMetrics(),
    };
  }

  /**
   * Get cost report
   */
  getCostReport(hours: number = 24) {
    return this.costOptimizer.getReport(hours);
  }

  /**
   * Get quota status for all members
   */
  getQuotaStatus() {
    const status: Record<string, any> = {};
    // usageCounts keys use "provider:model"; quotaTracker member ids use
    // "provider/model" (see configureQuotaLimits) — normalize before lookup.
    for (const usageKey of this.usageCounts.keys()) {
      const memberId = usageKey.replace(":", "/");
      status[memberId] = this.quotaTracker.checkQuota(memberId);
    }
    return status;
  }

  /**
   * Get usage statistics
   */
  getUsageStats() {
    return {
      usageCounts: Object.fromEntries(this.usageCounts),
      quotaStatus: this.getQuotaStatus(),
      costReport: this.getCostReport(),
      monitoring: this.getMonitoringMetrics(),
    };
  }

  /**
   * Update routing metrics
   */
  private updateMetrics(
    groupId: string,
    member: RouteGroupMember,
    decisionTime: number,
  ): void {
    // NOTE: totalRequests is incremented once per request at stream() entry;
    // do not increment it here (updateMetrics only runs on successful delegations).

    // Update per-group metrics
    this.metrics.perGroup[groupId] = (this.metrics.perGroup[groupId] ?? 0) + 1;

    // Update per-member metrics
    const memberKey = `${member.provider}:${member.model}`;
    this.metrics.perMember[memberKey] =
      (this.metrics.perMember[memberKey] ?? 0) + 1;

    // Update average decision time
    const totalDecisions = this.metrics.totalRequests;
    this.metrics.avgDecisionTime =
      (this.metrics.avgDecisionTime * (totalDecisions - 1) + decisionTime) /
      totalDecisions;
  }

  /**
   * Get current metrics
   */
  getMetrics(): RoutingMetrics {
    return { ...this.metrics };
  }

  /**
   * Log message with level
   */
  private log(
    level: "error" | "warn" | "info" | "debug",
    message: string,
  ): void {
    const logLevel = this.config.advanced?.logLevel ?? "info";
    const levels = ["error", "warn", "info", "debug"];
    const currentIndex = levels.indexOf(logLevel);
    const messageIndex = levels.indexOf(level);

    if (messageIndex <= currentIndex) {
      console.log(`[dsh-llm-router][${level.toUpperCase()}] ${message}`);
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
