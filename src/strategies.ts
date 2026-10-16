/**
 * Pure routing-strategy ordering logic for dsh-llm-router.
 *
 * Extracted from MagpieRouter (src/router.ts) so the real ordering code is
 * directly unit-testable (tests/strategies.test.ts) instead of mirrored in
 * test-local copies that can silently drift from production behavior.
 */

/**
 * Minimal structural member shape used by the ordering functions.
 * RouteGroupMember (src/types.ts) is assignable to this; config-store's
 * RouterMemberConfig is as well.
 */
export interface StrategyMember {
  provider: string;
  model: string;
  priority?: number;
  enabled?: boolean;
  protocol?: string;
}

/** Keep only enabled members (missing enabled = enabled, per DSH config semantics). */
export const filterEnabled = <T extends StrategyMember>(members: T[]): T[] =>
  members.filter((m) => m && m.enabled !== false);

/** Order strategy: sort by priority ascending (missing priority = 0). */
export const orderCandidates = <T extends StrategyMember>(members: T[]): T[] =>
  [...members].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

/**
 * Rotate strategy: compute the next round-robin index.
 * Returns -1 when there are no members to rotate over. Non-finite persisted
 * indices (e.g. a NaN stored by an older version after a group went empty)
 * are treated as "fresh start" (-1) so rotation self-heals.
 */
export const nextRotateIndex = (lastIndex: number, count: number): number => {
  if (count <= 0) return -1;
  const safe = Number.isFinite(lastIndex) ? lastIndex : -1;
  return (safe + 1) % count;
};

/** Rotate strategy: rotate the member list so the candidate chain starts at nextIndex. */
export const rotateOrder = <T extends StrategyMember>(members: T[], nextIndex: number): T[] => {
  if (nextIndex < 0 || nextIndex >= members.length) return [...members];
  return [...members.slice(nextIndex), ...members.slice(0, nextIndex)];
};

/** Usage strategy: prioritize least-used members (missing usage = 0). */
export const usageOrder = <T extends StrategyMember>(
  members: T[],
  usageCounts: Map<string, number>,
): T[] =>
  [...members].sort((a, b) => {
    const countA = usageCounts.get(`${a.provider}:${a.model}`) ?? 0;
    const countB = usageCounts.get(`${b.provider}:${b.model}`) ?? 0;
    return countA - countB;
  });

/** Check if a model is local (ollama provider or protocol). */
export const isLocalModel = (m: StrategyMember | null | undefined): boolean => {
  const provider = (m?.provider || "").toLowerCase();
  const protocol = (m?.protocol || "").toLowerCase();
  return provider.includes("ollama") || protocol.includes("ollama");
};

/**
 * Smart strategy: 智能路由
 * - Small tasks (< 4096 tokens): local model first (ollama), then cloud
 * - Large tasks (≥ 4096 tokens): cloud model first, then local
 * - Within same tier: sort by priority
 */
export const smartOrder = <T extends StrategyMember>(members: T[], tokens: number): T[] => {
  const isSmallTask = tokens < 4096;
  return [...members].sort((a, b) => {
    const aLocal = isLocalModel(a);
    const bLocal = isLocalModel(b);
    if (isSmallTask) {
      // Small task: local first
      if (aLocal && !bLocal) return -1;
      if (!aLocal && bLocal) return 1;
    } else {
      // Large task: cloud first
      if (!aLocal && bLocal) return -1;
      if (aLocal && !bLocal) return 1;
    }
    // Same tier: sort by priority
    return (a.priority ?? 0) - (b.priority ?? 0);
  });
};

/**
 * Stays cache-affinity mode (the "保持" option in the Settings UI).
 * Stays on the last successful member while the vendor prompt cache is
 * worth keeping: within a turn always, across turns while it's fresh.
 */
export type StaysMode = "off" | "turn" | "auto" | "session";

/** Last successful member, keyed per session/group. */
export interface AffinityRecord {
  provider: string;
  model: string;
  /** Date.now() at the successful call. */
  ts: number;
}

/** Default affinity windows (ms). turn approximates one turn; auto ≈ vendor prompt-cache TTL. */
export const AFFINITY_TURN_MS = 120_000;
export const AFFINITY_AUTO_MS = 300_000;

/**
 * Stays (affinity) pre-ordering: move the last successful member to the front
 * of an already strategy-ordered chain, while the affinity window is fresh.
 *
 * Returns the chain (shallow copy) unchanged when: mode is off/unknown, there
 * is no record, the record expired, or the record's member is absent from
 * `ordered` (removed/disabled — `ordered` is already filterEnabled upstream).
 * Windows: turn=120s (approximates one turn, platform has no turnId),
 * auto=300s (Anthropic prompt-cache TTL), session=unbounded, off=never.
 * Never mutates the input array.
 */
export const affinityOrder = <T extends StrategyMember>(
  ordered: T[],
  last: AffinityRecord | null | undefined,
  mode: StaysMode,
  now: number,
  windowsMs?: { turn?: number; auto?: number },
): T[] => {
  const ttl =
    mode === "session"
      ? Infinity
      : mode === "turn"
        ? (windowsMs?.turn ?? AFFINITY_TURN_MS)
        : mode === "auto"
          ? (windowsMs?.auto ?? AFFINITY_AUTO_MS)
          : -1; // off or unknown mode → no affinity
  if (ttl < 0 || !last || !ordered.length) return [...ordered];
  if (now - last.ts > ttl) return [...ordered];
  const hit = ordered.find(
    (m) => m.provider === last.provider && m.model === last.model,
  );
  if (!hit) return [...ordered];
  return [hit, ...ordered.filter((m) => m !== hit)];
};
