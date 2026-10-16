/**
 * Middleware system for request/response interception
 * Allows custom processing logic before and after LLM calls
 */

import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";

export interface MiddlewareContext {
  /** Request options */
  options: GenerateOptions;
  /** Route group being used */
  groupId: string;
  /** Selected member */
  member: { provider: string; model: string };
  /** Shared state between middleware hooks */
  state: Map<string, any>;
  /** Abort the request */
  abort: (reason: string) => never;
}

export interface Middleware {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Enable/disable */
  enabled: boolean;
  /** Called before request */
  onRequest?: (ctx: MiddlewareContext) => Promise<GenerateOptions | void>;
  /** Called for each stream chunk */
  onChunk?: (
    chunk: StreamChunk,
    ctx: MiddlewareContext,
  ) => Promise<StreamChunk | null | void>;
  /** Called after request completes */
  onComplete?: (ctx: MiddlewareContext) => Promise<void>;
  /** Called on error */
  onError?: (error: Error, ctx: MiddlewareContext) => Promise<void>;
}

export class MiddlewareManager {
  private middlewares: Middleware[] = [];

  /**
   * Register a middleware
   */
  register(middleware: Middleware): void {
    try {
      if (!middleware || !middleware.id) {
        console.error("[MiddlewareManager] Invalid middleware:", middleware);
        return;
      }

      const middlewares = this.middlewares || [];
      if (middlewares.some((m) => m?.id === middleware.id)) {
        throw new Error(`Middleware ${middleware.id} already registered`);
      }
      this.middlewares = [...middlewares, middleware];
    } catch (error) {
      console.error("[MiddlewareManager] Error registering middleware:", error);
    }
  }

  /**
   * Unregister a middleware
   */
  unregister(id: string): void {
    try {
      const middlewares = this.middlewares || [];
      this.middlewares = middlewares.filter((m) => m?.id !== id);
    } catch (error) {
      console.error(
        "[MiddlewareManager] Error unregistering middleware:",
        error,
      );
    }
  }

  /**
   * Get all middlewares
   */
  getAll(): Middleware[] {
    return [...(this.middlewares || [])];
  }

  /**
   * Enable/disable a middleware
   */
  setEnabled(id: string, enabled: boolean): void {
    try {
      const middlewares = this.middlewares || [];
      const middleware = middlewares.find((m) => m?.id === id);
      if (middleware) {
        middleware.enabled = enabled;
      }
    } catch (error) {
      console.error("[MiddlewareManager] Error setting enabled:", error);
    }
  }

  /**
   * Run onRequest hooks
   */
  async runOnRequest(
    options: GenerateOptions,
    groupId: string,
    member: { provider: string; model: string },
  ): Promise<GenerateOptions> {
    try {
      const ctx: MiddlewareContext = {
        options,
        groupId,
        member,
        state: new Map(),
        abort: (reason: string) => {
          throw new Error(`Middleware aborted: ${reason}`);
        },
      };

      let currentOptions = options;
      const middlewares = this.middlewares || [];

      for (const middleware of middlewares.filter(
        (m) => m?.enabled && m?.onRequest,
      )) {
        try {
          const result = await middleware.onRequest!(ctx);
          if (result) {
            currentOptions = result;
            ctx.options = result;
          }
        } catch (error) {
          console.error(
            `[Middleware:${middleware.id}] onRequest failed:`,
            error,
          );
          // Continue with other middlewares
        }
      }

      return currentOptions;
    } catch (error) {
      console.error("[MiddlewareManager] Error in runOnRequest:", error);
      return options;
    }
  }

  /**
   * Run onChunk hooks
   */
  async runOnChunk(
    chunk: StreamChunk,
    ctx: MiddlewareContext,
  ): Promise<StreamChunk | null> {
    try {
      let currentChunk: StreamChunk | null = chunk;
      const middlewares = this.middlewares || [];

      for (const middleware of middlewares.filter(
        (m) => m?.enabled && m?.onChunk,
      )) {
        if (!currentChunk) break;

        try {
          const result = await middleware.onChunk!(currentChunk, ctx);
          if (result === null) {
            currentChunk = null;
          } else if (result) {
            currentChunk = result;
          }
        } catch (error) {
          console.error(`[Middleware:${middleware.id}] onChunk failed:`, error);
          // Continue with original chunk
        }
      }

      return currentChunk;
    } catch (error) {
      console.error("[MiddlewareManager] Error in runOnChunk:", error);
      return chunk;
    }
  }

  /**
   * Run onComplete hooks
   */
  async runOnComplete(ctx: MiddlewareContext): Promise<void> {
    try {
      const middlewares = this.middlewares || [];
      for (const middleware of middlewares.filter(
        (m) => m?.enabled && m?.onComplete,
      )) {
        try {
          await middleware.onComplete!(ctx);
        } catch (error) {
          console.error(
            `[Middleware:${middleware.id}] onComplete failed:`,
            error,
          );
        }
      }
    } catch (error) {
      console.error("[MiddlewareManager] Error in runOnComplete:", error);
    }
  }

  /**
   * Run onError hooks
   */
  async runOnError(error: Error, ctx: MiddlewareContext): Promise<void> {
    try {
      const middlewares = this.middlewares || [];
      for (const middleware of middlewares.filter(
        (m) => m?.enabled && m?.onError,
      )) {
        try {
          await middleware.onError!(error, ctx);
        } catch (err) {
          console.error(`[Middleware:${middleware.id}] onError failed:`, err);
        }
      }
    } catch (error) {
      console.error("[MiddlewareManager] Error in runOnError:", error);
    }
  }

  /**
   * Clear all middlewares
   */
  clear(): void {
    this.middlewares = [];
  }
}

/**
 * Built-in middleware: Logging
 */
export const loggingMiddleware: Middleware = {
  id: "logging",
  name: "Request Logging",
  enabled: true,
  onRequest: async (ctx) => {
    console.log(
      `[Middleware:logging] Request to ${ctx.member.provider}/${ctx.member.model}`,
    );
  },
  onComplete: async (ctx) => {
    console.log(`[Middleware:logging] Request completed`);
  },
  onError: async (error, ctx) => {
    console.error(`[Middleware:logging] Request failed:`, error.message);
  },
};

/**
 * Built-in middleware: Request timing
 */
export const timingMiddleware: Middleware = {
  id: "timing",
  name: "Request Timing",
  enabled: true,
  onRequest: async (ctx) => {
    ctx.state.set("startTime", Date.now());
  },
  onComplete: async (ctx) => {
    const startTime = ctx.state.get("startTime");
    if (startTime) {
      const duration = Date.now() - startTime;
      console.log(`[Middleware:timing] Request took ${duration}ms`);
    }
  },
};

/**
 * Built-in middleware: Content filter
 */
export const contentFilterMiddleware = (keywords: string[]): Middleware => ({
  id: "content-filter",
  name: "Content Filter",
  enabled: true,
  onRequest: async (ctx) => {
    const lastMessage = ctx.options.messages?.[ctx.options.messages.length - 1];
    if (lastMessage?.role === "user") {
      const text =
        lastMessage.content
          ?.filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join(" ") || "";

      const hasBlocked = (keywords || []).some((kw) => {
        // Defensive check for kw and text
        if (typeof kw !== "string" || !kw) return false;
        if (typeof text !== "string") return false;
        return text.toLowerCase().includes(kw.toLowerCase());
      });
      if (hasBlocked) {
        ctx.abort("Content contains blocked keywords");
      }
    }
  },
});
