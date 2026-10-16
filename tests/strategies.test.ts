import { describe, it, expect } from "vitest";
import {
  filterEnabled,
  orderCandidates,
  nextRotateIndex,
  rotateOrder,
  usageOrder,
  smartOrder,
  isLocalModel,
  affinityOrder,
  type StrategyMember,
  type StaysMode,
} from "../src/strategies";

/**
 * Unit tests for the 4 routing strategies.
 * These import the REAL ordering implementation (src/strategies.ts, used by
 * MagpieRouter.getCandidates) — no test-local mirrors that can drift from
 * production behavior.
 */

// Mirrors MagpieRouter.rotateCandidates' state wrapper on top of the pure
// helpers: nextRotateIndex returns -1 when there is nothing to rotate, in
// which case the router returns an empty chain and persists no state.
const rotateCandidates = (
  members: StrategyMember[],
  lastIndex: number,
): { ordered: StrategyMember[]; nextIndex: number } => {
  const nextIndex = nextRotateIndex(lastIndex, members.length);
  if (nextIndex < 0) return { ordered: [], nextIndex };
  return { ordered: rotateOrder(members, nextIndex), nextIndex };
};

const members: StrategyMember[] = [
  { provider: "ollama", model: "SparkLLM", protocol: "ollama", priority: 1 },
  { provider: "qwen37plus", model: "qwen3.7-plus", protocol: "anthropic-messages", priority: 2 },
  { provider: "deepseek", model: "v4.1-flash", protocol: "openai-responses", priority: 3 },
];

describe("Strategy: order (按顺序)", () => {
  it("should sort by priority ascending", () => {
    const shuffled = [members[2], members[0], members[1]];
    const result = orderCandidates(shuffled);
    expect(result.map((m) => m.model)).toEqual(["SparkLLM", "qwen3.7-plus", "v4.1-flash"]);
  });

  it("should handle missing priority (default 0)", () => {
    const noPriority: StrategyMember[] = [
      { provider: "a", model: "m1" },
      { provider: "b", model: "m2", priority: 5 },
    ];
    const result = orderCandidates(noPriority);
    expect(result[0].model).toBe("m1"); // priority 0 < 5
  });

  it("should not mutate the input array", () => {
    const input = [members[2], members[0]];
    const result = orderCandidates(input);
    expect(result).not.toBe(input);
    expect(input.map((m) => m.model)).toEqual(["v4.1-flash", "SparkLLM"]);
  });
});

describe("Strategy: rotate (轮流)", () => {
  it("should rotate starting index each call", () => {
    const r1 = rotateCandidates(members, -1);
    expect(r1.ordered[0].model).toBe("SparkLLM"); // index 0
    expect(r1.nextIndex).toBe(0);

    const r2 = rotateCandidates(members, 0);
    expect(r2.ordered[0].model).toBe("qwen3.7-plus"); // index 1
    expect(r2.nextIndex).toBe(1);

    const r3 = rotateCandidates(members, 1);
    expect(r3.ordered[0].model).toBe("v4.1-flash"); // index 2
    expect(r3.nextIndex).toBe(2);

    const r4 = rotateCandidates(members, 2);
    expect(r4.ordered[0].model).toBe("SparkLLM"); // wraps to 0
    expect(r4.nextIndex).toBe(0);
  });

  it("should return an empty chain (no NaN) when there are no members", () => {
    const r = rotateCandidates([], -1);
    expect(r.ordered).toEqual([]);
    expect(Number.isFinite(r.nextIndex)).toBe(true); // was NaN → poisoned lastUsedIndex
  });

  it("should recover from a persisted non-finite index (self-heal)", () => {
    // A NaN persisted by an older version must not freeze rotation forever.
    expect(nextRotateIndex(NaN, 3)).toBe(0);
    expect(nextRotateIndex(Infinity, 3)).toBe(0);
    expect(nextRotateIndex(-1, 0)).toBe(-1);
    expect(nextRotateIndex(1, 3)).toBe(2);
  });
});

describe("Strategy: usage (最少使用)", () => {
  it("should prioritize least-used members", () => {
    const usage = new Map<string, number>([
      ["ollama:SparkLLM", 100],
      ["qwen37plus:qwen3.7-plus", 10],
      ["deepseek:v4.1-flash", 50],
    ]);
    const result = usageOrder(members, usage);
    expect(result.map((m) => m.model)).toEqual(["qwen3.7-plus", "v4.1-flash", "SparkLLM"]);
  });

  it("should handle members with no usage (0)", () => {
    const usage = new Map<string, number>([["ollama:SparkLLM", 5]]);
    const result = usageOrder(members, usage);
    // qwen and deepseek have 0 usage, come first
    expect(result[0].model).not.toBe("SparkLLM");
  });

  it("should keep usage key format provider:model", () => {
    // recordUsage/usageOrder must agree on the key separator.
    const usage = new Map<string, number>([["p1:m1", 7]]);
    const result = usageOrder(
      [
        { provider: "p1", model: "m1" },
        { provider: "p2", model: "m2" },
      ],
      usage,
    );
    expect(result[0].provider).toBe("p2"); // p1 has 7 uses → sorted last
  });
});

describe("Strategy: smart (智能路由)", () => {
  it("small task (< 4096 tokens) should prefer local (ollama)", () => {
    const result = smartOrder(members, 100);
    expect(result[0].provider).toBe("ollama");
  });

  it("large task (≥ 4096 tokens) should prefer cloud", () => {
    const result = smartOrder(members, 10000);
    expect(result[0].provider).not.toBe("ollama");
  });

  it("boundary: 4096 tokens is large task", () => {
    const result = smartOrder(members, 4096);
    expect(result[0].provider).not.toBe("ollama");
  });

  it("boundary: 4095 tokens is small task", () => {
    const result = smartOrder(members, 4095);
    expect(result[0].provider).toBe("ollama");
  });

  it("same tier should sort by priority", () => {
    const cloudOnly: StrategyMember[] = [
      { provider: "qwen", model: "q1", protocol: "anthropic", priority: 3 },
      { provider: "deepseek", model: "d1", protocol: "openai", priority: 1 },
    ];
    const result = smartOrder(cloudOnly, 10000);
    expect(result[0].model).toBe("d1"); // priority 1 < 3
  });

  it("isLocalModel detects ollama by provider or protocol (case-insensitive)", () => {
    expect(isLocalModel({ provider: "Ollama", model: "x" })).toBe(true);
    expect(isLocalModel({ provider: "custom", model: "x", protocol: "Ollama" })).toBe(true);
    expect(isLocalModel({ provider: "deepseek", model: "x", protocol: "openai" })).toBe(false);
    expect(isLocalModel(undefined)).toBe(false);
  });
});

describe("enabled filtering", () => {
  it("should treat missing enabled as enabled (default true)", () => {
    const mixed: StrategyMember[] = [
      { provider: "a", model: "m1" }, // no enabled → enabled
      { provider: "b", model: "m2", enabled: false }, // disabled
      { provider: "c", model: "m3", enabled: true }, // enabled
    ];
    const enabled = filterEnabled(mixed);
    expect(enabled.map((m) => m.model)).toEqual(["m1", "m3"]);
  });

  it("should drop null/undefined entries", () => {
    const withHoles = [
      { provider: "a", model: "m1" },
      null as unknown as StrategyMember,
      { provider: "c", model: "m3", enabled: true },
    ];
    expect(filterEnabled(withHoles).map((m) => m.model)).toEqual(["m1", "m3"]);
  });
});

describe("Stays: affinityOrder (缓存亲和)", () => {
  const NOW = 1_000_000;
  const ordered: StrategyMember[] = [
    { provider: "ollama", model: "SparkLLM" },
    { provider: "qwen37plus", model: "qwen3.7-plus" },
    { provider: "deepseek", model: "v4.1-flash" },
  ];
  const last = (provider: string, model: string, ts: number) => ({ provider, model, ts });

  it("mode=off never reorders, even with a fresh record", () => {
    const result = affinityOrder(ordered, last("deepseek", "v4.1-flash", NOW), "off", NOW);
    expect(result.map((m) => m.model)).toEqual(["SparkLLM", "qwen3.7-plus", "v4.1-flash"]);
  });

  it("missing record returns the chain unchanged", () => {
    expect(affinityOrder(ordered, undefined, "session", NOW).map((m) => m.model))
      .toEqual(["SparkLLM", "qwen3.7-plus", "v4.1-flash"]);
    expect(affinityOrder(ordered, null, "auto", NOW).map((m) => m.model))
      .toEqual(["SparkLLM", "qwen3.7-plus", "v4.1-flash"]);
  });

  it("turn: fresh record (60s) moves the member to front, rest keep relative order", () => {
    const result = affinityOrder(ordered, last("deepseek", "v4.1-flash", NOW - 60_000), "turn", NOW);
    expect(result.map((m) => m.model)).toEqual(["v4.1-flash", "SparkLLM", "qwen3.7-plus"]);
  });

  it("turn: expired record (121s) is ignored; boundary (120s) is still fresh", () => {
    const expired = affinityOrder(ordered, last("deepseek", "v4.1-flash", NOW - 121_000), "turn", NOW);
    expect(expired[0].model).toBe("SparkLLM");
    const boundary = affinityOrder(ordered, last("deepseek", "v4.1-flash", NOW - 120_000), "turn", NOW);
    expect(boundary[0].model).toBe("v4.1-flash");
  });

  it("auto: 299s fresh, 301s expired", () => {
    const fresh = affinityOrder(ordered, last("qwen37plus", "qwen3.7-plus", NOW - 299_000), "auto", NOW);
    expect(fresh[0].model).toBe("qwen3.7-plus");
    const stale = affinityOrder(ordered, last("qwen37plus", "qwen3.7-plus", NOW - 301_000), "auto", NOW);
    expect(stale[0].model).toBe("SparkLLM");
  });

  it("session: unbounded window (1h old still sticks)", () => {
    const result = affinityOrder(ordered, last("deepseek", "v4.1-flash", NOW - 3_600_000), "session", NOW);
    expect(result[0].model).toBe("v4.1-flash");
  });

  it("record for a member absent from ordered (disabled/removed) is ignored", () => {
    const result = affinityOrder(ordered, last("ghost", "gone", NOW), "session", NOW);
    expect(result.map((m) => m.model)).toEqual(["SparkLLM", "qwen3.7-plus", "v4.1-flash"]);
  });

  it("record already at front is idempotent", () => {
    const result = affinityOrder(ordered, last("ollama", "SparkLLM", NOW), "session", NOW);
    expect(result.map((m) => m.model)).toEqual(["SparkLLM", "qwen3.7-plus", "v4.1-flash"]);
  });

  it("empty and single-element chains do not throw", () => {
    expect(affinityOrder([], last("a", "b", NOW), "session", NOW)).toEqual([]);
    const single = [{ provider: "a", model: "b" }];
    expect(affinityOrder(single, last("a", "b", NOW), "session", NOW).map((m) => m.model)).toEqual(["b"]);
  });

  it("unknown mode (corrupted config) falls back to no affinity", () => {
    const result = affinityOrder(ordered, last("deepseek", "v4.1-flash", NOW), "bogus" as StaysMode, NOW);
    expect(result.map((m) => m.model)).toEqual(["SparkLLM", "qwen3.7-plus", "v4.1-flash"]);
  });

  it("requires both provider AND model to match (same model, other provider ≠ hit)", () => {
    const result = affinityOrder(ordered, last("ollama", "qwen3.7-plus", NOW), "session", NOW);
    expect(result[0].model).toBe("SparkLLM");
  });

  it("never mutates the input array", () => {
    const input = [...ordered];
    const result = affinityOrder(input, last("deepseek", "v4.1-flash", NOW), "session", NOW);
    expect(result).not.toBe(input);
    expect(input.map((m) => m.model)).toEqual(["SparkLLM", "qwen3.7-plus", "v4.1-flash"]);
  });

  it("custom windowsMs overrides take effect", () => {
    const result = affinityOrder(
      ordered,
      last("deepseek", "v4.1-flash", NOW - 2_000),
      "turn",
      NOW,
      { turn: 1_000 }, // 2s > 1s custom window → expired
    );
    expect(result[0].model).toBe("SparkLLM");
  });
});
