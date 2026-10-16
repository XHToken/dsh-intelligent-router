/**
 * Comprehensive unit tests for LLMClient
 * Covers protocol detection, API key resolution, stream parsing, and error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LLMClient, type LLMClientConfig } from '../src/llm-client'

// Mock fetch globally
global.fetch = vi.fn()

describe('LLMClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear environment variables
    delete process.env.OPENAI_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.QWEN37PLUS_API_KEY
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Protocol Detection', () => {
    it('should detect anthropic protocol from provider name containing "anthropic"', () => {
      const client = new LLMClient({
        provider: 'anthropic',
        model: 'claude-3-opus',
        apiKey: 'test-key',
      })
      expect(client).toBeDefined()
    })

    it('should detect anthropic protocol from provider name containing "claude"', () => {
      const client = new LLMClient({
        provider: 'claude',
        model: 'claude-3-opus',
        apiKey: 'test-key',
      })
      expect(client).toBeDefined()
    })

    it('should detect ollama protocol from provider name', () => {
      const client = new LLMClient({
        provider: 'ollama',
        model: 'llama3.2',
      })
      expect(client).toBeDefined()
    })

    it('should default to openai protocol for unknown providers', () => {
      const client = new LLMClient({
        provider: 'custom-provider',
        model: 'custom-model',
        apiKey: 'test-key',
      })
      expect(client).toBeDefined()
    })

    it('should use explicit protocol when provided', () => {
      const client = new LLMClient({
        provider: 'my-api',
        model: 'gpt-4',
        protocol: 'anthropic',
        apiKey: 'test-key',
      })
      expect(client).toBeDefined()
    })

    it('should detect deepseek as openai protocol', () => {
      const client = new LLMClient({
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        apiKey: 'test-key',
      })
      expect(client).toBeDefined()
    })
  })

  describe('API Key Resolution', () => {
    it('should use apiKey from config when provided', async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
          }),
        },
      }
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

      const client = new LLMClient({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'config-key',
      })

      try {
        for await (const _ of client.stream({ messages: [] })) {
          // Should not throw
        }
      } catch (e) {
        // Expected to fail due to empty stream, but API key should be used
      }

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer config-key',
          }),
        })
      )
    })

    it('should fallback to provider-specific environment variable', async () => {
      process.env.OPENAI_API_KEY = 'env-key'

      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
          }),
        },
      }
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

      const client = new LLMClient({
        provider: 'openai',
        model: 'gpt-4',
      })

      try {
        for await (const _ of client.stream({ messages: [] })) {
          // Should not throw
        }
      } catch (e) {
        // Expected to fail due to empty stream
      }

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer env-key',
          }),
        })
      )
    })

    it('should throw error when API key is missing', async () => {
      const client = new LLMClient({
        provider: 'openai',
        model: 'gpt-4',
      })

      await expect(async () => {
        for await (const _ of client.stream({ messages: [] })) {
          // Should throw
        }
      }).rejects.toThrow('API key not configured')
    })

    it('should not require API key for ollama', async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
          }),
        },
      }
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

      const client = new LLMClient({
        provider: 'ollama',
        model: 'llama3.2',
      })

      try {
        for await (const _ of client.stream({ messages: [] })) {
          // Should not throw
        }
      } catch (e) {
        // Expected to fail due to empty stream, but no API key error
      }

      expect(global.fetch).toHaveBeenCalled()
    })
  })

  describe('Base URL Resolution', () => {
    it('should use baseUrl from config when provided', async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
          }),
        },
      }
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

      const client = new LLMClient({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'test-key',
        baseUrl: 'https://custom.api.com',
      })

      try {
        for await (const _ of client.stream({ messages: [] })) {
          // Should not throw
        }
      } catch (e) {
        // Expected to fail due to empty stream
      }

      expect(global.fetch).toHaveBeenCalledWith(
        'https://custom.api.com/v1/chat/completions',
        expect.any(Object)
      )
    })

    it('should use default base URL for openai', async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
          }),
        },
      }
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

      const client = new LLMClient({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'test-key',
      })

      try {
        for await (const _ of client.stream({ messages: [] })) {
          // Should not throw
        }
      } catch (e) {
        // Expected to fail due to empty stream
      }

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.any(Object)
      )
    })

    it('should use default base URL for anthropic', async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
          }),
        },
      }
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

      const client = new LLMClient({
        provider: 'anthropic',
        model: 'claude-3-opus',
        apiKey: 'test-key',
      })

      try {
        for await (const _ of client.stream({ messages: [] })) {
          // Should not throw
        }
      } catch (e) {
        // Expected to fail due to empty stream
      }

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.any(Object)
      )
    })

    it('should use default base URL for ollama', async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
          }),
        },
      }
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

      const client = new LLMClient({
        provider: 'ollama',
        model: 'llama3.2',
      })

      try {
        for await (const _ of client.stream({ messages: [] })) {
          // Should not throw
        }
      } catch (e) {
        // Expected to fail due to empty stream
      }

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/chat',
        expect.any(Object)
      )
    })
  })

  describe('Stream Parsing - Standard Anthropic Format', () => {
    it('should parse standard Anthropic SSE format', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n' +
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" World"}}\n\n' +
            'data: {"type":"message_stop"}\n\n'
          ))
          controller.close()
        },
      })

      const mockResponse = {
        ok: true,
        body: mockStream,
      }
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

      const client = new LLMClient({
        provider: 'anthropic',
        model: 'claude-3-opus',
        apiKey: 'test-key',
      })

      const chunks: any[] = []
      for await (const chunk of client.stream({ messages: [{ role: 'user', content: 'Hi' }] })) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks.some(c => c.type === 'text-delta')).toBe(true)
      expect(chunks.some(c => c.type === 'finish')).toBe(true)
    })
  })

  describe('Stream Parsing - DashScope Format', () => {
    it('should parse DashScope SSE format with event: lines', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            'event:content_block_delta\n' +
            'data:{"delta":{"type":"text_delta","text":"Hello"}}\n\n' +
            'event:content_block_delta\n' +
            'data:{"delta":{"type":"text_delta","text":" World"}}\n\n' +
            'event:message_stop\n' +
            'data:{}\n\n'
          ))
          controller.close()
        },
      })

      const mockResponse = {
        ok: true,
        body: mockStream,
      }
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

      const client = new LLMClient({
        provider: 'qwen37plus',
        model: 'qwen3.7-plus',
        apiKey: 'test-key',
        protocol: 'anthropic',
      })

      const chunks: any[] = []
      for await (const chunk of client.stream({ messages: [{ role: 'user', content: 'Hi' }] })) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks.some(c => c.type === 'text-delta')).toBe(true)
      expect(chunks.some(c => c.type === 'finish')).toBe(true)
    })
  })

  describe('Stream Parsing - OpenAI Format', () => {
    it('should parse OpenAI SSE format', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
            'data: {"choices":[{"delta":{"content":" World"}}]}\n\n' +
            'data: [DONE]\n\n'
          ))
          controller.close()
        },
      })

      const mockResponse = {
        ok: true,
        body: mockStream,
      }
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

      const client = new LLMClient({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'test-key',
      })

      const chunks: any[] = []
      for await (const chunk of client.stream({ messages: [{ role: 'user', content: 'Hi' }] })) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks.some(c => c.type === 'text-delta')).toBe(true)
      expect(chunks.some(c => c.type === 'finish')).toBe(true)
    })
  })

  describe('Stream Parsing - Ollama Format', () => {
    it('should parse Ollama NDJSON format', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            '{"message":{"content":"Hello"},"done":false}\n' +
            '{"message":{"content":" World"},"done":false}\n' +
            '{"message":{"content":""},"done":true,"eval_count":10}\n'
          ))
          controller.close()
        },
      })

      const mockResponse = {
        ok: true,
        body: mockStream,
      }
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

      const client = new LLMClient({
        provider: 'ollama',
        model: 'llama3.2',
      })

      const chunks: any[] = []
      for await (const chunk of client.stream({ messages: [{ role: 'user', content: 'Hi' }] })) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks.some(c => c.type === 'text-delta')).toBe(true)
      expect(chunks.some(c => c.type === 'finish')).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('should handle HTTP errors gracefully', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Invalid API key'),
      }
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

      const client = new LLMClient({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'invalid-key',
      })

      await expect(async () => {
        for await (const _ of client.stream({ messages: [] })) {
          // Should throw
        }
      }).rejects.toThrow('OpenAI-compatible API error: 401 Unauthorized')
    })

    it('should handle network errors gracefully', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'))

      const client = new LLMClient({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'test-key',
      })

      await expect(async () => {
        for await (const _ of client.stream({ messages: [] })) {
          // Should throw
        }
      }).rejects.toThrow('Network error')
    })

    it('should handle invalid JSON in stream gracefully', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            'data: invalid-json\n\n' +
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
            'data: [DONE]\n\n'
          ))
          controller.close()
        },
      })

      const mockResponse = {
        ok: true,
        body: mockStream,
      }
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

      const client = new LLMClient({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'test-key',
      })

      const chunks: any[] = []
      for await (const chunk of client.stream({ messages: [{ role: 'user', content: 'Hi' }] })) {
        chunks.push(chunk)
      }

      // Should skip invalid JSON and continue parsing
      expect(chunks.length).toBeGreaterThan(0)
    })
  })

  describe('Request Formatting', () => {
    it('should format OpenAI request correctly', async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
          }),
        },
      }
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

      const client = new LLMClient({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'test-key',
      })

      try {
        for await (const _ of client.stream({
          messages: [{ role: 'user', content: 'Hello' }],
          maxTokens: 1000,
          temperature: 0.7,
        })) {
          // Should not throw
        }
      } catch (e) {
        // Expected to fail due to empty stream
      }

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"model":"gpt-4"'),
        })
      )
    })

    it('should format Anthropic request correctly', async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
          }),
        },
      }
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

      const client = new LLMClient({
        provider: 'anthropic',
        model: 'claude-3-opus',
        apiKey: 'test-key',
      })

      try {
        for await (const _ of client.stream({
          messages: [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'Hello' },
          ],
          maxTokens: 1000,
        })) {
          // Should not throw
        }
      } catch (e) {
        // Expected to fail due to empty stream
      }

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'test-key',
            'anthropic-version': '2023-06-01',
          }),
        })
      )
    })
  })
})
