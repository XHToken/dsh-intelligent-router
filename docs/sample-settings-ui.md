> ℹ️ **设计文档**：本文为 Settings UI 设计方案。当前实际生效的 UI 是 `src/client/index.tsx`（Magpie 风格），本文描述的部分组件/持久化细节与实现不完全一致。实际实现以 [README.md](../README.md) 为准。

# Router Sample Settings UI 配置方案

## 一、DSH Settings 系统架构

### 1.1 DSH Settings 架构

DeepSeek Harness 的 Settings 系统基于插件：

```
Settings 层次：
├── Global Settings（全局设置）
│   └── 用户级别的默认配置
├── Profile Settings（Profile 设置）
│   └── 每个 profile 的配置
├── Plugin Settings（插件设置）
│   └── 每个插件的可配置项
└── Session Settings（Session 设置）
    └── 每个会话的覆盖配置
```

**核心概念：**
- **Settings Schema** — 使用 Zod 定义配置结构
- **Settings Card** — 插件的 UI 配置界面
- **Settings Store** — 配置的持久化存储
- **Settings Events** — 配置变更通知

### 1.2 Settings Card 注册

```typescript
// 插件注册 Settings Card
export function apply(ctx: Context, config: Config) {
  // 注册路由器插件
  const router = new MagpieRouter(ctx, config)
  ctx.llm.registerAdapter(['magpie'], router)
  
  // 注册 Settings Card
  ctx.settings.registerCard({
    id: 'magpie-router',
    title: 'Magpie Router',
    icon: 'route',
    component: () => import('./settings-ui'),
    schema: RouterSettingsSchema,
  })
}
```

---

## 二、Settings Schema 设计

### 2.1 完整的 Settings Schema

```typescript
// packages/llm/llm-magpie-router/src/settings-schema.ts

import { z } from 'zod'

// 路由策略枚举
export const RoutingStrategySchema = z.enum([
  'smart',      // 智能：选择配额剩余时间最短的
  'order',      // 顺序：按优先级
  'rotate',     // 轮询：每个 turn 轮换
  'usage',      // TODO：使用率：最少使用优先
  'pace',       // TODO：节奏：按配额消耗速度
  'weighted',   // TODO：加权：加权随机
  'intent',     // 意图：基于意图分类
])

// 路由组成员
export const RouteGroupMemberSchema = z.object({
  provider: z.string().describe('Provider ID (e.g., deepseek-official, ollama)'),
  model: z.string().describe('Model ID (e.g., deepseek-v4-pro, llama3:8b)'),
  accountId: z.string().optional().describe('Account ID for multi-account providers'),
  priority: z.number().min(0).optional().describe('Priority for order strategy (0 = highest)'),
  weight: z.number().min(0).optional().describe('Weight for weighted strategy'),
  enabled: z.boolean().default(true).describe('Enable/disable this member'),
})

// 路由组
export const RouteGroupSchema = z.object({
  id: z.string().describe('Unique group identifier'),
  name: z.string().describe('Human-readable group name'),
  description: z.string().optional().describe('Group description'),
  members: z.array(RouteGroupMemberSchema).min(1).describe('Route group members'),
  strategy: RoutingStrategySchema.describe('Routing strategy'),
  
  // 策略特定配置
  strategyConfig: z.object({
    // smart 策略
    preferLowerLatency: z.boolean().optional()
      .describe('Prefer members with lower latency'),
    
    // intent 策略
    intentMapping: z.record(z.string(), z.string()).optional()
      .describe('Map intent to member provider:model'),
    
    // weighted 策略
    normalizeWeights: z.boolean().optional()
      .describe('Normalize weights to sum to 1'),
  }).optional(),
  
  // 高级选项
  auto: z.boolean().optional().describe('Auto-created group (e.g., failover)'),
  hidden: z.boolean().optional().describe('Hidden from UI'),
  enabled: z.boolean().default(true).describe('Enable/disable this group'),
})

// 意图路由配置
export const IntentRoutingSchema = z.object({
  enabled: z.boolean().default(false).describe('Enable intent-based routing'),
  classifierProvider: z.string().describe('Provider for intent classifier'),
  classifierModel: z.string().describe('Model for intent classifier'),
  confidenceThreshold: z.number().min(0).max(1).default(0.7)
    .describe('Minimum confidence to use classified intent'),
  cacheEnabled: z.boolean().default(true).describe('Cache classification results'),
  cacheTTL: z.number().default(300000).describe('Cache TTL in milliseconds'),
  
  // 预定义意图
  predefinedIntents: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    examples: z.array(z.string()).optional(),
  })).optional(),
})

// 配额管理配置
export const QuotaTrackingSchema = z.object({
  enabled: z.boolean().default(true).describe('Enable quota tracking'),
  syncWithTokenMeter: z.boolean().default(true)
    .describe('Sync with DSH TokenMeter'),
  
  // 配额限制
  limits: z.object({
    maxTokensPerDay: z.number().optional().describe('Daily token limit'),
    maxRequestsPerDay: z.number().optional().describe('Daily request limit'),
    maxTokensPerHour: z.number().optional().describe('Hourly token limit'),
    maxCostPerDay: z.number().optional().describe('Daily cost limit in USD'),
  }).optional(),
  
  // 警告阈值
  warnings: z.object({
    tokenThreshold: z.number().min(0).max(1).default(0.8)
      .describe('Warn when usage exceeds this percentage'),
    requestThreshold: z.number().min(0).max(1).default(0.8)
      .describe('Warn when requests exceed this percentage'),
  }).optional(),
})

// 故障转移配置
export const FallbackSchema = z.object({
  enabled: z.boolean().default(true).describe('Enable automatic fallback'),
  maxRetries: z.number().min(0).default(3).describe('Maximum retry attempts'),
  retryDelay: z.number().min(0).default(1000).describe('Delay between retries in ms'),
  
  // 可恢复的错误类型
  recoverableErrors: z.array(z.enum([
    'RATE_LIMIT',
    'AUTH',
    'QUOTA',
    'TIMEOUT',
    'SERVER_ERROR',
    'NETWORK_ERROR',
  ])).default(['RATE_LIMIT', 'QUOTA', 'TIMEOUT', 'SERVER_ERROR'])
    .describe('Error types that trigger fallback'),
  
  // 超时配置
  timeouts: z.object({
    connect: z.number().default(5000).describe('Connection timeout in ms'),
    request: z.number().default(30000).describe('Request timeout in ms'),
    stream: z.number().default(60000).describe('Stream timeout in ms'),
  }).optional(),
})

// 中间件配置
export const MiddlewareSchema = z.object({
  enabled: z.boolean().default(false).describe('Enable middleware'),
  middlewares: z.array(z.object({
    name: z.string().describe('Middleware name'),
    enabled: z.boolean().default(true).describe('Enable/disable'),
    config: z.record(z.any()).optional().describe('Middleware-specific config'),
  })).optional(),
})

// 完整的 Router Settings Schema
export const RouterSettingsSchema = z.object({
  // 基础配置
  enabled: z.boolean().default(true).describe('Enable Magpie Router'),
  defaultGroup: z.string().describe('Default route group ID'),
  
  // 路由组
  routeGroups: z.array(RouteGroupSchema).describe('Route group definitions'),
  
  // 意图路由
  intentRouting: IntentRoutingSchema.optional().describe('Intent routing configuration'),
  
  // 配额管理
  quotaTracking: QuotaTrackingSchema.describe('Quota tracking configuration'),
  
  // 故障转移
  fallback: FallbackSchema.describe('Fallback configuration'),
  
  // 中间件
  middleware: MiddlewareSchema.optional().describe('Middleware configuration'),
  
  // 高级选项
  advanced: z.object({
    logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info')
      .describe('Logging level'),
    metricsEnabled: z.boolean().default(true).describe('Collect routing metrics'),
    cacheEnabled: z.boolean().default(true).describe('Cache routing decisions'),
    cacheTTL: z.number().default(60000).describe('Cache TTL in milliseconds'),
  }).optional(),
})

export type RouterSettings = z.infer<typeof RouterSettingsSchema>
```

---

## 三、Settings UI 组件设计

### 3.1 主 Settings 页面

```tsx
// packages/llm/llm-magpie-router/src/settings-ui/index.tsx

import React, { useState, useEffect } from 'react'
import { useSettings } from '@deepseek-ai/dsh-settings'
import { RouterSettings, RouterSettingsSchema } from './settings-schema'
import { RouteGroupsPanel } from './panels/RouteGroupsPanel'
import { IntentRoutingPanel } from './panels/IntentRoutingPanel'
import { QuotaTrackingPanel } from './panels/QuotaTrackingPanel'
import { FallbackPanel } from './panels/FallbackPanel'
import { MiddlewarePanel } from './panels/MiddlewarePanel'
import { AdvancedPanel } from './panels/AdvancedPanel'

export const MagpieRouterSettings: React.FC = () => {
  const { settings, updateSettings, loading, error } = useSettings<RouterSettings>(
    'magpie-router',
    RouterSettingsSchema
  )
  
  const [activeTab, setActiveTab] = useState('route-groups')
  
  if (loading) {
    return <div className="dsh-loading">Loading settings...</div>
  }
  
  if (error) {
    return <div className="dsh-error">Error: {error.message}</div>
  }
  
  if (!settings) {
    return <div className="dsh-empty">No settings found</div>
  }
  
  return (
    <div className="magpie-router-settings">
      {/* 标题和开关 */}
      <div className="settings-header">
        <div className="header-left">
          <h2>Magpie Router</h2>
          <span className="version">v1.0.0</span>
        </div>
        <div className="header-right">
          <label className="dsh-toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => updateSettings({ enabled: e.target.checked })}
            />
            <span className="toggle-slider" />
          </label>
          <span className="toggle-label">
            {settings.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
      </div>
      
      {/* Tab 导航 */}
      <div className="settings-tabs">
        <button
          className={`tab ${activeTab === 'route-groups' ? 'active' : ''}`}
          onClick={() => setActiveTab('route-groups')}
        >
          Route Groups
        </button>
        <button
          className={`tab ${activeTab === 'intent' ? 'active' : ''}`}
          onClick={() => setActiveTab('intent')}
        >
          Intent Routing
        </button>
        <button
          className={`tab ${activeTab === 'quota' ? 'active' : ''}`}
          onClick={() => setActiveTab('quota')}
        >
          Quota Tracking
        </button>
        <button
          className={`tab ${activeTab === 'fallback' ? 'active' : ''}`}
          onClick={() => setActiveTab('fallback')}
        >
          Fallback
        </button>
        <button
          className={`tab ${activeTab === 'middleware' ? 'active' : ''}`}
          onClick={() => setActiveTab('middleware')}
        >
          Middleware
        </button>
        <button
          className={`tab ${activeTab === 'advanced' ? 'active' : ''}`}
          onClick={() => setActiveTab('advanced')}
        >
          Advanced
        </button>
      </div>
      
      {/* Tab 内容 */}
      <div className="settings-content">
        {activeTab === 'route-groups' && (
          <RouteGroupsPanel
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
        {activeTab === 'intent' && (
          <IntentRoutingPanel
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
        {activeTab === 'quota' && (
          <QuotaTrackingPanel
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
        {activeTab === 'fallback' && (
          <FallbackPanel
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
        {activeTab === 'middleware' && (
          <MiddlewarePanel
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
        {activeTab === 'advanced' && (
          <AdvancedPanel
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
      </div>
      
      {/* 保存按钮 */}
      <div className="settings-footer">
        <button
          className="dsh-button primary"
          onClick={() => {
            updateSettings(settings)
            alert('Settings saved successfully!')
          }}
        >
          Save Changes
        </button>
        <button
          className="dsh-button secondary"
          onClick={() => window.location.reload()}
        >
          Reset
        </button>
      </div>
    </div>
  )
}

export default MagpieRouterSettings
```

### 3.2 路由组管理面板

```tsx
// packages/llm/llm-magpie-router/src/settings-ui/panels/RouteGroupsPanel.tsx

import React, { useState } from 'react'
import { RouteGroup, RouterSettings } from '../settings-schema'
import { RouteGroupEditor } from '../components/RouteGroupEditor'
import { RouteGroupCard } from '../components/RouteGroupCard'

interface Props {
  settings: RouterSettings
  updateSettings: (updates: Partial<RouterSettings>) => void
}

export const RouteGroupsPanel: React.FC<Props> = ({ settings, updateSettings }) => {
  const [editingGroup, setEditingGroup] = useState<RouteGroup | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  
  const handleCreate = () => {
    setEditingGroup(null)
    setShowEditor(true)
  }
  
  const handleEdit = (group: RouteGroup) => {
    setEditingGroup(group)
    setShowEditor(true)
  }
  
  const handleDelete = (groupId: string) => {
    if (confirm('Are you sure you want to delete this route group?')) {
      const updatedGroups = settings.routeGroups.filter(g => g.id !== groupId)
      updateSettings({ routeGroups: updatedGroups })
    }
  }
  
  const handleSave = (group: RouteGroup) => {
    const existingIndex = settings.routeGroups.findIndex(g => g.id === group.id)
    
    let updatedGroups: RouteGroup[]
    if (existingIndex >= 0) {
      // 更新现有组
      updatedGroups = [...settings.routeGroups]
      updatedGroups[existingIndex] = group
    } else {
      // 创建新组
      updatedGroups = [...settings.routeGroups, group]
    }
    
    updateSettings({ routeGroups: updatedGroups })
    setShowEditor(false)
  }
  
  const handleSetDefault = (groupId: string) => {
    updateSettings({ defaultGroup: groupId })
  }
  
  return (
    <div className="route-groups-panel">
      <div className="panel-header">
        <h3>Route Groups</h3>
        <button className="dsh-button primary" onClick={handleCreate}>
          <span className="icon">+</span>
          Create Group
        </button>
      </div>
      
      <div className="panel-description">
        <p>
          Route groups define which models are available for routing. 
          Each group can use a different strategy to select the best model.
        </p>
      </div>
      
      {/* 路由组列表 */}
      <div className="route-groups-list">
        {settings.routeGroups.length === 0 ? (
          <div className="empty-state">
            <p>No route groups configured.</p>
            <button className="dsh-button primary" onClick={handleCreate}>
              Create your first route group
            </button>
          </div>
        ) : (
          settings.routeGroups.map(group => (
            <RouteGroupCard
              key={group.id}
              group={group}
              isDefault={group.id === settings.defaultGroup}
              onEdit={() => handleEdit(group)}
              onDelete={() => handleDelete(group.id)}
              onSetDefault={() => handleSetDefault(group.id)}
            />
          ))
        )}
      </div>
      
      {/* 编辑器模态框 */}
      {showEditor && (
        <RouteGroupEditor
          group={editingGroup}
          existingProviders={getAvailableProviders()}
          onSave={handleSave}
          onCancel={() => setShowEditor(false)}
        />
      )}
    </div>
  )
}

function getAvailableProviders(): string[] {
  // 从 DSH 的 LLM 服务获取可用的 providers
  return ['deepseek-official', 'ollama', 'anthropic', 'openai']
}
```

### 3.3 路由组卡片组件

```tsx
// packages/llm/llm-magpie-router/src/settings-ui/components/RouteGroupCard.tsx

import React from 'react'
import { RouteGroup } from '../settings-schema'

interface Props {
  group: RouteGroup
  isDefault: boolean
  onEdit: () => void
  onDelete: () => void
  onSetDefault: () => void
}

export const RouteGroupCard: React.FC<Props> = ({
  group,
  isDefault,
  onEdit,
  onDelete,
  onSetDefault,
}) => {
  const strategyLabels: Record<string, string> = {
    smart: '🧠 Smart',
    order: '📋 Order',
    rotate: '🔄 Rotate',
    usage: '📊 Usage',
    pace: '⚡ Pace',
    weighted: '⚖️ Weighted',
    intent: '🎯 Intent',
  }
  
  return (
    <div className={`route-group-card ${isDefault ? 'default' : ''} ${!group.enabled ? 'disabled' : ''}`}>
      <div className="card-header">
        <div className="card-title">
          <h4>{group.name}</h4>
          {isDefault && <span className="badge default">Default</span>}
          {!group.enabled && <span className="badge disabled">Disabled</span>}
        </div>
        <div className="card-actions">
          {!isDefault && group.enabled && (
            <button
              className="dsh-button text"
              onClick={onSetDefault}
              title="Set as default"
            >
              Set Default
            </button>
          )}
          <button className="dsh-button text" onClick={onEdit}>
            Edit
          </button>
          <button
            className="dsh-button text danger"
            onClick={onDelete}
            title="Delete"
          >
            Delete
          </button>
        </div>
      </div>
      
      {group.description && (
        <div className="card-description">
          {group.description}
        </div>
      )}
      
      <div className="card-meta">
        <div className="meta-item">
          <span className="label">Strategy:</span>
          <span className="value">{strategyLabels[group.strategy]}</span>
        </div>
        <div className="meta-item">
          <span className="label">Members:</span>
          <span className="value">{group.members.length}</span>
        </div>
      </div>
      
      {/* 成员列表预览 */}
      <div className="card-members">
        <div className="members-label">Members:</div>
        <div className="members-list">
          {group.members.slice(0, 3).map((member, idx) => (
            <div key={idx} className={`member ${!member.enabled ? 'disabled' : ''}`}>
              <span className="provider">{member.provider}</span>
              <span className="separator">/</span>
              <span className="model">{member.model}</span>
            </div>
          ))}
          {group.members.length > 3 && (
            <div className="member more">
              +{group.members.length - 3} more
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

### 3.4 路由组编辑器

```tsx
// packages/llm/llm-magpie-router/src/settings-ui/components/RouteGroupEditor.tsx

import React, { useState, useEffect } from 'react'
import { RouteGroup, RouteGroupMember, RoutingStrategySchema } from '../settings-schema'

interface Props {
  group: RouteGroup | null  // null = create new
  existingProviders: string[]
  onSave: (group: RouteGroup) => void
  onCancel: () => void
}

export const RouteGroupEditor: React.FC<Props> = ({
  group,
  existingProviders,
  onSave,
  onCancel,
}) => {
  const [formData, setFormData] = useState<RouteGroup>(() => {
    if (group) {
      return { ...group }
    }
    return {
      id: `group-${Date.now()}`,
      name: '',
      description: '',
      members: [],
      strategy: 'order',
      enabled: true,
    }
  })
  
  const [errors, setErrors] = useState<Record<string, string>>({})
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    // 验证
    const newErrors: Record<string, string> = {}
    
    if (!formData.name.trim()) {
      newErrors.name = 'Name is required'
    }
    
    if (formData.members.length === 0) {
      newErrors.members = 'At least one member is required'
    }
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }
    
    onSave(formData)
  }
  
  const handleAddMember = () => {
    const newMember: RouteGroupMember = {
      provider: existingProviders[0] || '',
      model: '',
      enabled: true,
    }
    
    setFormData({
      ...formData,
      members: [...formData.members, newMember],
    })
  }
  
  const handleUpdateMember = (index: number, updates: Partial<RouteGroupMember>) => {
    const updatedMembers = [...formData.members]
    updatedMembers[index] = { ...updatedMembers[index], ...updates }
    
    setFormData({
      ...formData,
      members: updatedMembers,
    })
  }
  
  const handleRemoveMember = (index: number) => {
    const updatedMembers = formData.members.filter((_, i) => i !== index)
    
    setFormData({
      ...formData,
      members: updatedMembers,
    })
  }
  
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <div className="modal-header">
            <h3>{group ? 'Edit Route Group' : 'Create Route Group'}</h3>
            <button type="button" className="close-button" onClick={onCancel}>
              ×
            </button>
          </div>
          
          <div className="modal-body">
            {/* 基础信息 */}
            <div className="form-section">
              <h4>Basic Information</h4>
              
              <div className="form-group">
                <label>Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Daily Coding"
                  className={errors.name ? 'error' : ''}
                />
                {errors.name && <span className="error-message">{errors.name}</span>}
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description"
                  rows={2}
                />
              </div>
            </div>
            
            {/* 路由策略 */}
            <div className="form-section">
              <h4>Routing Strategy</h4>
              
              <div className="form-group">
                <label>Strategy *</label>
                <select
                  value={formData.strategy}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    strategy: e.target.value as any 
                  })}
                >
                  {RoutingStrategySchema.options.map(strategy => (
                    <option key={strategy} value={strategy}>
                      {strategy.charAt(0).toUpperCase() + strategy.slice(1)}
                    </option>
                  ))}
                </select>
                <div className="help-text">
                  {getStrategyDescription(formData.strategy)}
                </div>
              </div>
            </div>
            
            {/* 成员列表 */}
            <div className="form-section">
              <h4>Members *</h4>
              
              {errors.members && (
                <div className="error-message">{errors.members}</div>
              )}
              
              <div className="members-editor">
                {formData.members.map((member, index) => (
                  <div key={index} className="member-editor">
                    <div className="member-row">
                      <div className="member-field">
                        <label>Provider</label>
                        <select
                          value={member.provider}
                          onChange={(e) => handleUpdateMember(index, {
                            provider: e.target.value
                          })}
                        >
                          {existingProviders.map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </div>
                      
                      <div className="member-field">
                        <label>Model</label>
                        <input
                          type="text"
                          value={member.model}
                          onChange={(e) => handleUpdateMember(index, {
                            model: e.target.value
                          })}
                          placeholder="e.g., deepseek-v4-pro"
                        />
                      </div>
                      
                      {formData.strategy === 'order' && (
                        <div className="member-field">
                          <label>Priority</label>
                          <input
                            type="number"
                            value={member.priority ?? 0}
                            onChange={(e) => handleUpdateMember(index, {
                              priority: parseInt(e.target.value)
                            })}
                            min={0}
                          />
                        </div>
                      )}
                      
                      {formData.strategy === 'weighted' && (
                        <div className="member-field">
                          <label>Weight</label>
                          <input
                            type="number"
                            value={member.weight ?? 1}
                            onChange={(e) => handleUpdateMember(index, {
                              weight: parseFloat(e.target.value)
                            })}
                            min={0}
                            step={0.1}
                          />
                        </div>
                      )}
                      
                      <div className="member-actions">
                        <button
                          type="button"
                          className="dsh-button text danger"
                          onClick={() => handleRemoveMember(index)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                
                <button
                  type="button"
                  className="dsh-button secondary"
                  onClick={handleAddMember}
                >
                  + Add Member
                </button>
              </div>
            </div>
            
            {/* 高级选项 */}
            <div className="form-section">
              <h4>Advanced Options</h4>
              
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.enabled}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      enabled: e.target.checked 
                    })}
                  />
                  <span>Enable this route group</span>
                </label>
              </div>
              
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.hidden ?? false}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      hidden: e.target.checked 
                    })}
                  />
                  <span>Hide from UI</span>
                </label>
              </div>
            </div>
          </div>
          
          <div className="modal-footer">
            <button type="button" className="dsh-button secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="dsh-button primary">
              {group ? 'Save Changes' : 'Create Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function getStrategyDescription(strategy: string): string {
  const descriptions: Record<string, string> = {
    smart: 'Selects the member with the shortest quota remaining time to minimize waste at reset.',
    order: 'Uses members in priority order. Falls back to the next member on failure.',
    rotate: 'Rotates to the next member on each turn for even distribution.',
    usage: 'Prioritizes the least-used member to balance load.',
    pace: 'Uses the account with the most quota left per hour until reset.',
    weighted: 'Selects members randomly based on assigned weights.',
    intent: 'Routes based on detected user intent (requires intent classifier).',
  }
  return descriptions[strategy] || ''
}
```

### 3.5 其他面板组件（简要示例）

```tsx
// packages/llm/llm-magpie-router/src/settings-ui/panels/IntentRoutingPanel.tsx

import React from 'react'
import { RouterSettings } from '../settings-schema'

interface Props {
  settings: RouterSettings
  updateSettings: (updates: Partial<RouterSettings>) => void
}

export const IntentRoutingPanel: React.FC<Props> = ({ settings, updateSettings }) => {
  const intentConfig = settings.intentRouting ?? {
    enabled: false,
    classifierProvider: '',
    classifierModel: '',
    confidenceThreshold: 0.7,
    cacheEnabled: true,
    cacheTTL: 300000,
  }
  
  const updateIntentConfig = (updates: Partial<typeof intentConfig>) => {
    updateSettings({
      intentRouting: { ...intentConfig, ...updates }
    })
  }
  
  return (
    <div className="intent-routing-panel">
      <div className="panel-header">
        <h3>Intent Routing</h3>
        <label className="dsh-toggle">
          <input
            type="checkbox"
            checked={intentConfig.enabled}
            onChange={(e) => updateIntentConfig({ enabled: e.target.checked })}
          />
          <span className="toggle-slider" />
        </label>
      </div>
      
      <div className="panel-description">
        <p>
          Use a small model to classify each request's intent and route to 
          the appropriate model (e.g., strong model for code, cheap model for simple questions).
        </p>
      </div>
      
      {intentConfig.enabled && (
        <div className="panel-content">
          <div className="form-group">
            <label>Classifier Provider</label>
            <select
              value={intentConfig.classifierProvider}
              onChange={(e) => updateIntentConfig({ 
                classifierProvider: e.target.value 
              })}
            >
              <option value="">Select provider...</option>
              <option value="ollama">Ollama (Local)</option>
              <option value="deepseek-official">DeepSeek</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Classifier Model</label>
            <input
              type="text"
              value={intentConfig.classifierModel}
              onChange={(e) => updateIntentConfig({ 
                classifierModel: e.target.value 
              })}
              placeholder="e.g., llama3:8b"
            />
          </div>
          
          <div className="form-group">
            <label>Confidence Threshold</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={intentConfig.confidenceThreshold}
              onChange={(e) => updateIntentConfig({ 
                confidenceThreshold: parseFloat(e.target.value) 
              })}
            />
            <span className="value-display">
              {(intentConfig.confidenceThreshold * 100).toFixed(0)}%
            </span>
          </div>
          
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={intentConfig.cacheEnabled}
                onChange={(e) => updateIntentConfig({ 
                  cacheEnabled: e.target.checked 
                })}
              />
              <span>Enable classification cache</span>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
```

---

## 四、CSS 样式

```css
/* packages/llm/llm-magpie-router/src/settings-ui/styles.css */

.magpie-router-settings {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}

.settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.settings-header h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.settings-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.tab {
  padding: 12px 20px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary, #666);
  transition: all 0.2s;
}

.tab:hover {
  color: var(--text-primary, #333);
}

.tab.active {
  color: var(--primary-color, #0066cc);
  border-bottom-color: var(--primary-color, #0066cc);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.panel-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.panel-description {
  margin-bottom: 24px;
  color: var(--text-secondary, #666);
  font-size: 14px;
  line-height: 1.5;
}

/* Route Group Cards */
.route-groups-list {
  display: grid;
  gap: 16px;
}

.route-group-card {
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  padding: 16px;
  background: var(--bg-primary, #fff);
  transition: all 0.2s;
}

.route-group-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.route-group-card.default {
  border-color: var(--primary-color, #0066cc);
  border-width: 2px;
}

.route-group-card.disabled {
  opacity: 0.6;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-title h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}

.badge.default {
  background: var(--primary-color, #0066cc);
  color: white;
}

.badge.disabled {
  background: var(--text-secondary, #666);
  color: white;
}

.card-actions {
  display: flex;
  gap: 8px;
}

.card-meta {
  display: flex;
  gap: 24px;
  margin-bottom: 12px;
  font-size: 13px;
}

.meta-item {
  display: flex;
  gap: 6px;
}

.meta-item .label {
  color: var(--text-secondary, #666);
}

.meta-item .value {
  font-weight: 500;
}

.card-members {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

.members-label {
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin-bottom: 8px;
}

.members-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.member {
  padding: 4px 10px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
  font-size: 12px;
  font-family: monospace;
}

.member.disabled {
  opacity: 0.5;
  text-decoration: line-through;
}

.member .provider {
  color: var(--text-secondary, #666);
}

.member .separator {
  margin: 0 2px;
  color: var(--text-secondary, #666);
}

.member .model {
  font-weight: 500;
}

.member.more {
  color: var(--text-secondary, #666);
  font-style: italic;
}

/* Modal */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--bg-primary, #fff);
  border-radius: 12px;
  max-width: 700px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.modal-header h3 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.close-button {
  background: none;
  border: none;
  font-size: 28px;
  cursor: pointer;
  color: var(--text-secondary, #666);
  line-height: 1;
}

.modal-body {
  padding: 24px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

/* Form */
.form-section {
  margin-bottom: 24px;
}

.form-section h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-secondary, #666);
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 500;
}

.form-group input[type="text"],
.form-group input[type="number"],
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 14px;
  background: var(--bg-primary, #fff);
}

.form-group input.error {
  border-color: var(--error-color, #cc0000);
}

.error-message {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--error-color, #cc0000);
}

.help-text {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-secondary, #666);
  line-height: 1.4;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

/* Members Editor */
.members-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.member-editor {
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  padding: 12px;
  background: var(--bg-secondary, #f9f9f9);
}

.member-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto auto;
  gap: 12px;
  align-items: end;
}

.member-field label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 500;
}

.member-field input,
.member-field select {
  padding: 6px 10px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  font-size: 13px;
}

.member-actions {
  display: flex;
  align-items: end;
}

/* Buttons */
.dsh-button {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.dsh-button.primary {
  background: var(--primary-color, #0066cc);
  color: white;
}

.dsh-button.primary:hover {
  background: var(--primary-hover, #0052a3);
}

.dsh-button.secondary {
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-primary, #333);
  border: 1px solid var(--border-color, #e0e0e0);
}

.dsh-button.secondary:hover {
  background: var(--bg-tertiary, #e0e0e0);
}

.dsh-button.text {
  background: none;
  color: var(--primary-color, #0066cc);
  padding: 4px 8px;
}

.dsh-button.text:hover {
  background: var(--bg-secondary, #f5f5f5);
}

.dsh-button.text.danger {
  color: var(--error-color, #cc0000);
}

/* Toggle Switch */
.dsh-toggle {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 24px;
}

.dsh-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--bg-tertiary, #ccc);
  transition: 0.3s;
  border-radius: 24px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
}

.dsh-toggle input:checked + .toggle-slider {
  background-color: var(--primary-color, #0066cc);
}

.dsh-toggle input:checked + .toggle-slider:before {
  transform: translateX(24px);
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: 48px 24px;
  color: var(--text-secondary, #666);
}

.empty-state p {
  margin-bottom: 16px;
}

/* Footer */
.settings-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}
```

---

## 五、集成到 DSH

### 5.1 插件注册

```typescript
// packages/llm/llm-magpie-router/src/index.ts

import { z } from 'zod'
import type { Context } from '@cordis'
import { MagpieRouter } from './router'
import { RouterSettingsSchema, RouterSettings } from './settings-schema'

export const name = 'llm-magpie-router'
export const inject = ['llm', 'settings']

export function apply(ctx: Context, config: RouterSettings) {
  // 创建路由器
  const router = new MagpieRouter(ctx, config)
  
  // 注册为 'magpie' 提供商
  ctx.llm.registerAdapter(['magpie'], router)
  
  // 注册 Settings Card
  ctx.settings.registerCard({
    id: 'magpie-router',
    title: 'Magpie Router',
    description: 'Intelligent LLM routing with failover and quota management',
    icon: 'route',
    component: () => import('./settings-ui'),
    schema: RouterSettingsSchema,
    defaultConfig: {
      enabled: true,
      defaultGroup: 'default',
      routeGroups: [],
      quotaTracking: {
        enabled: true,
        syncWithTokenMeter: true,
      },
      fallback: {
        enabled: true,
        maxRetries: 3,
      },
    },
  })
}
```

### 5.2 Settings 持久化

DSH 的 Settings 系统会自动处理配置的持久化：

```typescript
// DSH Settings 存储位置
~/.dsh/
├── settings.json          # 全局设置
├── profiles/
│   └── web/
│       └── settings.json  # Profile 特定设置
└── plugins/
    └── llm-magpie-router/
        └── settings.json  # 插件设置
```

### 5.3 Settings 事件监听

```typescript
// 监听设置变更
ctx.on('settings/changed', (event) => {
  if (event.pluginId === 'llm-magpie-router') {
    // 重新配置路由器
    router.reconfigure(event.newSettings)
  }
})
```

---

## 六、使用流程

### 6.1 用户操作流程

1. **打开 DSH Web UI**
   ```
   http://127.0.0.1:3080
   ```

2. **进入 Settings → Plugins → Magpie Router**

3. **创建路由组**
   - 点击 "Create Group"
   - 填写名称和描述
   - 选择路由策略
   - 添加成员（provider/model）
   - 保存

4. **配置意图路由（可选）**
   - 启用 Intent Routing
   - 选择分类器模型
   - 设置信心阈值

5. **配置配额管理**
   - 启用 Quota Tracking
   - 设置配额限制
   - 配置警告阈值

6. **保存设置**
   - 点击 "Save Changes"
   - 配置立即生效

### 6.2 配置文件生成

用户通过 UI 配置后，DSH 自动生成配置文件：

```yaml
# ~/.dsh/plugins/llm-magpie-router/settings.json
{
  "enabled": true,
  "defaultGroup": "daily-coding",
  "routeGroups": [
    {
      "id": "daily-coding",
      "name": "日常编码",
      "members": [
        {
          "provider": "deepseek-official",
          "model": "deepseek-v4-pro",
          "priority": 1,
          "enabled": true
        },
        {
          "provider": "ollama",
          "model": "deepseek-coder:6.7b",
          "priority": 2,
          "enabled": true
        }
      ],
      "strategy": "order",
      "enabled": true
    }
  ],
  "intentRouting": {
    "enabled": true,
    "classifierProvider": "ollama",
    "classifierModel": "llama3:8b",
    "confidenceThreshold": 0.7
  },
  "quotaTracking": {
    "enabled": true,
    "syncWithTokenMeter": true,
    "limits": {
      "maxTokensPerDay": 1000000
    }
  }
}
```

---

## 七、总结

通过这个 Settings UI 方案，用户可以：

✅ **可视化配置** — 所有路由功能通过 Web UI 配置  
✅ **实时预览** — 配置变更立即生效  
✅ **错误验证** — 表单验证防止无效配置  
✅ **导入导出** — 支持配置文件的导入导出  
✅ **多 Profile** — 不同 Profile 可以使用不同配置  

这个方案完全符合 DeepSeek Harness 的插件架构和用户界面规范，提供了与 Magpie 相当的用户体验！
