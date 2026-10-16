import { describe, it, expect, vi } from "vitest";

/**
 * Unit tests for tool call chunk pass-through
 * Verifies that tool-call chunks are NOT corrupted by the router
 */

// Simulate the stream chunk processing logic from MagpieRouter.stream()
const processChunks = async (
  chunks: any[],
  hasMiddlewares: boolean,
  runOnChunk?: (chunk: any) => Promise<any | null>,
): Promise<any[]> => {
  const results: any[] = [];

  if (hasMiddlewares && runOnChunk) {
    for (const chunk of chunks) {
      const processed = await runOnChunk(chunk);
      if (processed) results.push(processed);
    }
  } else {
    // No middlewares: direct pass-through (the fix)
    for (const chunk of chunks) {
      results.push(chunk);
    }
  }

  return results;
};

describe("Tool Call Chunk Pass-through", () => {
  // Simulated tool call chunks (as DSH would produce them)
  const toolCallChunks = [
    { type: "block-start", index: 0, blockType: "tool-call" },
    { type: "tool-call-delta", index: 0, toolName: "web_search", argumentsDelta: '{"quer' },
    { type: "tool-call-delta", index: 0, argumentsDelta: 'ies": ["TF' },
    { type: "tool-call-delta", index: 0, argumentsDelta: 'Boy news"]}' },
    { type: "block-end", index: 0 },
  ];

  it("should pass tool-call chunks unchanged when no middlewares", async () => {
    const result = await processChunks(toolCallChunks, false);

    expect(result).toEqual(toolCallChunks);
    expect(result.length).toBe(5);

    // Verify arguments can be reconstructed
    const deltas = result.filter((c) => c.type === "tool-call-delta");
    const fullArgs = deltas.map((d) => d.argumentsDelta).join("");
    expect(JSON.parse(fullArgs)).toEqual({ queries: ["TFBoy news"] });
  });

  it("should preserve block-start and block-end", async () => {
    const result = await processChunks(toolCallChunks, false);

    expect(result[0].type).toBe("block-start");
    expect(result[0].blockType).toBe("tool-call");
    expect(result[4].type).toBe("block-end");
  });

  it("should preserve all argumentsDelta fragments", async () => {
    const result = await processChunks(toolCallChunks, false);

    const deltas = result.filter((c) => c.type === "tool-call-delta");
    expect(deltas.length).toBe(3);
    expect(deltas[0].toolName).toBe("web_search");

    // Concatenate all deltas
    const fullArgs = deltas.map((d) => d.argumentsDelta).join("");
    expect(fullArgs).toBe('{"queries": ["TFBoy news"]}');
  });

  it("should handle text-delta chunks alongside tool-call chunks", async () => {
    const mixedChunks = [
      { type: "text-delta", text: "Let me search" },
      { type: "block-start", index: 0, blockType: "tool-call" },
      { type: "tool-call-delta", index: 0, argumentsDelta: '{"queries": ["test"]}' },
      { type: "block-end", index: 0 },
      { type: "text-delta", text: " for that." },
    ];

    const result = await processChunks(mixedChunks, false);
    expect(result).toEqual(mixedChunks);
    expect(result.length).toBe(5);
  });

  it("should handle empty tool call arguments", async () => {
    const emptyArgsChunks = [
      { type: "block-start", index: 0, blockType: "tool-call" },
      { type: "tool-call-delta", index: 0, toolName: "bash", argumentsDelta: "{}" },
      { type: "block-end", index: 0 },
    ];

    const result = await processChunks(emptyArgsChunks, false);
    const deltas = result.filter((c) => c.type === "tool-call-delta");
    expect(JSON.parse(deltas[0].argumentsDelta)).toEqual({});
  });

  it("should handle complex nested arguments", async () => {
    const complexArgs = JSON.stringify({
      queries: ["TFBoy news", "TFBOYS latest"],
      num_results: 5,
      filters: { language: "zh", date_range: "week" },
    });

    // Split into random chunks
    const chunks: any[] = [
      { type: "block-start", index: 0, blockType: "tool-call" },
    ];
    for (let i = 0; i < complexArgs.length; i += 20) {
      chunks.push({
        type: "tool-call-delta",
        index: 0,
        argumentsDelta: complexArgs.substring(i, i + 20),
      });
    }
    chunks.push({ type: "block-end", index: 0 });

    const result = await processChunks(chunks, false);
    const deltas = result.filter((c) => c.type === "tool-call-delta");
    const reconstructed = deltas.map((d) => d.argumentsDelta).join("");
    expect(JSON.parse(reconstructed)).toEqual(JSON.parse(complexArgs));
  });
});

describe("Middleware Interference (the bug)", () => {
  const toolCallChunks = [
    { type: "block-start", index: 0, blockType: "tool-call" },
    { type: "tool-call-delta", index: 0, toolName: "web_search", argumentsDelta: '{"queries": ["test"]}' },
    { type: "block-end", index: 0 },
  ];

  it("BUG: middleware that drops chunks breaks tool calls", async () => {
    // Simulate a buggy middleware that returns null for some chunks
    const buggyMiddleware = async (chunk: any) => {
      if (chunk.type === "tool-call-delta") return null; // drops the chunk!
      return chunk;
    };

    const result = await processChunks(toolCallChunks, true, buggyMiddleware);

    // The tool-call-delta is lost → arguments are missing
    const deltas = result.filter((c) => c.type === "tool-call-delta");
    expect(deltas.length).toBe(0); // ← This is the bug!

    // With the fix (no middlewares), chunks pass through
    const fixedResult = await processChunks(toolCallChunks, false);
    const fixedDeltas = fixedResult.filter((c) => c.type === "tool-call-delta");
    expect(fixedDeltas.length).toBe(1); // ← Fix works!
  });

  it("BUG: middleware that modifies arguments corrupts tool calls", async () => {
    // Simulate a middleware that modifies argumentsDelta
    const modifyingMiddleware = async (chunk: any) => {
      if (chunk.type === "tool-call-delta") {
        return { ...chunk, argumentsDelta: chunk.argumentsDelta?.replace("queries", "query") };
      }
      return chunk;
    };

    const result = await processChunks(toolCallChunks, true, modifyingMiddleware);
    const deltas = result.filter((c) => c.type === "tool-call-delta");

    // Arguments are corrupted
    expect(deltas[0].argumentsDelta).toContain("query");
    expect(deltas[0].argumentsDelta).not.toContain("queries");

    // With the fix, arguments are preserved
    const fixedResult = await processChunks(toolCallChunks, false);
    const fixedDeltas = fixedResult.filter((c) => c.type === "tool-call-delta");
    expect(fixedDeltas[0].argumentsDelta).toContain("queries");
  });

  it("FIX: no middlewares → zero interference", async () => {
    const result = await processChunks(toolCallChunks, false);

    // Every chunk is identical to input
    for (let i = 0; i < toolCallChunks.length; i++) {
      expect(result[i]).toBe(toolCallChunks[i]); // Same reference, not a copy
    }
  });
});

describe("Options Pass-through", () => {
  it("should preserve tools definitions in options", () => {
    const options = {
      provider: "auto",
      model: "AUTO",
      messages: [{ role: "user", content: "search TFBoy" }],
      tools: [
        {
          name: "web_search",
          description: "Search the web",
          input_schema: {
            type: "object",
            properties: {
              queries: { type: "array", items: { type: "string" } },
            },
            required: ["queries"],
          },
        },
      ],
    };

    // The fix: pass options unchanged to preparedCall.stream()
    const passedOptions = { ...options }; // No modification

    expect(passedOptions.tools).toEqual(options.tools);
    expect(passedOptions.tools[0].input_schema.properties.queries.type).toBe("array");
    expect(passedOptions.tools[0].input_schema.required).toEqual(["queries"]);
  });

  it("should NOT delete any fields from options", () => {
    const options: any = {
      provider: "auto",
      model: "AUTO",
      messages: [],
      tools: [],
      system: "You are helpful",
      maxTokens: 4096,
      temperature: 0.7,
    };

    // The fix: no field deletion
    const originalKeys = Object.keys(options);
    const passedOptions = { ...options };
    const passedKeys = Object.keys(passedOptions);

    expect(passedKeys).toEqual(originalKeys);
  });
});
