import { describe, it, expect } from "vitest";
import {
  responsesInputToMessages,
  responsesToChatCompletions,
  chatCompletionsToResponses,
} from "../src/server/proxy.js";

describe("proxy protocol translation", () => {
  describe("responsesInputToMessages", () => {
    it("converts user message", () => {
      const msgs = responsesInputToMessages([
        { role: "user", content: "hello" },
      ]);
      expect(msgs).toEqual([{ role: "user", content: "hello" }]);
    });

    it("prepends system instructions", () => {
      const msgs = responsesInputToMessages(
        [{ role: "user", content: "hi" }],
        "You are helpful",
      );
      expect(msgs[0]).toEqual({ role: "system", content: "You are helpful" });
      expect(msgs[1]).toEqual({ role: "user", content: "hi" });
    });

    it("converts developer role to system", () => {
      const msgs = responsesInputToMessages([
        { role: "developer", content: "be concise" },
      ]);
      expect(msgs[0].role).toBe("system");
    });

    it("converts assistant message", () => {
      const msgs = responsesInputToMessages([
        { role: "assistant", content: "sure" },
      ]);
      expect(msgs).toEqual([{ role: "assistant", content: "sure" }]);
    });

    it("converts tool result with output field", () => {
      const msgs = responsesInputToMessages([
        { role: "tool", output: "result text", call_id: "call-1" },
      ]);
      expect(msgs[0]).toEqual({
        role: "tool",
        content: "result text",
        tool_call_id: "call-1",
      });
    });

    it("converts function_call entry", () => {
      const msgs = responsesInputToMessages([
        {
          type: "function_call",
          call_id: "fc-1",
          name: "read_file",
          arguments: '{"path":"/foo"}',
        },
      ]);
      expect(msgs[0]).toEqual({
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "fc-1",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"/foo"}' },
          },
        ],
      });
    });

    it("handles array content (multipart)", () => {
      const msgs = responsesInputToMessages([
        {
          role: "user",
          content: [
            { type: "input_text", text: "part1" },
            { type: "text", text: "part2" },
          ],
        },
      ]);
      expect(msgs[0].content).toBe("part1part2");
    });
  });

  describe("responsesToChatCompletions", () => {
    it("converts basic request", () => {
      const result = responsesToChatCompletions({
        model: "gpt-4",
        input: [{ role: "user", content: "hello" }],
        stream: true,
      });
      expect(result.model).toBe("gpt-4");
      expect(result.stream).toBe(true);
      expect(result.messages).toEqual([{ role: "user", content: "hello" }]);
    });

    it("maps max_output_tokens to max_tokens", () => {
      const result = responsesToChatCompletions({
        model: "gpt-4",
        input: [],
        max_output_tokens: 1000,
      });
      expect(result.max_tokens).toBe(1000);
    });

    it("filters tools to function type only", () => {
      const result = responsesToChatCompletions({
        model: "gpt-4",
        input: [],
        tools: [
          { type: "function", name: "search", description: "Search", parameters: {} },
          { type: "web_search", name: "web" },
        ],
      });
      expect(result.tools).toHaveLength(1);
      expect((result.tools![0] as Record<string, unknown>).type).toBe("function");
    });
  });

  describe("chatCompletionsToResponses", () => {
    it("converts text response", () => {
      const result = chatCompletionsToResponses({
        id: "resp-1",
        choices: [
          {
            message: { content: "Hello there" },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      });
      expect(result.id).toBe("resp-1");
      expect(result.output).toEqual([
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Hello there" }],
        },
      ]);
      expect(result.usage).toEqual({
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      });
    });

    it("converts tool call response", () => {
      const result = chatCompletionsToResponses({
        id: "resp-2",
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "tc-1",
                  function: { name: "read", arguments: '{"f":"x"}' },
                },
              ],
            },
          },
        ],
      });
      const output = result.output as Array<Record<string, unknown>>;
      expect(output).toHaveLength(1);
      expect(output[0].type).toBe("function_call");
      expect(output[0].name).toBe("read");
      expect(output[0].call_id).toBe("tc-1");
    });

    it("handles empty choices", () => {
      const result = chatCompletionsToResponses({ id: "r", choices: [] });
      expect(result.output).toEqual([]);
    });
  });
});
