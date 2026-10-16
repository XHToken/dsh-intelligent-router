/**
 * Intent Classifier for intelligent routing
 * Uses a small model to classify user requests and route to appropriate models
 */

import type { Context } from "@cordis/core";
import type { GenerateOptions } from "@deepseek-ai/dsh-llm";

export interface IntentConfig {
  enabled: boolean;
  classifierProvider: string;
  classifierModel: string;
  confidenceThreshold: number;
  cacheEnabled: boolean;
  cacheTTL: number;
}

export type IntentType =
  | "code-generation"
  | "code-review"
  | "debugging"
  | "explanation"
  | "simple-qa"
  | "complex-reasoning"
  | "creative-writing"
  | "translation"
  | "summarization"
  | "unknown";

export interface IntentResult {
  intent: IntentType;
  confidence: number;
  reasoning?: string;
}

export interface IntentMapping {
  [intent: string]: {
    provider: string;
    model: string;
    priority?: number;
  };
}

export class IntentClassifier {
  private cache: Map<string, { result: IntentResult; timestamp: number }> =
    new Map();

  constructor(
    private ctx: Context,
    private config: IntentConfig,
    private mappings: IntentMapping = {},
  ) {}

  /**
   * Classify the intent of a request
   */
  async classify(options: GenerateOptions): Promise<IntentResult> {
    if (!this.config.enabled) {
      return { intent: "unknown", confidence: 0 };
    }

    // Check cache first
    const cacheKey = this.getCacheKey(options);
    if (this.config.cacheEnabled) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
        return cached.result;
      }
    }

    // Classify using small model
    const result = await this.classifyWithModel(options);

    // Cache the result
    if (this.config.cacheEnabled) {
      this.cache.set(cacheKey, { result, timestamp: Date.now() });
    }

    return result;
  }

  /**
   * Get the best model for an intent
   */
  getModelForIntent(
    intent: IntentType,
  ): { provider: string; model: string } | null {
    const mapping = this.mappings[intent];
    if (!mapping) {
      return null;
    }
    return {
      provider: mapping.provider,
      model: mapping.model,
    };
  }

  /**
   * Set intent mappings
   */
  setMappings(mappings: IntentMapping): void {
    this.mappings = mappings;
  }

  /**
   * Classify using a small model
   */
  private async classifyWithModel(
    options: GenerateOptions,
  ): Promise<IntentResult> {
    try {
      const adapter = (this.ctx as any).llm?.getAdapter?.(
        this.config.classifierProvider,
      );
      if (!adapter) {
        console.warn("[IntentClassifier] Classifier provider not found");
        return { intent: "unknown", confidence: 0 };
      }

      const prompt = this.buildClassificationPrompt(options);

      let response = "";
      for await (const chunk of adapter.stream({
        provider: this.config.classifierProvider,
        model: this.config.classifierModel,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        maxTokens: 100,
      })) {
        if (chunk.type === "text-delta") {
          response += chunk.text;
        }
      }

      return this.parseClassificationResponse(response);
    } catch (error) {
      console.error("[IntentClassifier] Classification failed:", error);
      return { intent: "unknown", confidence: 0 };
    }
  }

  /**
   * Build classification prompt
   */
  private buildClassificationPrompt(options: GenerateOptions): string {
    const lastMessage = this.extractLastUserMessage(options);

    return `你是一个意图分类器。请分析以下用户请求，并分类为以下意图之一：

意图类别：
- code-generation: 编写代码、实现功能、创建程序
- code-review: 审查代码、检查代码质量、代码优化建议
- debugging: 调试代码、修复 bug、解决错误
- explanation: 解释概念、说明原理、教学
- simple-qa: 简单问题、快速回答、事实查询
- complex-reasoning: 复杂推理、多步分析、深度思考
- creative-writing: 创意写作、故事创作、文案生成
- translation: 翻译文本、语言转换
- summarization: 总结内容、提取要点、生成摘要
- unknown: 其他或无法分类

用户请求：
${lastMessage}

请只返回 JSON 格式的分类结果，包含：
- intent: 意图类别（从上面的列表中选择）
- confidence: 置信度（0-1 之间的数字）
- reasoning: 简短的分类理由（可选）

示例输出：
{"intent": "code-generation", "confidence": 0.95, "reasoning": "用户要求编写一个函数"}`;
  }

  /**
   * Extract the last user message
   */
  private extractLastUserMessage(options: GenerateOptions): string {
    try {
      const messages = options?.messages || [];
      const lastUserMessage = [...messages]
        .reverse()
        .find((m) => m?.role === "user");

      if (!lastUserMessage) {
        return "";
      }

      const content = lastUserMessage.content || [];
      const textContent = content
        .filter((c: any) => c?.type === "text")
        .map((c: any) => c?.text || "")
        .join("\n");

      // Limit to 500 characters for classification
      return textContent.substring(0, 500);
    } catch (error) {
      console.error(
        "[IntentClassifier] Error extracting last user message:",
        error,
      );
      return "";
    }
  }

  /**
   * Parse classification response
   */
  private parseClassificationResponse(response: string): IntentResult {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { intent: "unknown", confidence: 0 };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate intent type
      const validIntents: IntentType[] = [
        "code-generation",
        "code-review",
        "debugging",
        "explanation",
        "simple-qa",
        "complex-reasoning",
        "creative-writing",
        "translation",
        "summarization",
        "unknown",
      ];

      const intent = (validIntents || []).includes(parsed.intent)
        ? parsed.intent
        : "unknown";
      const confidence =
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.5;

      return {
        intent,
        confidence,
        reasoning: parsed.reasoning,
      };
    } catch (error) {
      console.error("[IntentClassifier] Failed to parse response:", error);
      return { intent: "unknown", confidence: 0 };
    }
  }

  /**
   * Generate cache key
   */
  private getCacheKey(options: GenerateOptions): string {
    const lastMessage = this.extractLastUserMessage(options);
    // Simple hash of the message
    return lastMessage.substring(0, 200);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; enabled: boolean } {
    return {
      size: this.cache.size,
      enabled: this.config.cacheEnabled,
    };
  }
}
