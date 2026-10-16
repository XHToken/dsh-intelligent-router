/**
 * DSH-LLM-Router Client Bundle
 * Settings UI integration for DSH
 */

import React from "react";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import { LLMRouterSettings } from "./settings-ui";
import "./settings-ui.css";

// Locale namespace
const NS = "settings.llm-router";
const PLUGIN_ID = "dsh-llm-router";

// Localization strings
const en = {
  nav: "LLM Router",
  title: "LLM Router Settings",
  description:
    "Configure intelligent LLM routing with failover and smart strategies",
};

const zh = {
  nav: "LLM 路由器",
  title: "LLM 路由器设置",
  description: "配置智能 LLM 路由，支持故障转移和智能策略",
};

// Required services
export const inject = ["slots", "locale"];

/**
 * Client bundle entry point
 * Registers the LLM Router settings tab with DSH's Settings system
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS);

  // Register locale strings
  ctx.effect(() => {
    ctx.locale.register(NS, { zh, en });
  }, "llm-router: locale registration");

  // Register settings tab
  ctx.effect(() => {
    const unregister = ctx.slots.register(
      "settings.plugins.tab",
      {
        id: "llm-router",
        order: 10,
        label: () => t("nav"),
      },
      LLMRouterSettingsTab,
    );
    return unregister;
  }, "llm-router: settings tab registration");
}

/**
 * Settings tab component wrapper
 */
function LLMRouterSettingsTab() {
  // Force React to be in scope for JSX
  const _React = React;
  void _React;

  return (
    <div className="llm-router-settings-wrapper">
      <div style={{ padding: "20px" }}>
        <h3>LLM Router Settings</h3>
        <p style={{ color: "#666", marginTop: "10px" }}>
          Plugin settings are configured in <code>cordis.patch.yml</code>
        </p>
        <p style={{ color: "#999", fontSize: "14px", marginTop: "10px" }}>
          To modify routing rules, models, or strategies, edit the configuration
          file and restart DSH.
        </p>
      </div>
    </div>
  );
}

// Type declarations for DSH's slot system
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    "settings.llm-router": typeof en;
  }
}
