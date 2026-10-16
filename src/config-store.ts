/**
 * Shared config store for dsh-llm-router
 * Both the Router (host) and Settings UI (client) use this to read/write config.
 *
 * Config is stored via DSH settings service (settings.update), NOT in cordis.patch.yml.
 * The settings service persists to the profile and survives restarts.
 */

export interface RouterMemberConfig {
  provider: string;
  model: string;
  protocol?: string;
  enabled?: boolean;
  priority?: number;
  weight?: number;
  apiKey?: string;
  baseUrl?: string;
}

export interface RouterRuleConfig {
  minTokens?: number;
  hasImage?: boolean;
  anyReasoning?: boolean;
  anyAgent?: boolean;
  intent?: string;
  target: { provider: string; model: string };
}

export interface RouterGroupConfig {
  id: string;
  name?: string;
  strategy?: string;
  /** Stays cache-affinity mode; missing value falls back to "session" in the router. */
  stays?: "auto" | "session" | "turn" | "off";
  members: RouterMemberConfig[];
  rules?: RouterRuleConfig[];
  classifierModel?: { provider: string; model: string };
  enabled?: boolean;
}

export interface LLMRouterConfig {
  enabled?: boolean;
  defaultGroup?: string;
  routeGroups: RouterGroupConfig[];
  fallback?: {
    enabled?: boolean;
    maxRetries?: number;
    retryDelay?: number;
  };
  quotaTracking?: { enabled?: boolean };
}

/** Settings namespace for this plugin */
export const SETTINGS_NS = "llm-router";

/** Default config when nothing is saved */
export const DEFAULT_CONFIG: LLMRouterConfig = {
  enabled: true,
  defaultGroup: "default",
  routeGroups: [],
};

/**
 * Read config from DSH settings service (host-side)
 * @param ctx - cordis Context with settings service
 */
export function readConfigFromSettings(ctx: any): LLMRouterConfig {
  try {
    const settings = ctx?.get?.("settings");
    if (!settings || typeof settings.describe !== "function") return DEFAULT_CONFIG;

    // describe() returns SettingsDescriptor[] with .value = live projected config
    const descriptors = settings.describe();
    if (!Array.isArray(descriptors)) return DEFAULT_CONFIG;

    const descriptor = descriptors.find((d: any) => d?.ns === SETTINGS_NS);
    if (!descriptor?.value || typeof descriptor.value !== "object") return DEFAULT_CONFIG;

    const value = descriptor.value;

    // Resolve schemastery references in value
    const resolve = (v: any): any => {
      if (v === undefined || v === null) return v;
      if (typeof v === "object" && typeof v.get === "function") return v.get();
      return v;
    };

    const resolved: any = {};
    for (const key of Object.keys(value)) {
      resolved[key] = resolve(value[key]);
    }

    return { ...DEFAULT_CONFIG, ...resolved };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * Write config to DSH settings service (host-side)
 * @param ctx - cordis Context with settings service
 * @param config - config to save
 */
export async function writeConfigToSettings(
  ctx: any,
  config: LLMRouterConfig,
): Promise<boolean> {
  try {
    const settings = ctx?.get?.("settings");
    if (!settings) return false;
    await settings.update(SETTINGS_NS, config);
    return true;
  } catch (e) {
    console.error("[dsh-llm-router] Failed to write config:", e);
    return false;
  }
}
