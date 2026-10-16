/**
 * DSH-LLM-Router Client Bundle
 * Browser-side plugin that registers with DSH's Settings UI
 */

import React from "react";
// Type-only imports for DSH's client-side systems
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type { Context as ClientContext } from "@deepseek-ai/cordis";

// Import our Settings UI styles (the panel component is mounted by DSH's
// settings slot, not referenced directly from this bundle entry)
import "../settings-ui.css";

/** Dictionary namespace owned by this plugin. */
const NS = "settings.llm-router";

/** Localization strings */
const en = {
  nav: "LLM Router",
  title: "LLM Router",
  description: "Intelligent LLM routing with failover and smart strategies",
};

const zh = {
  nav: "LLM 路由器",
  title: "LLM 路由器",
  description: "智能 LLM 路由，支持故障转移和智能策略",
};

/** Required services (cordis fiber inject).
 * Reference: @deepseek-ai/dsh-client-ui-settings-models inject array
 */
export const inject = ["slots", "locale", "remote", "remote.llm", "remote.settings"];

/** Store client ctx for component access */
let clientCtx: any = null;

/**
 * Client-side plugin entry point
 * Called by DSH when the plugin is loaded in the browser
 */
export function apply(ctx: ClientContext): void {
  clientCtx = ctx;

  try {
    const t = ctx.locale.bind(NS);

    // Register locale strings (only if not already registered)
    ctx.effect(() => {
      try {
        ctx.locale.register(NS, { zh, en });
      } catch {
        // Locale already registered, ignore
      }
    }, "llm-router: locale registration");

    // Register settings tab into the Plugins settings section
    // Correct DSH slot API: inject(key, () => register({ name, id, ... }, Component))
    // Reference: @deepseek-ai/dsh-client-ui-settings-plugins PluginsSettingsSection
    //   renders: renderSlot("settings.plugins.tab", {}, { only: single.id })
    ctx.effect(() => {
      const unregister = (ctx.slots as any).inject(
        "settings.plugins.tab",
        () =>
          (ctx.slots as any).register(
            {
              name: "settings.plugins.tab",
              id: "llm-router",
              order: 10,
              label: () => t("nav"),
            },
            LLMRouterSettingsTab,
          ),
      );
      return unregister;
    }, "llm-router: settings tab registration");

  } catch (error) {
    console.error("[dsh-llm-router] Client bundle error:", error);
    throw error;
  }
}


/**
 * Settings tab component - Magpie design
 * Reference: https://github.com/yetone/magpie/blob/main/site/public/img/intent-rules-light.png
 *
 * Requirements:
 * 1. No Name field - defaults to "default" group
 * 2. Models list dynamically fetched from DSH Settings/Models via llm/listProviders API
 *    - Warning if model was deleted from Settings/Models
 *    - New models can be added via "Add another model" dropdown
 */

/** Fetch available models from DSH Settings/Models
 *
 * Reads configured models from settings describe API:
 * 1. listProviders() → active providers
 * 2. listConfigurableProviders() → settingsNs + settingsPath per provider
 * 3. settings.describe() → resolved values including models array
 */
async function fetchAvailableModels(ctx: any): Promise<Array<{ provider: string; model: string; protocol: string; label: string }>> {
  try {
    if (!ctx?.remote?.llm) return [];

    // Step 1: Get active providers + configurable providers
    const [activeResult, configResult] = await Promise.all([
      ctx.remote.llm.listProviders(),
      ctx.remote.llm.listConfigurableProviders(),
    ]);

    if (!activeResult?.ok || !Array.isArray(activeResult.value)) return [];

    const activeProviders = activeResult.value.filter(
      (p: any) => {
        const id = (p.id || "").toLowerCase();
        return id !== "auto" && id !== "deepseek-account";
      }
    );

    const configProviders = configResult?.ok && Array.isArray(configResult.value)
      ? configResult.value
      : [];

    // Step 2: Get settings describe to read configured models
    let settingsViews: any[] = [];
    try {
      if (ctx?.remote?.settings?.describe) {
        const descResult = await ctx.remote.settings.describe();

        // Result format: { ok: true, value: { writable, hasDocument, namespaces: [...] } }
        if (descResult?.ok && descResult?.value?.namespaces) {
          settingsViews = descResult.value.namespaces;
        } else if (Array.isArray(descResult)) {
          settingsViews = descResult;
        } else if (descResult?.namespaces) {
          settingsViews = descResult.namespaces;
        }
      } else {
      }
    } catch {
    }

    // Active providers loaded

    // Step 3: For each active provider, read settings to get baseURL + models
    const allModels: Array<{ provider: string; model: string; protocol: string; label: string }> = [];

    for (const provider of activeProviders) {
      const config = configProviders.find((p: any) => p.provider === provider.id);
      const settingsNs = config?.settingsNs || "";
      const settingsPath = config?.settingsPath || [];
      const displayName = config?.displayName || provider.name || provider.id;

      // Find the settings view for this provider's namespace
      const view = settingsViews.find((v: any) => v.ns === settingsNs);
      let section: any = view?.value;

      // Navigate to the provider's section using settingsPath
      if (section && settingsPath.length > 0) {
        for (const key of settingsPath) {
          if (section && typeof section === "object") {
            section = section[key];
          }
        }
      }

      // Extract baseURL and models from the section
      const baseURL = section?.baseURL || section?.baseUrl || "";
      const api = section?.api || "";
      let models: any[] = [];

      if (section && typeof section === "object") {
        if (Array.isArray(section.models)) {
          models = section.models;
        } else if (Array.isArray(section)) {
          models = section;
        }
      }

      // Try discoverModels with baseURL for endpoint-based discovery
      if (models.length === 0 && baseURL) {
        try {
          const modelsResult = await ctx.remote.llm.discoverModels(settingsNs, {
            provider: provider.id,
            baseURL: baseURL,
            api: api || undefined,
          });
          if (modelsResult?.ok && Array.isArray(modelsResult.value) && modelsResult.value.length > 0) {
            models = modelsResult.value;
          }
        } catch {
          // Discovery failed, continue with fallback
        }
      }

      if (models.length > 0) {
        for (const model of models) {
          const modelId = typeof model === "string" ? model : (model?.id || model?.name || "");
          if (modelId) {
            allModels.push({
              provider: provider.id,
              model: modelId,
              protocol: model?.api || api || "openai",
              label: displayName,
            });
          }
        }
      } else {
        allModels.push({
          provider: provider.id,
          model: displayName,
          protocol: "openai",
          label: displayName,
        });
      }
    }

    return allModels;
  } catch {
  }

  return [];
}

function LLMRouterSettingsTab() {
  // 默认为空 - 无预配置模型，通过"添加模型"从 DSH Settings/Models 选择
  const [members, setMembers] = React.useState<any[]>([]);
  const [availableModels, setAvailableModels] = React.useState<any[]>([]);
  const [routingStrategy, setRoutingStrategy] = React.useState("order");
  const [staysMode, setStaysMode] = React.useState("session");
  const [rules, setRules] = React.useState<any[]>([]);
  const [dirty, setDirty] = React.useState(false);
  const [language, setLanguage] = React.useState("en");
  const [showModelPicker, setShowModelPicker] = React.useState(false);
  const [classifierModel, setClassifierModel] = React.useState({ provider: "", model: "" });
  const [showRuleModelPicker, setShowRuleModelPicker] = React.useState<string | null>(null);
  const [validationErrors, setValidationErrors] = React.useState<string[]>([]);
  const [saveStatus, setSaveStatus] = React.useState("");

  // Detect language
  React.useEffect(() => {
    const detectLanguage = () => {
      try {
        const s = JSON.parse(localStorage.getItem("dsh-settings") || "{}");
        if (s.language) setLanguage(s.language);
      } catch { /* ignore */ }
      if (document.documentElement.lang?.startsWith("zh")) setLanguage("zh");
    };
    detectLanguage();
    const handler = (e: StorageEvent) => { if (e.key === "dsh-settings") detectLanguage(); };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  // Load saved config + fetch available models on mount
  React.useEffect(() => {
    // 1. Load saved config (localStorage first for reliability)
    loadSavedConfig();

    // 2. Fetch available models from DSH Settings/Models
    fetchAvailableModels(clientCtx).then((models) => {
      setAvailableModels(models);
    });
  }, []);

  /** Load saved config: localStorage first (reliable), then DSH settings */
  const loadSavedConfig = () => {
    // 1. localStorage (synchronous, always works)
    try {
      const stored = localStorage.getItem("llm-router-config");
      if (stored) {
        const saved = JSON.parse(stored);
        if (saved?.routeGroups?.length > 0 && saved.routeGroups[0]?.members?.length > 0) {
          applyConfig(saved);
          return;
        }
      }
    } catch {
    }

    // 2. DSH settings (async, may not have data yet)
    loadFromDshSettings();
  };

  /** Load from DSH settings API */
  const loadFromDshSettings = async () => {
    try {
      if (!clientCtx?.remote?.settings?.describe) return;
      const desc = await clientCtx.remote.settings.describe();
      const nsView = desc?.value?.namespaces?.find((v: any) => v.ns === "llm-router");
      const saved = nsView?.value;

      if (saved?.routeGroups?.length > 0 && saved.routeGroups[0]?.members?.length > 0) {
        applyConfig(saved);
        // Also cache to localStorage for next load
        try { localStorage.setItem("llm-router-config", JSON.stringify(saved)); } catch { /* ignore */ }
      }
    } catch {
    }
  };

  /** Apply loaded config to UI state */
  const applyConfig = (saved: any) => {
    const group = saved.routeGroups[0];
    if (!group) return;

    if (Array.isArray(group.members) && group.members.length > 0) {
      setMembers(group.members.map((m: any, i: number) => ({
        id: String(i + 1),
        provider: m.provider || "",
        model: m.model || "",
        protocol: m.protocol || "openai",
        available: true,
      })));
    }

    if (group.strategy) setRoutingStrategy(group.strategy);
    if (group.stays) setStaysMode(group.stays);

    if (Array.isArray(group.rules) && group.rules.length > 0) {
      setRules(group.rules.map((r: any, i: number) => ({
        id: String(i + 1),
        minTokens: r.minTokens ? String(r.minTokens) : "",
        hasImage: !!r.hasImage,
        anyReasoning: !!r.anyReasoning,
        anyAgent: !!r.anyAgent,
        asksFor: r.intent || "",
        targetProvider: r.target?.provider || "",
        targetModel: r.target?.model || "",
      })));
    }

    if (group.classifierModel?.model) {
      setClassifierModel({
        provider: group.classifierModel.provider || "",
        model: group.classifierModel.model || "",
      });
    }
  };

  const t = language === "zh" ? {
    models: "模型",
    addModel: "+ 添加模型", modelsHint: "第一个模型优先回答。按顺序，依次尝试。",
    routing: "路由", stays: "保持", staysHint: "会话保持在回答的账户或密钥上 — 一轮之内总是保持，跨轮次在缓存新鲜时保持。",
    rules: "规则", when: "当", sendTo: "先发给", addRule: "+ 添加规则",
    intentToldBy: "意图判断模型", remove: "删除", cancel: "取消", save: "保存",
    up: "上移", removeBtn: "删除", warning: "已从模型设置中删除",
    tokens: "tokens", hasImage: "带图片", anyReasoning: "任意推理", anyAgent: "任意 Agent",
    asksFor: "意图是", asksForPlaceholder: "这类消息想做什么，例如：写测试",
    intentHint: "每一轮开始时，这个模型被问一次消息属于哪个意图 — 选一个小而快、不带推理的模型。判断失败或答不出时，所有意图都不命中。",
    rulesHint: "从上往下检查：第一条命中的规则把它的模型排到第一，其余做故障转移。一轮进行中不会换模型。",
    viewConfig: "查看配置",
    strategies: {
      smart: { label: "智能", desc: "小任务使用本地模型，大任务选择云端模型。" },
      order: { label: "按顺序", desc: "第一个模型直到无法回答，然后下一个 — 各自走自己的账户或密钥。" },
      rotate: { label: "轮流", desc: "每次轮换到下一个成员。" },
      usage: { label: "最少使用", desc: "优先使用最少使用的成员。" },
    },
    staysModes: {
      auto: { label: "自动", desc: "在供应商缓存值得保持的范围内保持 — 一轮之内总是保持，跨轮次在缓存新鲜时保持。" },
      session: { label: "会话", desc: "整个会话保持在同一个模型上。" },
      turn: { label: "轮内", desc: "仅在一轮内保持。" },
      off: { label: "关闭", desc: "不保持。" },
    },
  } : {
    models: "Models",
    addModel: "+ Add another model", modelsHint: "The first answers for what the model can do. In order, they are tried top first.",
    routing: "Routing", stays: "Stays", staysHint: "A conversation stays with the account or key that answered it — within a turn always, across turns while it's fresh.",
    rules: "Rules", when: "When", sendTo: "send to", addRule: "+ Add a rule",
    intentToldBy: "Intent told by", remove: "Remove", cancel: "Cancel", save: "Save",
    up: "Up", removeBtn: "Remove", warning: "Removed from model settings",
    tokens: "tokens", hasImage: "has an image", anyReasoning: "any reasoning", anyAgent: "any agent",
    asksFor: "asks for", asksForPlaceholder: "what it asks for, e.g. writing tests",
    intentHint: "As a turn begins, this model is asked which intent the message is — once; a small, fast one without reasoning is best. If it fails or can't say, no intent matches.",
    rulesHint: "Checked top first: the first that matches sends that turn to its model first; the rest stay behind it if it fails. A turn under way is never moved.",
    viewConfig: "View config",
    strategies: {
      smart: { label: "Smart", desc: "Local model for small tasks, cloud model for large tasks." },
      order: { label: "In order", desc: "The first model until it can't answer, then the next — each over its own accounts or keys." },
      rotate: { label: "In turn", desc: "Rotate to next member on each turn." },
      usage: { label: "Least used", desc: "Prioritize least-used member." },
    },
    staysModes: {
      auto: { label: "Auto", desc: "Stays while what the vendor cached is worth keeping — within a turn always, across turns while it's fresh." },
      session: { label: "Session", desc: "Stays for the entire session." },
      turn: { label: "Within a turn", desc: "Stays only within a single turn." },
      off: { label: "Off", desc: "No staying." },
    },
  };

  const addMember = (modelInfo?: { provider: string; model: string; protocol: string; label: string }) => {
    if (modelInfo) {
      setMembers([...members, { id: Date.now().toString(), provider: modelInfo.provider, model: modelInfo.model, protocol: modelInfo.protocol, available: true }]);
      setShowModelPicker(false);
    } else {
      setShowModelPicker(!showModelPicker);
    }
    setDirty(true);
  };
  const removeMember = (id: string) => {
    const removed = members.find(m => m.id === id);
    setMembers(members.filter(m => m.id !== id));
    // Also remove from rules that reference this model
    if (removed) {
      setRules(rules.filter(r => !(r.targetProvider === removed.provider && r.targetModel === removed.model)));
      // Also clear classifier if it references the removed model
      if (classifierModel.provider === removed.provider && classifierModel.model === removed.model) {
        setClassifierModel({ provider: "", model: "" });
      }
    }
    setDirty(true);
  };
  const moveUp = (index: number) => {
    if (index === 0) return;
    const arr = [...members];
    [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
    setMembers(arr);
    setDirty(true);
  };
  const addRule = () => {
    setRules([...rules, { id: Date.now().toString(), minTokens: "", hasImage: false, anyReasoning: false, anyAgent: false, asksFor: "", targetProvider: "", targetModel: "" }]);
    setDirty(true);
  };
  const removeRule = (id: string) => { setRules(rules.filter(r => r.id !== id)); setDirty(true); };

  // Validation rules
  const validate = (): string[] => {
    const errors: string[] = [];
    const zh = language === "zh";

    // Rule 1: At least 1 model
    if (members.length === 0) {
      errors.push(zh ? "至少配置 1 个模型" : "At least 1 model is required");
    }

    // Rule 2: Each model must have provider and model
    members.forEach((m: any, i: number) => {
      if (!m.provider || !m.model) {
        errors.push(zh ? `模型 ${i + 1} 缺少提供商或模型名称` : `Model ${i + 1} is missing provider or model name`);
      }
    });

    // Rule 8: Duplicate models (warning)
    const modelKeys = members.map((m: any) => `${m.provider}/${m.model}`);
    const duplicates = modelKeys.filter((k: string, i: number) => modelKeys.indexOf(k) !== i);
    if (duplicates.length > 0) {
      errors.push(zh ? `重复模型: ${[...new Set(duplicates)].join(", ")}` : `Duplicate models: ${[...new Set(duplicates)].join(", ")}`);
    }

    // Rule 3: Rule "send to" must select a valid model
    const validModelKeys = new Set(members.map((m: any) => `${m.provider}/${m.model}`));
    rules.forEach((rule: any, i: number) => {
      if (rule.targetModel && !validModelKeys.has(`${rule.targetProvider}/${rule.targetModel}`)) {
        errors.push(zh ? `规则 ${i + 1} 的目标模型不在已配置模型中` : `Rule ${i + 1} target model is not in configured models`);
      }
      if (!rule.targetModel) {
        errors.push(zh ? `规则 ${i + 1} 未选择"先发给"模型` : `Rule ${i + 1} has no "send to" model selected`);
      }

      // Rule 4: Intent condition must not be empty
      if (rule.asksFor !== undefined && rule.asksFor === "" && rule._intentEnabled) {
        errors.push(zh ? `规则 ${i + 1} 的意图描述不能为空` : `Rule ${i + 1} intent description cannot be empty`);
      }
    });

    // Rule 5: If any rule uses intent, classifier model must be set
    const hasIntentRule = rules.some((r: any) => r.asksFor && r.asksFor.trim() !== "");
    if (hasIntentRule && (!classifierModel.model || !classifierModel.provider)) {
      errors.push(zh ? "有意图规则时必须设置意图判断模型" : "Intent classifier model is required when rules use intent");
    }

    // Rule 6: Tokens must be positive integer (auto-ignore if invalid)
    rules.forEach((rule: any, _i: number) => {
      if (rule.minTokens && (isNaN(Number(rule.minTokens)) || Number(rule.minTokens) <= 0)) {
        rule.minTokens = ""; // Auto-clear invalid tokens
      }
    });

    return errors;
  };

  const handleSave = async () => {
    const errors = validate();
    setValidationErrors(errors);
    if (errors.length > 0) return;

    // Only save VOLATILE fields (schema validates non-volatile fields throw).
    // 'enabled'/'defaultGroup' are managed by cordis.patch.yml, not the Settings UI.
    const config = {
      routeGroups: [{
        id: "default",
        name: "Default",
        members: members.map((m: any) => ({
          provider: m.provider,
          model: m.model,
          protocol: m.protocol,
          enabled: m.available !== false,
        })),
        strategy: routingStrategy,
        stays: staysMode,
        rules: rules.filter((r: any) => r.targetModel).map((r: any) => ({
          minTokens: r.minTokens ? Number(r.minTokens) : undefined,
          hasImage: r.hasImage || undefined,
          anyReasoning: r.anyReasoning || undefined,
          anyAgent: r.anyAgent || undefined,
          intent: r.asksFor || undefined,
          target: { provider: r.targetProvider, model: r.targetModel },
        })),
        classifierModel: classifierModel.model ? classifierModel : undefined,
      }],
    };

    // 1. Save to localStorage (synchronous backup)
    try {
      localStorage.setItem("llm-router-config", JSON.stringify(config));
    } catch (e) {
      console.error("[dsh-llm-router] localStorage save failed:", e);
    }

    // 2. Save to DSH settings (persists to cordis.patch.yml via configEditor)
    let saved = false;
    let saveError = "";
    try {
      if (clientCtx?.remote?.settings) {
        const desc = await clientCtx.remote.settings.describe();
        const namespaces = desc?.value?.namespaces || desc?.namespaces || [];
        const nsView = namespaces.find((v: any) => v.ns === "llm-router");

        if (!nsView) {
          saveError = "namespace 'llm-router' not found in settings (plugin schema not registered as configurable)";
        } else {
          try {
            const result = await clientCtx.remote.settings.update("llm-router", config, nsView.revision);
            // Remote protocol returns {ok, error} — must check ok
            if (result && result.ok === false) {
              saveError = result.error?.message || result.error?.code || JSON.stringify(result.error)?.substring(0, 200);
              console.error("[dsh-llm-router][SAVE] update rejected:", saveError);
              // Try replace
              try {
                const r2 = await clientCtx.remote.settings.replace("llm-router", config, nsView.revision);
                if (r2 && r2.ok === false) {
                  saveError = r2.error?.message || r2.error?.code || saveError;
                  console.error("[dsh-llm-router][SAVE] replace rejected:", saveError);
                } else {
                  saved = true;
                }
              } catch (replaceErr: any) {
                saveError = replaceErr?.message || saveError;
              }
            } else {
              saved = true;
            }
          } catch (updateErr: any) {
            saveError = updateErr?.message || String(updateErr);
            console.error("[dsh-llm-router][SAVE] update threw:", saveError);
          }
        }
      } else {
        saveError = "settings service not available";
      }
    } catch (e: any) {
      saveError = e?.message || String(e);
      console.error("[dsh-llm-router][SAVE] failed:", saveError);
    }

    setDirty(false);
    setValidationErrors([]);
    if (saved) {
      setSaveStatus(language === "zh" ? "✓ 已保存" : "✓ Saved");
    } else {
      setSaveStatus((language === "zh" ? "✗ 保存失败: " : "✗ Save failed: ") + saveError);
    }
    setTimeout(() => setSaveStatus(""), 4000);
  };

  const [showConfigModal, setShowConfigModal] = React.useState(false);

  const handleViewConfig = async () => {
    setShowConfigModal(true);
  };

  /** Generate current config as YAML-like text */
  const generateConfigText = () => {
    const lines: string[] = [
      "# LLM Router Configuration",
      "# Generated from Settings UI",
      "",
      "routeGroups:",
      "  - id: 'default'",
      `    strategy: '${routingStrategy}'`,
      "    members:",
    ];

    members.forEach((m: any) => {
      lines.push(`      - provider: '${m.provider}'`);
      lines.push(`        model: '${m.model}'`);
      if (m.protocol) lines.push(`        protocol: '${m.protocol}'`);
    });

    if (rules.length > 0) {
      lines.push("    rules:");
      rules.forEach((r: any) => {
        const conditions: string[] = [];
        if (r.minTokens) conditions.push(`minTokens: ${r.minTokens}`);
        if (r.hasImage) conditions.push("hasImage: true");
        if (r.anyReasoning) conditions.push("anyReasoning: true");
        if (r.anyAgent) conditions.push("anyAgent: true");
        if (r.asksFor) conditions.push(`intent: '${r.asksFor}'`);
        lines.push(`      - ${conditions.join(", ")}`);
        lines.push(`        target: { provider: '${r.targetProvider}', model: '${r.targetModel}' }`);
      });
    }

    if (classifierModel.model) {
      lines.push(`    classifierModel: { provider: '${classifierModel.provider}', model: '${classifierModel.model}' }`);
    }

    return lines.join("\n");
  };

  // Styles matching Magpie design
  const styles = {
    card: { background: "#fff", borderRadius: "12px", border: "1px solid #e5e7eb", padding: "32px", maxWidth: "800px", margin: "0 auto", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' } as React.CSSProperties,
    title: { fontSize: "18px", fontWeight: 600, color: "#111", margin: 0 } as React.CSSProperties,
    hr: { border: "none", borderTop: "1px solid #f3f4f6", margin: "16px 0 24px" } as React.CSSProperties,
    row: { display: "flex", alignItems: "flex-start", marginBottom: "24px" } as React.CSSProperties,
    label: { width: "80px", fontSize: "14px", color: "#6b7280", paddingTop: "6px", flexShrink: 0 } as React.CSSProperties,
    content: { flex: 1 } as React.CSSProperties,
    input: { width: "100%", padding: "8px 12px", border: "1px solid #e5e7eb", borderRadius: "6px", fontSize: "14px", boxSizing: "border-box" } as React.CSSProperties,
    hint: { fontSize: "12px", color: "#9ca3af", marginTop: "6px" } as React.CSSProperties,
    modelRow: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" } as React.CSSProperties,
    modelNum: { width: "16px", fontSize: "13px", color: "#9ca3af" } as React.CSSProperties,
    modelIcon: { fontSize: "14px", color: "#6b7280" } as React.CSSProperties,
    modelName: { fontWeight: 500, fontSize: "14px", color: "#111" } as React.CSSProperties,
    modelProvider: { fontSize: "13px", color: "#9ca3af", marginLeft: "4px" } as React.CSSProperties,
    btnLink: { background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "13px", padding: "4px 8px" } as React.CSSProperties,
    btnDashed: { padding: "6px 14px", border: "1px dashed #d1d5db", borderRadius: "6px", background: "#fff", cursor: "pointer", fontSize: "13px", color: "#374151" } as React.CSSProperties,
    pillGroup: { display: "flex", gap: "0px", border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden", width: "fit-content" } as React.CSSProperties,
    pill: (active: boolean) => ({ padding: "6px 16px", fontSize: "13px", cursor: "pointer", border: "none", background: active ? "#fff" : "#f9fafb", color: active ? "#111" : "#6b7280", fontWeight: active ? 500 : 400, boxShadow: active ? "0 1px 2px rgba(0,0,0,0.05)" : "none" }) as React.CSSProperties,
    ruleCard: { border: "1px solid #f3f4f6", borderRadius: "8px", padding: "12px 16px", marginBottom: "12px" } as React.CSSProperties,
    ruleRow: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" as const } as React.CSSProperties,
    conditionPill: { padding: "4px 10px", border: "1px solid #e5e7eb", borderRadius: "16px", fontSize: "12px", color: "#6b7280", background: "#fff" } as React.CSSProperties,
    conditionInput: { padding: "4px 8px", border: "1px solid #e5e7eb", borderRadius: "6px", fontSize: "12px", width: "80px" } as React.CSSProperties,
    modelBadge: { display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 12px", border: "1px solid #e5e7eb", borderRadius: "20px", fontSize: "13px", color: "#374151", background: "#fff" } as React.CSSProperties,
    footer: { display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #f3f4f6", paddingTop: "16px", marginTop: "24px" } as React.CSSProperties,
    btnSave: { padding: "8px 20px", border: "none", borderRadius: "8px", background: "#6366f1", color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: 500 } as React.CSSProperties,
    btnCancel: { padding: "8px 16px", border: "none", borderRadius: "8px", background: "none", color: "#6b7280", cursor: "pointer", fontSize: "14px" } as React.CSSProperties,
  };

  return React.createElement("div", { style: styles.card }, [
    // Config modal
    showConfigModal && React.createElement("div", {
      key: "modal-overlay",
      style: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" },
      onClick: () => setShowConfigModal(false),
    }, [
      React.createElement("div", {
        key: "modal",
        style: { background: "#fff", borderRadius: "12px", padding: "24px", maxWidth: "600px", width: "90%", maxHeight: "80vh", overflow: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" },
        onClick: (e: any) => e.stopPropagation(),
      }, [
        React.createElement("div", { key: "mh", style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" } }, [
          React.createElement("h3", { key: "mt", style: { margin: 0, fontSize: "16px", fontWeight: 600 } }, language === "zh" ? "当前配置" : "Current Configuration"),
          React.createElement("button", { key: "mx", style: { background: "none", border: "none", cursor: "pointer", fontSize: "18px", color: "#6b7280" }, onClick: () => setShowConfigModal(false) }, "✕"),
        ]),
        React.createElement("pre", {
          key: "mc",
          style: { background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px", fontSize: "12px", fontFamily: "monospace", whiteSpace: "pre-wrap", overflow: "auto", maxHeight: "50vh" },
        }, generateConfigText()),
        React.createElement("div", { key: "mf", style: { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" } }, [
          React.createElement("button", {
            key: "copy",
            style: { padding: "8px 16px", border: "1px solid #e5e7eb", borderRadius: "8px", background: "#fff", cursor: "pointer", fontSize: "13px" },
            onClick: () => { navigator.clipboard.writeText(generateConfigText()); },
          }, language === "zh" ? "复制" : "Copy"),
          React.createElement("button", {
            key: "close",
            style: { ...styles.btnSave },
            onClick: () => setShowConfigModal(false),
          }, language === "zh" ? "关闭" : "Close"),
        ]),
      ]),
    ]),

    // Title
    React.createElement("h2", { key: "title", style: styles.title }, language === "zh" ? "LLM 路由器" : "LLM Router"),
    React.createElement("hr", { key: "hr", style: styles.hr }),

    // Models
    React.createElement("div", { key: "models", style: styles.row }, [
      React.createElement("span", { key: "l", style: styles.label }, t.models),
      React.createElement("div", { key: "c", style: styles.content }, [
        ...members.map((m: any, idx: number) => React.createElement("div", { key: m.id, style: styles.modelRow }, [
          React.createElement("span", { key: "n", style: styles.modelNum }, String(idx + 1)),
          React.createElement("span", { key: "icon", style: styles.modelIcon }, "⬡"),
          React.createElement("span", { key: "name", style: styles.modelName }, m.model || "model"),
          React.createElement("span", { key: "prov", style: styles.modelProvider }, m.provider),
          // Warning badge if model was deleted from Settings/Models
          m.available === false && React.createElement("span", {
            key: "warn",
            style: { marginLeft: "8px", padding: "2px 8px", borderRadius: "4px", background: "#fef3c7", color: "#d97706", fontSize: "11px", fontWeight: 500 },
          }, `⚠ ${t.warning}`),
          React.createElement("div", { key: "sp", style: { flex: 1 } }),
          idx > 0 && React.createElement("button", { key: "up", style: styles.btnLink, onClick: () => moveUp(idx) }, t.up),
          React.createElement("button", { key: "rm", style: styles.btnLink, onClick: () => removeMember(m.id) }, t.removeBtn),
        ])),
        // Model picker dropdown - dynamically from DSH Settings/Models
        showModelPicker && React.createElement("div", {
          key: "picker",
          style: { border: "1px solid #e5e7eb", borderRadius: "8px", padding: "8px", marginBottom: "8px", background: "#fafafa" },
        }, [
          React.createElement("p", { key: "ph", style: { fontSize: "12px", color: "#6b7280", margin: "0 0 8px" } },
            language === "zh" ? "从模型设置中选择：" : "Select from model settings:"),
          ...(availableModels.length > 0
            ? availableModels.filter((am: any) => !members.some((m: any) => m.model === am.model)).map((am: any) =>
                React.createElement("button", {
                  key: am.model,
                  style: { display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "1px solid #e5e7eb", borderRadius: "6px", background: "#fff", cursor: "pointer", fontSize: "13px", marginBottom: "4px" },
                  onClick: () => addMember(am),
                }, [
                  React.createElement("span", { key: "icon" }, "⬡ "),
                  React.createElement("span", { key: "model", style: { fontWeight: 500 } }, am.model),
                  React.createElement("span", { key: "prov", style: { color: "#9ca3af", marginLeft: "8px" } }, am.label),
                ])
              )
            : [React.createElement("p", { key: "empty", style: { fontSize: "12px", color: "#9ca3af", margin: "4px 0" } },
                language === "zh" ? "未找到已配置的模型。请在 设置/模型 中添加。" : "No configured models found. Add them in Settings/Models."
              )]),
        ]),
        React.createElement("button", { key: "add", style: styles.btnDashed, onClick: () => addMember() }, t.addModel),
        React.createElement("p", { key: "h", style: styles.hint }, t.modelsHint),
      ]),
    ]),

    // Routing
    React.createElement("div", { key: "routing", style: styles.row }, [
      React.createElement("span", { key: "l", style: styles.label }, t.routing),
      React.createElement("div", { key: "c", style: styles.content }, [
        React.createElement("div", { key: "pills", style: styles.pillGroup },
          Object.entries(t.strategies).map(([id, s]: [string, any]) =>
            React.createElement("button", { key: id, style: styles.pill(routingStrategy === id), onClick: () => { setRoutingStrategy(id); setDirty(true); } }, s.label)
          )
        ),
        React.createElement("p", { key: "h", style: styles.hint }, (t.strategies as any)[routingStrategy]?.desc || ""),
      ]),
    ]),

    // Stays
    React.createElement("div", { key: "stays", style: styles.row }, [
      React.createElement("span", { key: "l", style: styles.label }, t.stays),
      React.createElement("div", { key: "c", style: styles.content }, [
        React.createElement("div", { key: "pills", style: styles.pillGroup },
          Object.entries(t.staysModes).map(([id, s]: [string, any]) =>
            React.createElement("button", { key: id, style: styles.pill(staysMode === id), onClick: () => { setStaysMode(id); setDirty(true); } }, s.label)
          )
        ),
        React.createElement("p", { key: "h", style: styles.hint }, (t.staysModes as any)[staysMode]?.desc || ""),
      ]),
    ]),

    // Rules
    React.createElement("div", { key: "rules", style: styles.row }, [
      React.createElement("span", { key: "l", style: styles.label }, t.rules),
      React.createElement("div", { key: "c", style: styles.content }, [
        ...rules.map((rule: any, idx: number) => React.createElement("div", { key: rule.id, style: styles.ruleCard }, [
          // When row - toggleable condition pills
          React.createElement("div", { key: "when", style: styles.ruleRow }, [
            React.createElement("span", { key: "n", style: styles.modelNum }, String(idx + 1)),
            React.createElement("span", { key: "w", style: { fontSize: "13px", color: "#374151" } }, t.when),
            // Combined tokens pill: ≥ [input] tokens (active when has value)
            React.createElement("span", {
              key: "tokPill",
              style: {
                ...styles.conditionPill,
                display: "inline-flex", alignItems: "center", gap: "4px",
                background: rule.minTokens ? "#e5e7eb" : "transparent",
                color: rule.minTokens ? "#111" : "#9ca3af",
              },
            }, [
              React.createElement("span", { key: "ge" }, "≥"),
              React.createElement("input", {
                key: "tok",
                style: { border: "none", outline: "none", background: "transparent", width: rule.minTokens ? "60px" : "40px", fontSize: "12px", textAlign: "center", color: "#111" },
                placeholder: "",
                value: rule.minTokens,
                type: "number",
                min: "0",
                onChange: (e: any) => {
                  const v = e.target.value.replace(/[^0-9]/g, "");
                  rule.minTokens = v;
                  setDirty(true);
                  setRules([...rules]);
                },
              }),
              React.createElement("span", { key: "tokens" }, t.tokens),
            ]),
            React.createElement("button", {
              key: "img", style: { ...styles.conditionPill, cursor: "pointer", border: "none", background: rule.hasImage ? "#e5e7eb" : "transparent", color: rule.hasImage ? "#111" : "#9ca3af" },
              onClick: () => { rule.hasImage = !rule.hasImage; setDirty(true); setRules([...rules]); },
            }, t.hasImage),
            React.createElement("button", {
              key: "reason", style: { ...styles.conditionPill, cursor: "pointer", border: "none", background: rule.anyReasoning ? "#e5e7eb" : "transparent", color: rule.anyReasoning ? "#111" : "#9ca3af" },
              onClick: () => { rule.anyReasoning = !rule.anyReasoning; setDirty(true); setRules([...rules]); },
            }, t.anyReasoning),
            React.createElement("button", {
              key: "agent", style: { ...styles.conditionPill, cursor: "pointer", border: "none", background: rule.anyAgent ? "#e5e7eb" : "transparent", color: rule.anyAgent ? "#111" : "#9ca3af" },
              onClick: () => { rule.anyAgent = !rule.anyAgent; setDirty(true); setRules([...rules]); },
            }, t.anyAgent),
            React.createElement("span", { key: "asks", style: { ...styles.conditionPill, background: rule.asksFor ? "#e5e7eb" : "transparent", color: rule.asksFor ? "#111" : "#9ca3af" } }, t.asksFor),
            React.createElement("input", { key: "asksInput", style: { ...styles.conditionInput, width: "180px", border: "1px solid #e5e7eb", borderRadius: "16px", padding: "4px 12px" }, placeholder: t.asksForPlaceholder, value: rule.asksFor, onChange: (e: any) => { rule.asksFor = e.target.value; setDirty(true); setRules([...rules]); } }),
            React.createElement("div", { key: "sp", style: { flex: 1 } }),
            idx > 0 && React.createElement("button", { key: "up", style: styles.btnLink, onClick: () => { const a = [...rules]; [a[idx-1], a[idx]] = [a[idx], a[idx-1]]; setRules(a); setDirty(true); } }, t.up),
            React.createElement("button", { key: "rm", style: styles.btnLink, onClick: () => removeRule(rule.id) }, t.removeBtn),
          ]),
          // Send to row - model selector dropdown
          React.createElement("div", { key: "sendto", style: { ...styles.ruleRow, marginTop: "8px", marginLeft: "24px", position: "relative" } }, [
            React.createElement("span", { key: "st", style: { fontSize: "13px", color: "#374151" } }, t.sendTo),
            // Model badge (click to open picker)
            React.createElement("button", {
              key: "badge",
              style: { ...styles.modelBadge, cursor: "pointer", border: "1px solid #e5e7eb" },
              onClick: () => setShowRuleModelPicker(showRuleModelPicker === rule.id ? null : rule.id),
            }, [
              React.createElement("span", { key: "icon" }, "⬡"),
              rule.targetModel ? `${rule.targetModel} · ${rule.targetProvider}` : (language === "zh" ? "选择模型" : "Select model"),
              React.createElement("span", { key: "arrow", style: { color: "#9ca3af", fontSize: "10px" } }, "▾"),
            ]),
            // Model picker dropdown - shows models from THIS router's model list
            showRuleModelPicker === rule.id && React.createElement("div", {
              key: "picker",
              style: { position: "absolute", top: "100%", left: "60px", zIndex: 100, border: "1px solid #e5e7eb", borderRadius: "8px", padding: "4px", background: "#fff", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", maxHeight: "200px", overflowY: "auto", width: "280px", marginTop: "4px" },
            },
              members.map((am: any) =>
                React.createElement("button", {
                  key: `${am.provider}/${am.model}`,
                  style: { display: "block", width: "100%", textAlign: "left", padding: "6px 10px", border: "none", borderRadius: "4px", background: "none", cursor: "pointer", fontSize: "12px" },
                  onClick: () => {
                    rule.targetProvider = am.provider;
                    rule.targetModel = am.model;
                    setShowRuleModelPicker(null);
                    setDirty(true);
                    setRules([...rules]);
                  },
                }, [
                  React.createElement("span", { key: "m", style: { fontWeight: 500 } }, am.model),
                  React.createElement("span", { key: "p", style: { color: "#9ca3af", marginLeft: "6px" } }, am.provider),
                ])
              )
            ),
          ]),
        ])),
        React.createElement("button", { key: "add", style: styles.btnDashed, onClick: addRule }, t.addRule),
        // Intent told by - model selector (uses members from this router)
        React.createElement("div", { key: "intent", style: { ...styles.ruleRow, marginTop: "16px", position: "relative" } }, [
          React.createElement("span", { key: "l", style: { fontSize: "13px", color: "#6b7280" } }, t.intentToldBy),
          React.createElement("button", {
            key: "badge",
            style: { ...styles.modelBadge, cursor: "pointer", border: "1px solid #e5e7eb" },
            onClick: () => setShowRuleModelPicker(showRuleModelPicker === "classifier" ? null : "classifier"),
          }, [
            React.createElement("span", { key: "icon" }, "⬡"),
            `${classifierModel.model} · ${classifierModel.provider}`,
            React.createElement("span", { key: "arrow", style: { color: "#9ca3af", fontSize: "10px" } }, "▾"),
          ]),
          showRuleModelPicker === "classifier" && React.createElement("div", {
            key: "picker",
            style: { position: "absolute", top: "100%", left: "120px", zIndex: 100, border: "1px solid #e5e7eb", borderRadius: "8px", padding: "4px", background: "#fff", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", maxHeight: "200px", overflowY: "auto", width: "280px", marginTop: "4px" },
          },
            members.map((am: any) =>
              React.createElement("button", {
                key: `${am.provider}/${am.model}`,
                style: { display: "block", width: "100%", textAlign: "left", padding: "6px 10px", border: "none", borderRadius: "4px", background: "none", cursor: "pointer", fontSize: "12px" },
                onClick: () => {
                  setClassifierModel({ provider: am.provider, model: am.model });
                  setShowRuleModelPicker(null);
                  setDirty(true);
                },
              }, [
                React.createElement("span", { key: "m", style: { fontWeight: 500 } }, am.model),
                React.createElement("span", { key: "p", style: { color: "#9ca3af", marginLeft: "6px" } }, am.provider),
              ])
            )
          ),
        ]),
        React.createElement("p", { key: "ih", style: { ...styles.hint, marginTop: "8px" } }, t.intentHint),
        React.createElement("p", { key: "rh", style: { ...styles.hint } }, t.rulesHint),
      ]),
    ]),

    // Footer - no Remove button, Save + View Config
    React.createElement("div", { key: "footer", style: styles.footer }, [
      React.createElement("div", { key: "left" }),
      React.createElement("div", { key: "right", style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" } }, [
        // Validation errors
        validationErrors.length > 0 && React.createElement("div", {
          key: "errors",
          style: { background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "8px 12px", maxWidth: "400px" },
        },
          validationErrors.map((err: string, i: number) =>
            React.createElement("p", { key: i, style: { margin: "2px 0", fontSize: "12px", color: "#dc2626" } }, `• ${err}`)
          )
        ),
        React.createElement("div", { key: "actions", style: { display: "flex", gap: "8px", alignItems: "center" } }, [
          saveStatus && React.createElement("span", { key: "status", style: { fontSize: "12px", color: "#16a34a" } }, saveStatus),
          React.createElement("button", { key: "cancel", style: styles.btnCancel, onClick: () => { setDirty(false); setValidationErrors([]); } }, t.cancel),
          React.createElement("button", { key: "save", style: { ...styles.btnSave, opacity: dirty ? 1 : 0.5 }, onClick: handleSave, disabled: !dirty }, t.save),
          React.createElement("button", {
            key: "view",
            style: { ...styles.btnCancel, border: "1px solid #e5e7eb", borderRadius: "8px" },
            onClick: handleViewConfig,
          }, t.viewConfig),
        ]),
      ]),
    ]),
  ]);
}

// Type declarations for DSH's slot system
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    "settings.llm-router": {
      nav: string;
      title: string;
      description: string;
    };
  }
}
