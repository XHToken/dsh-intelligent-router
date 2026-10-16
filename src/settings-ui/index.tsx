/**
 * Settings UI entry point for dsh-llm-router
 * Provides the Web UI for configuring the router
 */

import React from "react";
import type { RouterSettings } from "../settings-schema";

export interface SettingsUIProps {
  settings: RouterSettings;
  updateSettings: (updates: Partial<RouterSettings>) => void;
}

/**
 * Main Settings UI component
 */
export const LLMRouterSettings: React.FC<SettingsUIProps> = ({
  settings,
  updateSettings,
}) => {
  const [activeTab, setActiveTab] = React.useState("route-groups");

  return (
    <div className="dsh-llm-router-settings">
      {/* Header */}
      <div className="settings-header">
        <h2>LLM Router</h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => updateSettings({ enabled: e.target.checked })}
          />
          <span>{settings.enabled ? "Enabled" : "Disabled"}</span>
        </label>
      </div>

      {/* Tabs */}
      <div className="settings-tabs">
        <button
          className={`tab ${activeTab === "route-groups" ? "active" : ""}`}
          onClick={() => setActiveTab("route-groups")}
        >
          Route Groups
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
      </div>

      {/* Content */}
      <div className="settings-content">
        {activeTab === "route-groups" && (
          <RouteGroupsPanel
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
        {activeTab === "intent" && (
          <IntentPanel settings={settings} updateSettings={updateSettings} />
        )}
        {activeTab === "quota" && (
          <QuotaPanel settings={settings} updateSettings={updateSettings} />
        )}
        {activeTab === "fallback" && (
          <FallbackPanel settings={settings} updateSettings={updateSettings} />
        )}
      </div>
    </div>
  );
};

/**
 * Route Groups Panel
 */
const RouteGroupsPanel: React.FC<SettingsUIProps> = ({
  settings,
  updateSettings: _updateSettings,
}) => {
  return (
    <div className="panel">
      <h3>Route Groups</h3>
      <p>Configure route groups for intelligent LLM routing.</p>

      <div className="route-groups-list">
        {settings.routeGroups.map((group: any) => (
          <div key={group.id} className="route-group-card">
            <div className="card-header">
              <h4>{group.name}</h4>
              <span
                className={`badge ${group.enabled ? "enabled" : "disabled"}`}
              >
                {group.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <div className="card-meta">
              <span>Strategy: {group.strategy}</span>
              <span>Members: {group.members.length}</span>
            </div>
          </div>
        ))}
      </div>

      <button className="btn-primary">+ Create Route Group</button>
    </div>
  );
};

/**
 * Intent Routing Panel
 */
const IntentPanel: React.FC<SettingsUIProps> = ({
  settings,
  updateSettings,
}) => {
  const intentConfig = settings.intentRouting ?? {
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
      <p>Route requests based on detected intent.</p>

      <div className="form-group">
        <label>
          <input
            type="checkbox"
            checked={intentConfig.enabled}
            onChange={(e) =>
              updateSettings({
                intentRouting: { ...intentConfig, enabled: e.target.checked },
              })
            }
          />
          Enable Intent Routing
        </label>
      </div>

      {intentConfig.enabled && (
        <>
          <div className="form-group">
            <label>Classifier Provider</label>
            <input
              type="text"
              value={intentConfig.classifierProvider}
              onChange={(e) =>
                updateSettings({
                  intentRouting: {
                    ...intentConfig,
                    classifierProvider: e.target.value,
                  },
                })
              }
              placeholder="e.g., ollama"
            />
          </div>

          <div className="form-group">
            <label>Classifier Model</label>
            <input
              type="text"
              value={intentConfig.classifierModel}
              onChange={(e) =>
                updateSettings({
                  intentRouting: {
                    ...intentConfig,
                    classifierModel: e.target.value,
                  },
                })
              }
              placeholder="e.g., llama3:8b"
            />
          </div>

          <div className="form-group">
            <label>
              Confidence Threshold:{" "}
              {(intentConfig.confidenceThreshold * 100).toFixed(0)}%
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={intentConfig.confidenceThreshold}
              onChange={(e) =>
                updateSettings({
                  intentRouting: {
                    ...intentConfig,
                    confidenceThreshold: parseFloat(e.target.value),
                  },
                })
              }
            />
          </div>
        </>
      )}
    </div>
  );
};

/**
 * Quota Tracking Panel
 */
const QuotaPanel: React.FC<SettingsUIProps> = ({
  settings,
  updateSettings,
}) => {
  return (
    <div className="panel">
      <h3>Quota Tracking</h3>
      <p>Manage API usage limits and tracking.</p>

      <div className="form-group">
        <label>
          <input
            type="checkbox"
            checked={settings.quotaTracking.enabled}
            onChange={(e) =>
              updateSettings({
                quotaTracking: {
                  ...settings.quotaTracking,
                  enabled: e.target.checked,
                },
              })
            }
          />
          Enable Quota Tracking
        </label>
      </div>

      <div className="form-group">
        <label>
          <input
            type="checkbox"
            checked={settings.quotaTracking.syncWithTokenMeter}
            onChange={(e) =>
              updateSettings({
                quotaTracking: {
                  ...settings.quotaTracking,
                  syncWithTokenMeter: e.target.checked,
                },
              })
            }
          />
          Sync with TokenMeter
        </label>
      </div>
    </div>
  );
};

/**
 * Fallback Panel
 */
const FallbackPanel: React.FC<SettingsUIProps> = ({
  settings,
  updateSettings,
}) => {
  return (
    <div className="panel">
      <h3>Fallback</h3>
      <p>Configure automatic failover behavior.</p>

      <div className="form-group">
        <label>
          <input
            type="checkbox"
            checked={settings.fallback.enabled}
            onChange={(e) =>
              updateSettings({
                fallback: { ...settings.fallback, enabled: e.target.checked },
              })
            }
          />
          Enable Automatic Fallback
        </label>
      </div>

      <div className="form-group">
        <label>Max Retries</label>
        <input
          type="number"
          min={0}
          value={settings.fallback.maxRetries}
          onChange={(e) =>
            updateSettings({
              fallback: {
                ...settings.fallback,
                maxRetries: parseInt(e.target.value),
              },
            })
          }
        />
      </div>

      <div className="form-group">
        <label>Retry Delay (ms)</label>
        <input
          type="number"
          min={0}
          value={settings.fallback.retryDelay}
          onChange={(e) =>
            updateSettings({
              fallback: {
                ...settings.fallback,
                retryDelay: parseInt(e.target.value),
              },
            })
          }
        />
      </div>
    </div>
  );
};

export default LLMRouterSettings;
