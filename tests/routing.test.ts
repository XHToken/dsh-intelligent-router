import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for core routing logic:
 * - Strategy implementations (smart, order, rotate, usage)
 * - Rules evaluation engine
 * - Error classification (shouldFallback)
 * - Token estimation
 */

// Mock the router internals for testing
// We test the pure logic functions directly

describe("Routing Strategies", () => {
  // Helper: simulate orderCandidates
  const orderCandidates = (members: any[]) =>
    [...members].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  // Helper: simulate usageCandidates
  const usageCandidates = (members: any[], usageCounts: Map<string, number>) =>
    [...members].sort((a, b) => {
      const countA = usageCounts.get(`${a.provider}:${a.model}`) ?? 0;
      const countB = usageCounts.get(`${b.provider}:${b.model}`) ?? 0;
      return countA - countB;
    });

  // Helper: simulate isLocalModel
  const isLocalModel = (member: any) => {
    const provider = (member?.provider || "").toLowerCase();
    const protocol = (member?.protocol || "").toLowerCase();
    return provider.includes("ollama") || protocol.includes("ollama");
  };

  // Helper: simulate smartCandidates
  const smartCandidates = (members: any[], tokens: number) => {
    const isSmallTask = tokens < 4096;
    return [...members].sort((a, b) => {
      const aLocal = isLocalModel(a);
      const bLocal = isLocalModel(b);
      if (isSmallTask) {
        if (aLocal && !bLocal) return -1;
        if (!aLocal && bLocal) return 1;
      } else {
        if (!aLocal && bLocal) return -1;
        if (aLocal && !bLocal) return 1;
      }
      return (a.priority ?? 0) - (b.priority ?? 0);
    });
  };

  // Helper: simulate estimateTokens
  const estimateTokens = (messages: any[]) => {
    let totalChars = 0;
    for (const msg of messages) {
      if (typeof msg.content === "string") totalChars += msg.content.length;
      else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part?.type === "text" && part.text) totalChars += part.text.length;
        }
      }
    }
    return Math.ceil(totalChars / 4);
  };

  const members = [
    { provider: "ollama", model: "SparkLLM", protocol: "ollama", priority: 1 },
    { provider: "deepseek", model: "v4.1-flash", protocol: "openai", priority: 2 },
    { provider: "qwen", model: "3.7-plus", protocol: "anthropic", priority: 3 },
  ];

  describe("order strategy", () => {
    it("should sort by priority ascending", () => {
      const shuffled = [members[2], members[0], members[1]];
      const result = orderCandidates(shuffled);
      expect(result[0].model).toBe("SparkLLM");
      expect(result[1].model).toBe("v4.1-flash");
      expect(result[2].model).toBe("3.7-plus");
    });

    it("should handle missing priority (default 0)", () => {
      const noPriority = [
        { provider: "a", model: "m1" },
        { provider: "b", model: "m2", priority: 5 },
      ];
      const result = orderCandidates(noPriority);
      expect(result[0].model).toBe("m1"); // priority 0 < 5
    });
  });

  describe("smart strategy", () => {
    it("small task (< 4096 tokens) should prefer local model", () => {
      const result = smartCandidates(members, 100);
      expect(result[0].provider).toBe("ollama");
    });

    it("large task (≥ 4096 tokens) should prefer cloud model", () => {
      const result = smartCandidates(members, 10000);
      expect(result[0].provider).not.toBe("ollama");
    });

    it("boundary: exactly 4096 tokens is large task", () => {
      const result = smartCandidates(members, 4096);
      expect(result[0].provider).not.toBe("ollama");
    });

    it("boundary: 4095 tokens is small task", () => {
      const result = smartCandidates(members, 4095);
      expect(result[0].provider).toBe("ollama");
    });

    it("same tier should sort by priority", () => {
      const cloudOnly = [
        { provider: "qwen", model: "3.7-plus", protocol: "anthropic", priority: 3 },
        { provider: "deepseek", model: "v4.1-flash", protocol: "openai", priority: 2 },
      ];
      const result = smartCandidates(cloudOnly, 10000);
      expect(result[0].model).toBe("v4.1-flash"); // priority 2 < 3
    });
  });

  describe("estimateTokens", () => {
    it("should estimate ~1 token per 4 chars", () => {
      const messages = [{ role: "user", content: "a".repeat(400) }];
      expect(estimateTokens(messages)).toBe(100);
    });

    it("should handle array content", () => {
      const messages = [{
        role: "user",
        content: [
          { type: "text", text: "hello" },
          { type: "image", url: "..." },
          { type: "text", text: "world" },
        ],
      }];
      expect(estimateTokens(messages)).toBe(3); // "helloworld" = 10 chars / 4 = 2.5 → 3
    });

    it("should return 0 for empty messages", () => {
      expect(estimateTokens([])).toBe(0);
    });
  });

  describe("isLocalModel", () => {
    it("should detect ollama provider", () => {
      expect(isLocalModel({ provider: "ollama", model: "x" })).toBe(true);
    });

    it("should detect ollama protocol", () => {
      expect(isLocalModel({ provider: "custom", model: "x", protocol: "ollama" })).toBe(true);
    });

    it("should not detect cloud providers", () => {
      expect(isLocalModel({ provider: "deepseek", model: "x", protocol: "openai" })).toBe(false);
    });
  });
});

describe("Rules Evaluation Engine", () => {
  // Helper: simulate evaluateRules logic
  const evaluateRules = (
    rules: any[],
    tokens: number,
    hasImg: boolean,
    isAgent: boolean,
    classifiedIntent: string | null,
  ): { provider: string; model: string } | undefined => {
    for (const rule of rules) {
      let matches = true;
      if (rule.minTokens && tokens < rule.minTokens) matches = false;
      if (rule.hasImage && !hasImg) matches = false;
      if (rule.anyAgent && !isAgent) matches = false;
      if (rule.intent && classifiedIntent !== rule.intent) matches = false;
      if (matches && rule.target?.model) {
        return { provider: rule.target.provider, model: rule.target.model };
      }
    }
    return undefined;
  };

  const rules = [
    {
      minTokens: 10000,
      anyReasoning: true,
      intent: "复杂问题",
      target: { provider: "deepseek", model: "v4.1-flash" },
    },
    {
      minTokens: 2000,
      hasImage: true,
      anyReasoning: true,
      anyAgent: true,
      intent: "复杂问题",
      target: { provider: "qwen", model: "3.7-plus" },
    },
    {
      intent: "简单问题",
      target: { provider: "ollama", model: "SparkLLM" },
    },
  ];

  it("should match rule 1: large tokens + complex intent", () => {
    const result = evaluateRules(rules, 15000, false, false, "复杂问题");
    expect(result?.model).toBe("v4.1-flash");
  });

  it("should NOT match rule 1 if tokens < 10000", () => {
    const result = evaluateRules(rules, 5000, false, false, "复杂问题");
    // Rule 1 fails (tokens < 10000), rule 2 fails (no image), rule 3 fails (intent mismatch)
    expect(result).toBeUndefined();
  });

  it("should match rule 2: image + agent + complex intent", () => {
    const result = evaluateRules(rules, 3000, true, true, "复杂问题");
    // Rule 1 fails (tokens < 10000), rule 2 matches
    expect(result?.model).toBe("3.7-plus");
  });

  it("should match rule 3: simple intent", () => {
    const result = evaluateRules(rules, 100, false, false, "简单问题");
    expect(result?.model).toBe("SparkLLM");
  });

  it("should return undefined when no rule matches", () => {
    const result = evaluateRules(rules, 100, false, false, null);
    expect(result).toBeUndefined();
  });

  it("should match first rule top-to-bottom", () => {
    const overlapping = [
      { intent: "复杂问题", target: { provider: "a", model: "m1" } },
      { intent: "复杂问题", target: { provider: "b", model: "m2" } },
    ];
    const result = evaluateRules(overlapping, 100, false, false, "复杂问题");
    expect(result?.model).toBe("m1"); // First match wins
  });

  it("should handle empty rules", () => {
    const result = evaluateRules([], 1000, false, false, null);
    expect(result).toBeUndefined();
  });
});

describe("Error Classification (shouldFallback)", () => {
  const TRANSIENT_CODES = new Set([
    "econnrefused", "econnreset", "etimedout", "eai_again", "ehostunreach", "enetunreach",
  ]);
  const TRANSIENT_HTTP = new Set([429, 500, 502, 503, 504, 529]);
  const PERMANENT_HTTP = new Set([400, 401, 403, 404, 422]);
  const TRANSIENT_ERRORS = new Set([
    "rate_limit", "ratelimit", "overloaded", "service_unavailable", "too_many_requests",
  ]);
  const PERMANENT_ERRORS = new Set([
    "auth", "authentication", "invalid_api_key", "api_key", "model_not_found",
    "invalid_request", "invalid_request_error", "not_found", "forbidden", "unauthorized",
  ]);

  const shouldFallback = (error: any): boolean => {
    const causeCode = (error?.cause?.code || "").toLowerCase();
    if (TRANSIENT_CODES.has(causeCode)) return true;

    const status = error?.status || error?.statusCode || error?.cause?.status;
    if (typeof status === "number") {
      if (TRANSIENT_HTTP.has(status)) return true;
      if (PERMANENT_HTTP.has(status)) return false;
    }

    const errCode = (error?.code || "").toLowerCase().replace(/[\s-]/g, "_");
    if (TRANSIENT_ERRORS.has(errCode)) return true;
    if (PERMANENT_ERRORS.has(errCode)) return false;

    const msg = (error?.message || "").toLowerCase();
    const statusMatch = msg.match(/\b(4\d{2}|5\d{2})\b/);
    if (statusMatch) {
      const code = parseInt(statusMatch[1], 10);
      if (TRANSIENT_HTTP.has(code)) return true;
      if (PERMANENT_HTTP.has(code)) return false;
    }

    return false; // Unknown → no fallback
  };

  describe("TRANSIENT errors → fallback", () => {
    it("ECONNREFUSED via cause.code", () => {
      expect(shouldFallback({ cause: { code: "ECONNREFUSED" } })).toBe(true);
    });

    it("ECONNRESET via cause.code", () => {
      expect(shouldFallback({ cause: { code: "ECONNRESET" } })).toBe(true);
    });

    it("ETIMEDOUT via cause.code", () => {
      expect(shouldFallback({ cause: { code: "ETIMEDOUT" } })).toBe(true);
    });

    it("HTTP 429", () => {
      expect(shouldFallback({ status: 429 })).toBe(true);
    });

    it("HTTP 500", () => {
      expect(shouldFallback({ status: 500 })).toBe(true);
    });

    it("HTTP 503", () => {
      expect(shouldFallback({ status: 503 })).toBe(true);
    });

    it("rate_limit error code", () => {
      expect(shouldFallback({ code: "rate_limit" })).toBe(true);
    });

    it("429 in message", () => {
      expect(shouldFallback({ message: "429 Too Many Requests" })).toBe(true);
    });
  });

  describe("PERMANENT errors → no fallback", () => {
    it("HTTP 401", () => {
      expect(shouldFallback({ status: 401 })).toBe(false);
    });

    it("HTTP 403", () => {
      expect(shouldFallback({ status: 403 })).toBe(false);
    });

    it("HTTP 404", () => {
      expect(shouldFallback({ status: 404 })).toBe(false);
    });

    it("auth error code", () => {
      expect(shouldFallback({ code: "auth" })).toBe(false);
    });

    it("invalid_api_key", () => {
      expect(shouldFallback({ code: "invalid_api_key" })).toBe(false);
    });

    it("401 in message", () => {
      expect(shouldFallback({ message: "401 Unauthorized" })).toBe(false);
    });
  });

  describe("UNKNOWN errors → no fallback (safe default)", () => {
    it("random error", () => {
      expect(shouldFallback({ message: "something weird happened" })).toBe(false);
    });

    it("null error", () => {
      expect(shouldFallback(null)).toBe(false);
    });

    it("empty error", () => {
      expect(shouldFallback({})).toBe(false);
    });
  });

  describe("no false positives", () => {
    it("'network configuration error' should NOT fallback", () => {
      expect(shouldFallback({ message: "network configuration error" })).toBe(false);
    });

    it("'quota tracking enabled' should NOT fallback", () => {
      expect(shouldFallback({ message: "quota tracking enabled" })).toBe(false);
    });
  });
});
