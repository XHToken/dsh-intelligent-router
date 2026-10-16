// Type declarations for DSH peer dependencies

declare module "@cordis/core" {
  export interface Context {
    llm?: any;
    [key: string]: any;
  }
}

declare module "@deepseek-ai/dsh-llm" {
  export interface StreamChunk {
    type: string;
    [key: string]: any;
  }

  export interface GenerateOptions {
    messages?: any[];
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    stop?: string[];
    signal?: AbortSignal;
    tools?: any[];
    /** Session id stamped by the DSH loop; used for Stays cache affinity. */
    sessionId?: string;
    [key: string]: any;
  }

  export interface LlmAdapter {
    listModels(provider?: string): Promise<any[]>;
    resolveModel(provider: string, model: string): Promise<any>;
    prepareCall(
      provider: string,
      model: string,
      signal?: AbortSignal,
    ): Promise<any>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
  }
}

declare module "@deepseek-ai/cordis" {
  export interface Context {
    effect: (fn: () => void, name?: string) => void;
    slots: {
      register: (slot: string, options: any, component: any) => () => void;
    };
    [key: string]: any;
  }
}

declare module "@deepseek-ai/dsh-client-locale/client" {
  export function t(key: string): string;
  export function useLocale(): any;
}

declare module "@deepseek-ai/dsh-client-ui-settings/client" {
  export function useSettings(): any;
}

declare module "@deepseek-ai/dsh-client-ui-slots" {
  export interface Slots {
    register: (slot: string, options: any, component: any) => () => void;
  }
}
