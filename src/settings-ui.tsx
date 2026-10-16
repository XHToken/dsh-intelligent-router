/**
 * DSH-LLM-Router Settings UI
 * Complete configuration interface for models and routing strategies
 */

import React, { useState, ErrorInfo, ReactNode } from "react";

export interface SettingsUIProps {
  settings: any;
  updateSettings: (updates: any) => void;
}

// Error Boundary Component
class SettingsErrorBoundary extends React.Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[LLM Router Settings] Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "20px", color: "red" }}>
          <h3>Settings UI Error</h3>
          <p>{this.state.error?.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export const LLMRouterSettings: React.FC<SettingsUIProps> = ({
  settings,
  updateSettings,
}) => {
  // Ensure settings is defined
  const safeSettings = settings || {};
  const [activeTab, setActiveTab] = useState("route-groups");

  return (
    <SettingsErrorBoundary>
      <div className="dsh-llm-router-settings">
        <div className="settings-header">
          <h2>LLM Router Settings</h2>
          <p>Configure intelligent routing for your LLM requests</p>
        </div>

        <div className="settings-tabs">
          <button
            className={`tab ${activeTab === "route-groups" ? "active" : ""}`}
            onClick={() => setActiveTab("route-groups")}
          >
            Route Groups
          </button>
          <button
            className={`tab ${activeTab === "strategies" ? "active" : ""}`}
            onClick={() => setActiveTab("strategies")}
          >
            Strategies
          </button>
          <button
            className={`tab ${activeTab === "intent" ? "active" : ""}`}
            onClick={() => setActiveTab("intent")}
          >
            Intent Routing
          </button>
          <button
            className={`tab ${activeTab === "quota" ? "active" : ""}`}
            onClick={() => setActiveTab("quota")}
          >
            Quota
          </button>
          <button
            className={`tab ${activeTab === "fallback" ? "active" : ""}`}
            onClick={() => setActiveTab("fallback")}
          >
            Fallback
          </button>
          <button
            className={`tab ${activeTab === "monitoring" ? "active" : ""}`}
            onClick={() => setActiveTab("monitoring")}
          >
            Monitoring
          </button>
        </div>

        <div className="settings-content">
          {activeTab === "route-groups" && (
            <RouteGroupsPanel
              settings={safeSettings}
              updateSettings={updateSettings}
            />
          )}
          {activeTab === "strategies" && (
            <StrategiesPanel
              settings={safeSettings}
              updateSettings={updateSettings}
            />
          )}
          {activeTab === "intent" && (
            <IntentPanel
              settings={safeSettings}
              updateSettings={updateSettings}
            />
          )}
          {activeTab === "quota" && (
            <QuotaPanel
              settings={safeSettings}
              updateSettings={updateSettings}
            />
          )}
          {activeTab === "fallback" && (
            <FallbackPanel
              settings={safeSettings}
              updateSettings={updateSettings}
            />
          )}
          {activeTab === "monitoring" && (
            <MonitoringPanel settings={safeSettings} />
          )}
        </div>
      </div>
    </SettingsErrorBoundary>
  );
};

/**
 * Route Groups Panel - Configure model groups
 */
const RouteGroupsPanel: React.FC<SettingsUIProps> = ({
  settings,
  updateSettings,
}) => {
  const routeGroups = settings?.routeGroups || [];

  const addRouteGroup = () => {
    const newGroup = {
      id: `group-${Date.now()}`,
      name: `Route Group ${routeGroups.length + 1}`,
      description: "",
      members: [],
      strategy: "order",
      enabled: true,
    };
    updateSettings({ routeGroups: [...routeGroups, newGroup] });
  };

  const updateRouteGroup = (index: number, updates: any) => {
    try {
      const updated = [...routeGroups];
      if (index >= 0 && index < updated.length) {
        updated[index] = { ...updated[index], ...updates };
        updateSettings({ routeGroups: updated });
      }
    } catch (error) {
      console.error("[RouteGroupsPanel] Error updating route group:", error);
    }
  };

  const deleteRouteGroup = (index: number) => {
    try {
      const updated = routeGroups.filter((_: any, i: number) => i !== index);
      updateSettings({ routeGroups: updated });
    } catch (error) {
      console.error("[RouteGroupsPanel] Error deleting route group:", error);
    }
  };

  const addMember = (groupIndex: number) => {
    try {
      const group = routeGroups[groupIndex];
      if (!group) return;

      const members = group.members || [];
      const newMember = {
        provider: "",
        model: "",
        priority: members.length + 1,
        weight: 1,
        enabled: true,
      };
      updateRouteGroup(groupIndex, {
        members: [...members, newMember],
      });
    } catch (error) {
      console.error("[RouteGroupsPanel] Error adding member:", error);
    }
  };

  const updateMember = (
    groupIndex: number,
    memberIndex: number,
    updates: any,
  ) => {
    try {
      const group = routeGroups[groupIndex];
      if (!group) return;

      const members = group.members || [];
      const updatedMembers = [...members];
      if (memberIndex >= 0 && memberIndex < updatedMembers.length) {
        updatedMembers[memberIndex] = {
          ...updatedMembers[memberIndex],
          ...updates,
        };
        updateRouteGroup(groupIndex, { members: updatedMembers });
      }
    } catch (error) {
      console.error("[RouteGroupsPanel] Error updating member:", error);
    }
  };

  const deleteMember = (groupIndex: number, memberIndex: number) => {
    try {
      const group = routeGroups[groupIndex];
      if (!group) return;

      const members = group.members || [];
      const updatedMembers = members.filter(
        (_: any, i: number) => i !== memberIndex,
      );
      updateRouteGroup(groupIndex, { members: updatedMembers });
    } catch (error) {
      console.error("[RouteGroupsPanel] Error deleting member:", error);
    }
  };

  return (
    <div className="panel">
      <h3>Route Groups</h3>
      <p>
        Configure groups of models for intelligent routing. The AUTO model will
        route requests based on these groups.
      </p>

      <div className="route-groups-list">
        {routeGroups.map((group: any, groupIndex: number) => (
          <div key={group.id} className="route-group-card">
            <div className="card-header">
              <input
                type="text"
                value={group.name}
                onChange={(e) =>
                  updateRouteGroup(groupIndex, { name: e.target.value })
                }
                placeholder="Group Name"
                className="group-name-input"
              />
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={group.enabled}
                  onChange={(e) =>
                    updateRouteGroup(groupIndex, { enabled: e.target.checked })
                  }
                />
                <span>Enabled</span>
              </label>
              <button
                className="btn-danger"
                onClick={() => deleteRouteGroup(groupIndex)}
              >
                Delete
              </button>
            </div>

            <div className="card-body">
              <div className="form-group">
                <label>Description</label>
                <input
                  type="text"
                  value={group.description || ""}
                  onChange={(e) =>
                    updateRouteGroup(groupIndex, {
                      description: e.target.value,
                    })
                  }
                  placeholder="Optional description"
                />
              </div>

              <div className="form-group">
                <label>Members ({(group.members || []).length})</label>
                <div className="members-list">
                  {(group.members || []).map(
                    (member: any, memberIndex: number) => (
                      <div key={memberIndex} className="member-item-full">
                        <div className="member-row">
                          <input
                            type="text"
                            value={member?.provider || ""}
                            onChange={(e) =>
                              updateMember(groupIndex, memberIndex, {
                                provider: e.target.value,
                              })
                            }
                            placeholder="Provider (e.g., deepseek, ollama, openai)"
                            className="member-input"
                          />
                          <input
                            type="text"
                            value={member?.model || ""}
                            onChange={(e) =>
                              updateMember(groupIndex, memberIndex, {
                                model: e.target.value,
                              })
                            }
                            placeholder="Model (e.g., deepseek-v4-flash, llama3.2)"
                            className="member-input"
                          />
                        </div>
                        <div className="member-row">
                          <input
                            type="password"
                            value={member?.apiKey || ""}
                            onChange={(e) =>
                              updateMember(groupIndex, memberIndex, {
                                apiKey: e.target.value,
                              })
                            }
                            placeholder="API Key (optional, or use env var)"
                            className="member-input"
                          />
                          <input
                            type="text"
                            value={member?.baseUrl || ""}
                            onChange={(e) =>
                              updateMember(groupIndex, memberIndex, {
                                baseUrl: e.target.value,
                              })
                            }
                            placeholder="Base URL (optional)"
                            className="member-input"
                          />
                          <select
                            value={member?.protocol || ""}
                            onChange={(e) =>
                              updateMember(groupIndex, memberIndex, {
                                protocol: e.target.value || undefined,
                              })
                            }
                            className="member-input-small"
                          >
                            <option value="">Auto</option>
                            <option value="openai">OpenAI</option>
                            <option value="anthropic">Anthropic</option>
                            <option value="ollama">Ollama</option>
                          </select>
                        </div>
                        <div className="member-row">
                          <label className="thinking-toggle">
                            <input
                              type="checkbox"
                              checked={member?.thinking?.enabled || false}
                              onChange={(e) =>
                                updateMember(groupIndex, memberIndex, {
                                  thinking: {
                                    ...member?.thinking,
                                    enabled: e.target.checked,
                                  },
                                })
                              }
                            />
                            <span>Enable Thinking Mode</span>
                          </label>
                          {member?.thinking?.enabled && (
                            <input
                              type="number"
                              value={member?.thinking?.budget || 10000}
                              onChange={(e) =>
                                updateMember(groupIndex, memberIndex, {
                                  thinking: {
                                    ...member?.thinking,
                                    budget: parseInt(e.target.value) || 10000,
                                  },
                                })
                              }
                              placeholder="Thinking Budget (tokens)"
                              className="member-input-small"
                              min="1000"
                              max="100000"
                              title="Token budget for thinking/reasoning (Anthropic only)"
                            />
                          )}
                        </div>
                        <div className="member-row">
                          <input
                            type="number"
                            value={member?.priority ?? 1}
                            onChange={(e) =>
                              updateMember(groupIndex, memberIndex, {
                                priority: parseInt(e.target.value) || 1,
                              })
                            }
                            placeholder="Priority"
                            className="member-input-small"
                            min="1"
                          />
                          <input
                            type="number"
                            value={member?.weight ?? 1}
                            onChange={(e) =>
                              updateMember(groupIndex, memberIndex, {
                                weight: parseFloat(e.target.value) || 1,
                              })
                            }
                            placeholder="Weight"
                            className="member-input-small"
                            min="0"
                            step="0.1"
                          />
                          <label className="toggle-small">
                            <input
                              type="checkbox"
                              checked={member?.enabled ?? true}
                              onChange={(e) =>
                                updateMember(groupIndex, memberIndex, {
                                  enabled: e.target.checked,
                                })
                              }
                            />
                            <span>Enabled</span>
                          </label>
                          <button
                            className="btn-icon"
                            onClick={() =>
                              deleteMember(groupIndex, memberIndex)
                            }
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ),
                  )}
                  <button
                    className="btn-secondary"
                    onClick={() => addMember(groupIndex)}
                  >
                    + Add Member
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button className="btn-primary" onClick={addRouteGroup}>
        + Add Route Group
      </button>
    </div>
  );
};

/**
 * Strategies Panel - Configure routing strategies
 */
const StrategiesPanel: React.FC<SettingsUIProps> = ({
  settings,
  updateSettings,
}) => {
  const routeGroups = settings.routeGroups || [];

  const updateGroupStrategy = (index: number, strategy: string) => {
    const updated = [...routeGroups];
    updated[index] = { ...updated[index], strategy };
    updateSettings({ routeGroups: updated });
  };

  return (
    <div className="panel">
      <h3>Routing Strategies</h3>
      <p>Choose how requests are routed within each route group.</p>

      <div className="strategies-list">
        {routeGroups.map((group: any, index: number) => (
          <div key={group.id} className="strategy-item">
            <h4>{group.name}</h4>
            <select
              value={group.strategy}
              onChange={(e) => updateGroupStrategy(index, e.target.value)}
            >
              <option value="order">Order - Use members by priority</option>
              <option value="rotate">Rotate - Round-robin selection</option>
              <option value="usage">Usage - Least-used member first</option>
              <option value="smart">
                Smart - Multi-factor intelligent selection
              </option>
              <option value="pace">Pace - Based on consumption rate</option>
              <option value="weighted">
                Weighted - Weighted random selection
              </option>
              <option value="intent">
                Intent - Route based on detected intent
              </option>
            </select>
            <p className="strategy-description">
              {getStrategyDescription(group.strategy)}
            </p>
          </div>
        ))}
      </div>

      {routeGroups.length === 0 && (
        <div className="empty-state">
          <p>
            No route groups configured. Add route groups in the "Route Groups"
            tab.
          </p>
        </div>
      )}
    </div>
  );
};

function getStrategyDescription(strategy: string): string {
  const descriptions: Record<string, string> = {
    order:
      "Uses members in priority order. Falls back to the next member on failure.",
    rotate: "Rotates to the next member on each request for even distribution.",
    usage: "Prioritizes the least-used member to balance load.",
    smart:
      "Selects based on multiple factors: usage count, priority, and latency.",
    pace: "Selects based on consumption rate to distribute load over time.",
    weighted: "Selects members randomly based on assigned weights.",
    intent:
      "Routes based on detected user intent (requires intent classifier).",
  };
  return descriptions[strategy] || "";
}

/**
 * Intent Panel - Configure intent-based routing
 */
const IntentPanel: React.FC<SettingsUIProps> = ({
  settings,
  updateSettings,
}) => {
  const intentRouting = settings.intentRouting || {
    enabled: false,
    classifierProvider: "",
    classifierModel: "",
    confidenceThreshold: 0.7,
    cacheEnabled: true,
    cacheTTL: 300000,
  };

  return (
    <div className="panel">
      <h3>Intent Routing</h3>
      <p>
        Use AI to classify user intent and route to the appropriate model
        automatically.
      </p>

      <div className="form-group">
        <label className="toggle">
          <input
            type="checkbox"
            checked={intentRouting.enabled}
            onChange={(e) =>
              updateSettings({
                intentRouting: { ...intentRouting, enabled: e.target.checked },
              })
            }
          />
          <span>Enable Intent Routing</span>
        </label>
      </div>

      {intentRouting.enabled && (
        <>
          <div className="form-group">
            <label>Classifier Provider</label>
            <input
              type="text"
              value={intentRouting.classifierProvider}
              onChange={(e) =>
                updateSettings({
                  intentRouting: {
                    ...intentRouting,
                    classifierProvider: e.target.value,
                  },
                })
              }
              placeholder="e.g., ollama"
            />
            <small>
              Provider for the classification model (should be fast and cheap)
            </small>
          </div>

          <div className="form-group">
            <label>Classifier Model</label>
            <input
              type="text"
              value={intentRouting.classifierModel}
              onChange={(e) =>
                updateSettings({
                  intentRouting: {
                    ...intentRouting,
                    classifierModel: e.target.value,
                  },
                })
              }
              placeholder="e.g., llama3:8b"
            />
            <small>Small model for intent classification</small>
          </div>

          <div className="form-group">
            <label>
              Confidence Threshold:{" "}
              {(intentRouting.confidenceThreshold * 100).toFixed(0)}%
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={intentRouting.confidenceThreshold}
              onChange={(e) =>
                updateSettings({
                  intentRouting: {
                    ...intentRouting,
                    confidenceThreshold: parseFloat(e.target.value),
                  },
                })
              }
            />
            <small>Minimum confidence to use intent-based routing</small>
          </div>

          <div className="form-group">
            <label className="toggle">
              <input
                type="checkbox"
                checked={intentRouting.cacheEnabled}
                onChange={(e) =>
                  updateSettings({
                    intentRouting: {
                      ...intentRouting,
                      cacheEnabled: e.target.checked,
                    },
                  })
                }
              />
              <span>Enable Classification Cache</span>
            </label>
            <small>Cache classification results to improve performance</small>
          </div>
        </>
      )}
    </div>
  );
};

/**
 * Quota Panel - Configure quota management
 */
const QuotaPanel: React.FC<SettingsUIProps> = ({
  settings,
  updateSettings,
}) => {
  const quotaTracking = settings.quotaTracking || {
    enabled: true,
    syncWithTokenMeter: true,
  };

  return (
    <div className="panel">
      <h3>Quota Tracking</h3>
      <p>Manage API usage limits and tracking.</p>

      <div className="form-group">
        <label className="toggle">
          <input
            type="checkbox"
            checked={quotaTracking.enabled}
            onChange={(e) =>
              updateSettings({
                quotaTracking: { ...quotaTracking, enabled: e.target.checked },
              })
            }
          />
          <span>Enable Quota Tracking</span>
        </label>
      </div>

      <div className="form-group">
        <label className="toggle">
          <input
            type="checkbox"
            checked={quotaTracking.syncWithTokenMeter}
            onChange={(e) =>
              updateSettings({
                quotaTracking: {
                  ...quotaTracking,
                  syncWithTokenMeter: e.target.checked,
                },
              })
            }
          />
          <span>Sync with DSH TokenMeter</span>
        </label>
      </div>
    </div>
  );
};

/**
 * Fallback Panel - Configure fallback behavior
 */
const FallbackPanel: React.FC<SettingsUIProps> = ({
  settings,
  updateSettings,
}) => {
  const fallback = settings.fallback || {
    enabled: true,
    maxRetries: 3,
    retryDelay: 1000,
    recoverableErrors: ["RATE_LIMIT", "QUOTA", "TIMEOUT", "SERVER_ERROR"],
  };

  const toggleError = (error: string) => {
    const errors = fallback.recoverableErrors || [];
    const updated = (errors || []).includes(error)
      ? (errors || []).filter((e: string) => e !== error)
      : [...(errors || []), error];
    updateSettings({
      fallback: { ...fallback, recoverableErrors: updated },
    });
  };

  return (
    <div className="panel">
      <h3>Fallback Configuration</h3>
      <p>Configure automatic failover behavior when requests fail.</p>

      <div className="form-group">
        <label className="toggle">
          <input
            type="checkbox"
            checked={fallback.enabled}
            onChange={(e) =>
              updateSettings({
                fallback: { ...fallback, enabled: e.target.checked },
              })
            }
          />
          <span>Enable Automatic Fallback</span>
        </label>
      </div>

      <div className="form-group">
        <label>Max Retries</label>
        <input
          type="number"
          min={0}
          value={fallback.maxRetries}
          onChange={(e) =>
            updateSettings({
              fallback: { ...fallback, maxRetries: parseInt(e.target.value) },
            })
          }
        />
      </div>

      <div className="form-group">
        <label>Retry Delay (ms)</label>
        <input
          type="number"
          min={0}
          value={fallback.retryDelay}
          onChange={(e) =>
            updateSettings({
              fallback: { ...fallback, retryDelay: parseInt(e.target.value) },
            })
          }
        />
      </div>

      <div className="form-group">
        <label>Recoverable Errors</label>
        <div className="error-checkboxes">
          {[
            "RATE_LIMIT",
            "QUOTA",
            "TIMEOUT",
            "SERVER_ERROR",
            "AUTH",
            "NETWORK_ERROR",
          ].map((error) => (
            <label key={error} className="checkbox-label">
              <input
                type="checkbox"
                checked={(fallback.recoverableErrors || []).includes(error)}
                onChange={() => toggleError(error)}
              />
              <span>{error}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * Monitoring Panel - Display routing statistics
 */
const MonitoringPanel: React.FC<{ settings: any }> = ({ settings: _settings }) => {
  // Mock metrics - in real implementation, these would come from the router
  const metrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    fallbackCount: 0,
    avgDecisionTime: 0,
  };

  return (
    <div className="panel">
      <h3>Monitoring Dashboard</h3>
      <p>Real-time routing statistics and performance metrics.</p>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-value">{metrics.totalRequests}</div>
          <div className="metric-label">Total Requests</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">
            {metrics.totalRequests > 0
              ? (
                  (metrics.successfulRequests / metrics.totalRequests) *
                  100
                ).toFixed(1)
              : "0.0"}
            %
          </div>
          <div className="metric-label">Success Rate</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{metrics.fallbackCount}</div>
          <div className="metric-label">Fallbacks</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">
            {metrics.avgDecisionTime.toFixed(1)}ms
          </div>
          <div className="metric-label">Avg Decision Time</div>
        </div>
      </div>

      <div className="notice">
        <p>
          <strong>Note:</strong> Real-time metrics will be available once the
          backend integration is complete.
        </p>
      </div>
    </div>
  );
};

export default LLMRouterSettings;
