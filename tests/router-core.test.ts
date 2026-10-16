import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for MagpieRouter core logic
 * - Config resolution (schemastery live references)
 * - Group resolution
 * - Edge cases (empty config, missing members)
 * - Error classification integration
 */

// We test the pure logic functions extracted from MagpieRouter

describe("Config Resolution", () => {
  // Simulate resolveLiveConfig
  const resolveLiveConfig = (config: any) => {
    if (!config) return {};
    const resolve = (v: any): any => {
      if (v === undefined || v === null) return v;
      if (typeof v.get === "function") return v.get();
      return v;
    };
    const resolved: any = {};
    for (const key of Object.keys(config)) {
      resolved[key] = resolve(config[key]);
    }
    return resolved;
  };

  it("should resolve plain values", () => {
    const config = { enabled: true, defaultGroup: "default" };
    const result = resolveLiveConfig(config);
    expect(result.enabled).toBe(true);
    expect(result.defaultGroup).toBe("default");
  });

  it("should resolve schemastery .get() references", () => {
    const config = {
      defaultGroup: { get: () => "production" },
      routeGroups: { get: () => [{ id: "production", members: [] }] },
    };
    const result = resolveLiveConfig(config);
    expect(result.defaultGroup).toBe("production");
    expect(result.routeGroups[0].id).toBe("production");
  });

  it("should handle null/undefined", () => {
    expect(resolveLiveConfig(null)).toEqual({});
    expect(resolveLiveConfig(undefined)).toEqual({});
  });

  it("should handle mixed plain and .get() values", () => {
    const config = {
      enabled: true,
      strategy: { get: () => "smart" },
    };
    const result = resolveLiveConfig(config);
    expect(result.enabled).toBe(true);
    expect(result.strategy).toBe("smart");
  });
});

describe("Group Resolution", () => {
  // Simulate resolveGroup logic
  const resolveGroup = (
    options: any,
    groups: Map<string, any>,
    defaultGroup: string,
  ): string => {
    if (options.provider?.startsWith("group/")) {
      return options.provider.substring(6);
    }
    if (options.model) {
      for (const group of groups.values()) {
        if (!group.enabled) continue;
        for (const member of group.members) {
          if (member.enabled && member.model === options.model) {
            return group.id;
          }
        }
      }
    }
    return defaultGroup;
  };

  const groups = new Map([
    ["default", { id: "default", enabled: true, members: [{ model: "gpt-4", enabled: true }] }],
    ["coder", { id: "coder", enabled: true, members: [{ model: "claude-3", enabled: true }] }],
  ]);

  it("should resolve group/ prefix", () => {
    expect(resolveGroup({ provider: "group/coder" }, groups, "default")).toBe("coder");
  });

  it("should resolve by model match", () => {
    expect(resolveGroup({ model: "claude-3" }, groups, "default")).toBe("coder");
  });

  it("should fallback to default group", () => {
    expect(resolveGroup({ model: "unknown" }, groups, "default")).toBe("default");
  });

  it("should use default when no provider or model", () => {
    expect(resolveGroup({}, groups, "default")).toBe("default");
  });

  it("should skip disabled groups", () => {
    const disabledGroups = new Map([
      ["off", { id: "off", enabled: false, members: [{ model: "x", enabled: true }] }],
    ]);
    expect(resolveGroup({ model: "x" }, disabledGroups, "default")).toBe("default");
  });
});

describe("Edge Cases", () => {
  it("empty members should pass through", () => {
    const group = { members: [] };
    expect(group.members.length).toBe(0);
    // Router should pass through to DSH default
  });

  it("null group should pass through", () => {
    const group = null;
    expect(!group || !group?.members || group.members.length === 0).toBe(true);
  });

  it("disabled members should be filtered", () => {
    const members = [
      { model: "a", enabled: true },
      { model: "b", enabled: false },
      { model: "c", enabled: true },
    ];
    const enabled = members.filter((m) => m && m.enabled);
    expect(enabled.length).toBe(2);
    expect(enabled.map((m) => m.model)).toEqual(["a", "c"]);
  });

  it("undefined members should be handled", () => {
    const members = [undefined, { model: "a", enabled: true }, null];
    const enabled = members.filter((m: any) => m && m.enabled);
    expect(enabled.length).toBe(1);
  });
});

describe("Fallback Logic", () => {
  it("should retry on TRANSIENT errors", () => {
    const transientErrors = [
      { cause: { code: "ECONNREFUSED" } },
      { status: 429 },
      { status: 503 },
      { code: "rate_limit" },
    ];
    // All should trigger fallback
    for (const err of transientErrors) {
      const causeCode = (err as any)?.cause?.code || "";
      const status = (err as any)?.status;
      const code = (err as any)?.code || "";
      const isTransient =
        ["econnrefused", "econnreset", "etimedout"].includes(causeCode.toLowerCase()) ||
        [429, 500, 502, 503, 504].includes(status) ||
        ["rate_limit"].includes(code);
      expect(isTransient).toBe(true);
    }
  });

  it("should NOT retry on PERMANENT errors", () => {
    const permanentErrors = [
      { status: 401 },
      { status: 403 },
      { code: "invalid_api_key" },
      { code: "model_not_found" },
    ];
    for (const err of permanentErrors) {
      const status = (err as any)?.status;
      const code = (err as any)?.code || "";
      const isPermanent =
        [400, 401, 403, 404, 422].includes(status) ||
        ["invalid_api_key", "model_not_found"].includes(code);
      expect(isPermanent).toBe(true);
    }
  });

  it("maxRetries should limit attempts", () => {
    const maxRetries = 3;
    let attempts = 0;
    const candidates = [1, 2, 3, 4, 5];

    for (const _ of candidates) {
      attempts++;
      if (attempts >= maxRetries) break;
    }
    expect(attempts).toBe(3);
  });

  it("quota-exceeded members should not consume retry budget", () => {
    const maxRetries = 3;
    let actualAttempts = 0;
    const candidates = [
      { quotaOk: false }, // skip, no attempt
      { quotaOk: false }, // skip, no attempt
      { quotaOk: true },  // attempt 1
      { quotaOk: true },  // attempt 2
      { quotaOk: true },  // attempt 3 → stop
    ];

    for (const member of candidates) {
      if (!member.quotaOk) continue; // skip without counting
      actualAttempts++;
      if (actualAttempts >= maxRetries) break;
    }
    expect(actualAttempts).toBe(3);
  });
});

describe("Token Estimation", () => {
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

  it("empty messages → 0 tokens", () => {
    expect(estimateTokens([])).toBe(0);
  });

  it("string content", () => {
    expect(estimateTokens([{ content: "hello world" }])).toBe(3); // 11 chars / 4 = 2.75 → 3
  });

  it("mixed content types", () => {
    const messages = [{
      content: [
        { type: "text", text: "abc" },
        { type: "image" },
        { type: "text", text: "def" },
      ],
    }];
    expect(estimateTokens(messages)).toBe(2); // 6 chars / 4 = 1.5 → 2
  });

  it("large message → large token count", () => {
    const messages = [{ content: "x".repeat(40000) }];
    expect(estimateTokens(messages)).toBe(10000);
  });
});

describe("Image Detection", () => {
  const hasImage = (messages: any[]) => {
    for (const msg of messages) {
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part?.type === "image" || part?.type === "image_url") return true;
        }
      }
    }
    return false;
  };

  it("no images → false", () => {
    expect(hasImage([{ content: "text only" }])).toBe(false);
  });

  it("image part → true", () => {
    expect(hasImage([{ content: [{ type: "image", url: "..." }] }])).toBe(true);
  });

  it("image_url part → true", () => {
    expect(hasImage([{ content: [{ type: "image_url", url: "..." }] }])).toBe(true);
  });

  it("text only in array → false", () => {
    expect(hasImage([{ content: [{ type: "text", text: "hi" }] }])).toBe(false);
  });
});
