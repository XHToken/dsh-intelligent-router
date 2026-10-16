/**
 * DSH-LLM-Router Host Plugin
 *
 * Architecture: registerAdapter + prepareCall().stream() 透传
 * 参考: dsh-smart-router, llm-adaptive
 *
 * Known DSH issue: turn-tail shows "Cannot read properties of undefined
 * (reading 'includes')" for virtual routing providers. The response IS
 * generated and displayed correctly; the error is in DSH's client-side
 * turn-tail post-processing (DSH bug, not fixable from plugin side).
 */

import type { Context } from "@cordis/core";
import { MagpieRouter } from "./router";
import { RouterSettingsSchema } from "./settings-schema";
import type { RouterSettings } from "./settings-schema";

export const name = "dsh-llm-router";
export const inject = ["llm"];
export const Config = RouterSettingsSchema;
export type Config = RouterSettings;

function resolveConfig<T>(value: any): T {
  if (value === undefined || value === null) return value;
  if (typeof value.get === "function") return value.get();
  return value;
}

function resolveAllConfig(config: any): any {
  const resolved: any = {};
  for (const key of Object.keys(config)) {
    resolved[key] = resolveConfig(config[key]);
  }
  return resolved;
}

export function apply(ctx: Context, config: any): void {
  const cfg = resolveAllConfig(config);
  if (cfg.enabled === false) return;

  const router = new MagpieRouter(ctx, config);

  // Register "auto" adapter (model list + stream routing)
  try {
    const llm = (ctx as any).llm;
    if (llm && typeof llm.registerAdapter === "function") {
      llm.registerAdapter(["auto"], router);
    }
  } catch (error) {
    console.error("[dsh-llm-router] Failed to register adapter:", error);
  }

  // Settings UI
  try {
    ctx.inject(["settings"], (child: any) => {
      child.effect(() => {
        return child.settings.configure({ auto: false }, ctx.fiber);
      });
    });
  } catch (error) {
    // Settings service not available
  }
}
