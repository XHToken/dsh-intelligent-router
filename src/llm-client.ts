/**
 * Standalone LLM Client
 * Directly calls LLM APIs without relying on DSH's provider system
 */

import type { StreamChunk, GenerateOptions } from "@deepseek-ai/dsh-llm";

export interface LLMClientConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  protocol?: "openai" | "anthropic" | "ollama"; // Explicit protocol override
  thinking?: {
    enabled: boolean;
    budget?: number;
  };
}

export class LLMClient {
  private config: LLMClientConfig;

  constructor(config: LLMClientConfig) {
    this.config = config;
  }

  /**
   * Stream a request to the LLM
   */
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    try {
      // Determine protocol: explicit config > provider name detection
      const protocol =
        this.config.protocol || this.detectProtocol(this.config.provider);

      switch (protocol) {
        case "openai":
          yield* this.streamOpenAICompatible(options);
          break;
        case "anthropic":
          yield* this.streamAnthropicCompatible(options);
          break;
        case "ollama":
          yield* this.streamOllama(options);
          break;
        default:
          throw new Error(`Unsupported protocol: ${protocol}`);
      }
    } catch (error) {
      console.error(
        `[LLMClient] Error streaming from ${this.config.provider}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Detect protocol from provider name
   */
  private detectProtocol(provider: string): "openai" | "anthropic" | "ollama" {
    const lowerProvider = (provider || "").toLowerCase();

    if (!lowerProvider) {
      console.warn(
        "[DSH-LLM-Router] No provider specified for protocol detection, defaulting to openai",
      );
      return "openai";
    }

    // Anthropic providers
    if (
      lowerProvider.includes("anthropic") ||
      lowerProvider.includes("claude")
    ) {
      return "anthropic";
    }

    // Ollama (local)
    if (lowerProvider.includes("ollama")) {
      return "ollama";
    }

    // Everything else uses OpenAI-compatible protocol
    // This includes: deepseek, openai, custom providers, etc.
    return "openai";
  }

  /**
   * Stream to any OpenAI-compatible API
   * Works with: OpenAI, DeepSeek, Azure OpenAI, custom endpoints, etc.
   */
  private async *streamOpenAICompatible(
    options: GenerateOptions,
  ): AsyncIterable<StreamChunk> {
    const apiKey = this.config.apiKey || this.getApiKeyFromEnv();
    const baseUrl = this.config.baseUrl || this.getDefaultBaseUrl();

    if (!apiKey) {
      throw new Error(
        `API key not configured for ${this.config.provider}. Set apiKey in config or use environment variable.`,
      );
    }

    const url = `${baseUrl}/v1/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: options.messages,
        stream: true,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        top_p: options.topP,
        stop: options.stop,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI-compatible API error: ${response.status} ${response.statusText}\n${errorText}`,
      );
    }

    yield* this.parseSSEStream(response);
  }

  /**
   * Stream to any Anthropic-compatible API
   * Works with: Anthropic Claude, DashScope, custom endpoints, etc.
   */
  private async *streamAnthropicCompatible(
    options: GenerateOptions,
  ): AsyncIterable<StreamChunk> {
    const apiKey = this.config.apiKey || this.getApiKeyFromEnv();
    const baseUrl = this.config.baseUrl || this.getDefaultBaseUrl();

    if (!apiKey) {
      throw new Error(
        `API key not configured for ${this.config.provider}. Set apiKey in config or use environment variable.`,
      );
    }

    const url = `${baseUrl}/v1/messages`;

    // Extract system message if present
    const systemMessage = options.messages?.find(
      (m: any) => m.role === "system",
    );
    const messages =
      options.messages?.filter((m: any) => m.role !== "system") || [];

    // Convert messages to Anthropic format
    const anthropicMessages = messages.map((m: any) => ({
      role: m.role === "user" ? "user" : "assistant",
      content:
        typeof m.content === "string"
          ? m.content
          : m.content
              ?.filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("\n") || "",
    }));

    // Build request body
    const requestBody: any = {
      model: this.config.model,
      messages: anthropicMessages,
      stream: true,
      max_tokens: options.maxTokens || 4096,
    };

    // Add system message if present (as string, not array)
    if (systemMessage) {
      const systemContent =
        typeof systemMessage.content === "string"
          ? systemMessage.content
          : systemMessage.content
              ?.filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("\n") || "";
      if (systemContent) {
        requestBody.system = systemContent;
      }
    }

    // Add thinking configuration if enabled
    if (this.config.thinking?.enabled) {
      requestBody.thinking = {
        type: "enabled",
        budget_tokens: this.config.thinking.budget || 10000,
      };
      requestBody.max_tokens = Math.max(
        requestBody.max_tokens,
        (this.config.thinking.budget || 10000) + 4096,
      );
    }

    // Add optional parameters only if they're defined
    if (options.temperature !== undefined) {
      requestBody.temperature = options.temperature;
    }
    if (options.topP !== undefined) {
      requestBody.top_p = options.topP;
    }
    if (options.stop !== undefined && Array.isArray(options.stop)) {
      requestBody.stop_sequences = options.stop;
    }

    // Add tools if present
    if (
      options.tools &&
      Array.isArray(options.tools) &&
      options.tools.length > 0
    ) {
      requestBody.tools = options.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema ||
          tool.input_schema || {
            type: "object",
            properties: {},
          },
      }));
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(requestBody),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Anthropic-compatible API error: ${response.status} ${response.statusText}\n${errorText}`,
      );
    }

    yield* this.parseAnthropicStream(response);
  }

  /**
   * Stream to Ollama API (local)
   */
  private async *streamOllama(
    options: GenerateOptions,
  ): AsyncIterable<StreamChunk> {
    const baseUrl = this.config.baseUrl || "http://localhost:11434";
    const url = `${baseUrl}/api/chat`;

    // Convert messages to Ollama format (content must be string, not array)
    const ollamaMessages =
      options.messages?.map((msg: any) => ({
        role: msg.role,
        content:
          typeof msg.content === "string"
            ? msg.content
            : msg.content?.map((c: any) => c.text || "").join("\n") || "",
      })) || [];

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: ollamaMessages,
        stream: true,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Ollama API error: ${response.status} ${response.statusText}\n${errorText}`,
      );
    }

    yield* this.parseOllamaStream(response);
  }

  /**
   * Get API key from environment variable
   */
  private getApiKeyFromEnv(): string | undefined {
    const provider = this.config.provider.toLowerCase();

    // Try provider-specific env vars
    const envVars = [
      `${provider.toUpperCase()}_API_KEY`,
      `${provider.toUpperCase()}_KEY`,
      "API_KEY",
    ];

    for (const envVar of envVars) {
      const value = process.env[envVar];
      if (value) {
        return value;
      }
    }

    return undefined;
  }

  /**
   * Get default base URL for provider
   */
  private getDefaultBaseUrl(): string {
    const provider = this.config.provider?.toLowerCase() || "";

    if (!provider) {
      console.warn(
        "[DSH-LLM-Router] No provider specified, using default OpenAI URL",
      );
      return "https://api.openai.com";
    }

    const defaultUrls: Record<string, string> = {
      openai: "https://api.openai.com",
      deepseek: "https://api.deepseek.com",
      anthropic: "https://api.anthropic.com",
      claude: "https://api.anthropic.com",
      ollama: "http://localhost:11434",
    };

    // Check for exact match
    if (defaultUrls[provider]) {
      return defaultUrls[provider];
    }

    // Check for partial match with defensive check
    for (const [key, url] of Object.entries(defaultUrls)) {
      if (typeof provider === "string" && provider.includes(key)) {
        return url;
      }
    }

    // Default to OpenAI-compatible format
    return "https://api.openai.com";
  }

  /**
   * Parse SSE stream (OpenAI/DeepSeek format)
   */
  private async *parseSSEStream(
    response: Response,
  ): AsyncIterable<StreamChunk> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.substring(6);
          if (data === "[DONE]") {
            yield { type: "finish", reason: { kind: "stop" } };
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;

            if (delta?.content) {
              yield {
                type: "text-delta",
                text: delta.content,
                index: 0,
              };
            }

            if (parsed.usage) {
              yield {
                type: "usage",
                usage: {
                  inputTokens: parsed.usage.prompt_tokens,
                  outputTokens: parsed.usage.completion_tokens,
                },
              };
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }
  }

  /**
   * Parse Ollama stream
   */
  private async *parseOllamaStream(
    response: Response,
  ): AsyncIterable<StreamChunk> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);

            if (parsed.message?.content) {
              yield {
                type: "text-delta",
                text: parsed.message.content,
                index: 0,
              };
            }

            if (parsed.done) {
              if (parsed.eval_count) {
                yield {
                  type: "usage",
                  usage: {
                    inputTokens: parsed.prompt_eval_count || 0,
                    outputTokens: parsed.eval_count || 0,
                  },
                };
              }
              yield { type: "finish", reason: { kind: "stop" } };
              return;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }
  }

  /**
   * Parse Anthropic stream
   * Supports both standard Anthropic format and DashScope format
   * Also handles thinking/reasoning blocks and tool calls
   *
   * CRITICAL: This implementation follows DeepSeek's translate.ts pattern:
   * - If content_block_start has input, it's the COMPLETE arguments
   * - input_json_delta events only occur when there's NO initial input
   * - We should NOT concatenate initial input with deltas
   */
  private async *parseAnthropicStream(
    response: Response,
  ): AsyncIterable<StreamChunk> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let chunkCount = 0;
    let currentEvent = "";
    let inThinkingBlock = false;
    let inToolCallBlock = false;
    let reasoningText = "";
    let textContent = "";
    let toolCallId = "";
    let toolCallName = "";
    let toolCallInitialArgs = ""; // Complete args from content_block_start (if any)
    let toolCallDeltas = ""; // Accumulated deltas from input_json_delta (if any)
    let blockIndex = 0; // Dynamic block index
    let eventCount = 0; // Track total events processed
    let isEmptyInput = false; // Track if current tool call has empty initial input

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // If stream ends mid-tool-call, yield block-end with accumulated args
        if (inToolCallBlock) {
          const finalArgs = toolCallInitialArgs || toolCallDeltas || "{}";
          yield {
            type: "block-end",
            index: blockIndex,
            block: {
              type: "tool-call",
              id: toolCallId,
              name: toolCallName,
              arguments: finalArgs,
            },
          };
          blockIndex++;
        }
        break;
      }

      const text = decoder.decode(value, { stream: true });
      buffer += text;

      // Split by lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmedLine = line.trim();

        // Handle DashScope format: event:type
        if (trimmedLine.startsWith("event:")) {
          currentEvent = trimmedLine.substring(6);
          continue;
        }

        // Handle data: lines
        if (trimmedLine.startsWith("data:")) {
          const data = trimmedLine.substring(5).trim();

          // Skip empty data
          if (!data || data === "[DONE]") {
            if (data === "[DONE]") {
              yield { type: "finish", reason: { kind: "stop" } };
              return;
            }
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            eventCount++;

            // DashScope format: use event type from the event: line
            if (currentEvent) {
              if (currentEvent === "content_block_start") {
                const blockType = parsed.content_block?.type;

                if (blockType === "thinking") {
                  inThinkingBlock = true;
                  reasoningText = "";
                  yield {
                    type: "block-start",
                    index: blockIndex,
                    blockType: "reasoning",
                  };
                } else if (blockType === "text") {
                  textContent = "";
                  yield {
                    type: "block-start",
                    index: blockIndex,
                    blockType: "text",
                  };
                } else if (blockType === "tool_use") {
                  inToolCallBlock = true;
                  toolCallId = parsed.content_block?.id || "";
                  toolCallName = parsed.content_block?.name || "";

                  // CRITICAL FIX for DashScope: Check if input is an EMPTY object
                  // DashScope sends input: {} in content_block_start, then streams args via input_json_delta
                  // Standard Anthropic sends complete input in content_block_start (no deltas follow)
                  const inputObj = parsed.content_block?.input;
                  isEmptyInput =
                    !inputObj ||
                    (typeof inputObj === "object" &&
                      Object.keys(inputObj).length === 0);

                  if (!isEmptyInput) {
                    // Non-empty input in content_block_start = complete arguments (Standard Anthropic)
                    toolCallInitialArgs = JSON.stringify(inputObj);
                    toolCallDeltas = "";
                  } else {
                    // Empty or no input = will receive deltas (DashScope or streaming)
                    toolCallInitialArgs = "";
                    toolCallDeltas = "";
                  }

                  yield {
                    type: "block-start",
                    index: blockIndex,
                    blockType: "tool-call",
                  };

                  // CRITICAL FIX: Only yield initial delta if we have NO non-empty initial input
                  if (isEmptyInput) {
                    yield {
                      type: "tool-call-delta",
                      index: blockIndex,
                      id: toolCallId,
                      name: toolCallName,
                      argumentsDelta: "",
                    };
                  }
                }
              }

              if (currentEvent === "content_block_delta") {
                const delta = parsed.delta;

                // Handle thinking delta
                if (delta?.type === "thinking_delta" && delta.thinking) {
                  reasoningText += delta.thinking;
                  yield {
                    type: "reasoning-delta",
                    text: delta.thinking,
                    index: blockIndex,
                  };
                }

                // Handle text delta
                if (delta?.type === "text_delta" && delta.text) {
                  chunkCount++;
                  textContent += delta.text;
                  yield {
                    type: "text-delta",
                    text: delta.text,
                    index: blockIndex,
                  };
                }

                // Handle tool call input JSON delta
                // CRITICAL FIX: Accumulate deltas if we DON'T have non-empty initial input
                if (delta?.type === "input_json_delta" && delta.partial_json) {
                  if (isEmptyInput) {
                    toolCallDeltas += delta.partial_json;
                    yield {
                      type: "tool-call-delta",
                      index: blockIndex,
                      id: toolCallId,
                      name: toolCallName,
                      argumentsDelta: delta.partial_json,
                    };
                  }
                }
              }

              if (currentEvent === "content_block_stop") {
                if (inThinkingBlock) {
                  inThinkingBlock = false;
                  yield {
                    type: "block-end",
                    index: blockIndex,
                    block: {
                      type: "reasoning",
                      text: reasoningText,
                    },
                  };
                } else if (inToolCallBlock) {
                  inToolCallBlock = false;
                  // Use initial args if present, otherwise use deltas
                  // NEVER concatenate them - that produces invalid JSON
                  const finalArgs =
                    toolCallInitialArgs || toolCallDeltas || "{}";
                  yield {
                    type: "block-end",
                    index: blockIndex,
                    block: {
                      type: "tool-call",
                      id: toolCallId,
                      name: toolCallName,
                      arguments: finalArgs,
                    },
                  };
                } else {
                  yield {
                    type: "block-end",
                    index: blockIndex,
                    block: {
                      type: "text",
                      text: textContent,
                    },
                  };
                }
                blockIndex++;
              }

              if (currentEvent === "message_stop") {
                yield { type: "finish", reason: { kind: "stop" } };
                currentEvent = "";
                return;
              }

              if (currentEvent === "message_delta" && parsed.usage) {
                yield {
                  type: "usage",
                  usage: {
                    inputTokens: 0,
                    outputTokens: parsed.usage.output_tokens || 0,
                  },
                };
              }

              currentEvent = "";
              continue;
            }

            // Standard Anthropic format: type in JSON
            if (parsed.type === "content_block_start") {
              const blockType = parsed.content_block?.type;

              if (blockType === "thinking") {
                inThinkingBlock = true;
                reasoningText = "";
                yield {
                  type: "block-start",
                  index: blockIndex,
                  blockType: "reasoning",
                };
              } else if (blockType === "text") {
                textContent = "";
                yield {
                  type: "block-start",
                  index: blockIndex,
                  blockType: "text",
                };
              } else if (blockType === "tool_use") {
                inToolCallBlock = true;
                toolCallId = parsed.content_block?.id || "";
                toolCallName = parsed.content_block?.name || "";

                // CRITICAL FIX for DashScope: Check if input is an EMPTY object
                const inputObj = parsed.content_block?.input;
                isEmptyInput =
                  !inputObj ||
                  (typeof inputObj === "object" &&
                    Object.keys(inputObj).length === 0);

                if (!isEmptyInput) {
                  // Non-empty input in content_block_start = complete arguments
                  toolCallInitialArgs = JSON.stringify(inputObj);
                  toolCallDeltas = "";
                } else {
                  // Empty or no input = will receive deltas
                  toolCallInitialArgs = "";
                  toolCallDeltas = "";
                }

                yield {
                  type: "block-start",
                  index: blockIndex,
                  blockType: "tool-call",
                };

                // CRITICAL FIX: Only yield initial delta if we have NO non-empty initial input
                if (isEmptyInput) {
                  yield {
                    type: "tool-call-delta",
                    index: blockIndex,
                    id: toolCallId,
                    name: toolCallName,
                    argumentsDelta: "",
                  };
                }
              }
            }

            if (parsed.type === "content_block_delta") {
              const delta = parsed.delta;

              if (delta?.type === "thinking_delta" && delta.thinking) {
                reasoningText += delta.thinking;
                yield {
                  type: "reasoning-delta",
                  text: delta.thinking,
                  index: blockIndex,
                };
              }

              if (delta?.type === "text_delta" && delta.text) {
                chunkCount++;
                textContent += delta.text;
                yield {
                  type: "text-delta",
                  text: delta.text,
                  index: blockIndex,
                };
              }

              // CRITICAL FIX: Accumulate deltas if we DON'T have non-empty initial input
              if (delta?.type === "input_json_delta" && delta.partial_json) {
                if (isEmptyInput) {
                  toolCallDeltas += delta.partial_json;
                  yield {
                    type: "tool-call-delta",
                    index: blockIndex,
                    id: toolCallId,
                    name: toolCallName,
                    argumentsDelta: delta.partial_json,
                  };
                }
              }
            }

            if (parsed.type === "content_block_stop") {
              if (inThinkingBlock) {
                inThinkingBlock = false;
                yield {
                  type: "block-end",
                  index: blockIndex,
                  block: {
                    type: "reasoning",
                    text: reasoningText,
                  },
                };
              } else if (inToolCallBlock) {
                inToolCallBlock = false;
                // Use initial args if present, otherwise use deltas
                const finalArgs = toolCallInitialArgs || toolCallDeltas || "{}";
                yield {
                  type: "block-end",
                  index: blockIndex,
                  block: {
                    type: "tool-call",
                    id: toolCallId,
                    name: toolCallName,
                    arguments: finalArgs,
                  },
                };
              } else {
                yield {
                  type: "block-end",
                  index: blockIndex,
                  block: {
                    type: "text",
                    text: textContent,
                  },
                };
              }
              blockIndex++;
            }

            if (parsed.type === "message_stop") {
              yield { type: "finish", reason: { kind: "stop" } };
              return;
            }

            if (parsed.type === "message_delta" && parsed.usage) {
              yield {
                type: "usage",
                usage: {
                  inputTokens: 0,
                  outputTokens: parsed.usage.output_tokens || 0,
                },
              };
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }
  }
}
