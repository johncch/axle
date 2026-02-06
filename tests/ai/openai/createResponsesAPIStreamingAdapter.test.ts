import { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, expect, test } from "vitest";
import { createResponsesAPIStreamingAdapter } from "../../../src/providers/openai/createResponsesAPIStreamingAdapter.js";

describe("createResponsesAPIStreamingAdapter", () => {
  describe("basic streaming events", () => {
    test("should handle response.created event", () => {
      const adapter = createResponsesAPIStreamingAdapter();
      const event: ResponseStreamEvent = {
        type: "response.created",
        response: {
          id: "resp_123",
          model: "gpt-4o",
          status: "in_progress",
          object: "response",
          created_at: 1234567890,
          instructions: "",
          metadata: {},
        },
      } as ResponseStreamEvent;

      const chunks = adapter.handleEvent(event);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("start");
      expect(chunks[0].id).toBe("resp_123");
      if (chunks[0].type === "start") {
        expect(chunks[0].data.model).toBe("gpt-4o");
      }
    });

    test("should handle response.output_text.delta event", () => {
      const adapter = createResponsesAPIStreamingAdapter();

      // First create the response
      adapter.handleEvent({
        type: "response.created",
        response: {
          id: "resp_123",
          model: "gpt-4o",
          status: "in_progress",
          object: "response",
          created_at: 1234567890,
          instructions: "",
          metadata: {},
        },
      } as ResponseStreamEvent);

      const event: ResponseStreamEvent = {
        type: "response.output_text.delta",
        delta: "Hello",
        item_id: "item_123",
        output_index: 0,
        content_index: 0,
        sequence_number: 1,
      } as ResponseStreamEvent;

      const chunks = adapter.handleEvent(event);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("text");
      if (chunks[0].type === "text") {
        expect(chunks[0].data.text).toBe("Hello");
        expect(chunks[0].data.index).toBe(0);
      }
    });

    test("should handle response.completed event", () => {
      const adapter = createResponsesAPIStreamingAdapter();
      const event: ResponseStreamEvent = {
        type: "response.completed",
        response: {
          id: "resp_123",
          model: "gpt-4o",
          status: "completed",
          object: "response",
          created_at: 1234567890,
          instructions: "",
          metadata: {},
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            total_tokens: 150,
          },
        },
      } as ResponseStreamEvent;

      const chunks = adapter.handleEvent(event);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("complete");
      if (chunks[0].type === "complete") {
        expect(chunks[0].data.usage.in).toBe(100);
        expect(chunks[0].data.usage.out).toBe(50);
      }
    });

    test("should handle response.failed event", () => {
      const adapter = createResponsesAPIStreamingAdapter();
      const event: ResponseStreamEvent = {
        type: "response.failed",
        response: {
          id: "resp_123",
          model: "gpt-4o",
          status: "failed",
          object: "response",
          created_at: 1234567890,
          instructions: "",
          metadata: {},
        },
      } as ResponseStreamEvent;

      const chunks = adapter.handleEvent(event);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("error");
      if (chunks[0].type === "error") {
        expect(chunks[0].data.type).toBe("RESPONSES_API_ERROR");
      }
    });
  });

  describe("reasoning events", () => {
    test("should handle response.output_item.added with reasoning type", () => {
      const adapter = createResponsesAPIStreamingAdapter();
      const event: ResponseStreamEvent = {
        type: "response.output_item.added",
        sequence_number: 2,
        output_index: 0,
        item: {
          id: "rs_0245d29486a558cc00690e48675edc81968d9d8ffbb51bebfc",
          type: "reasoning",
          summary: [],
        },
      } as ResponseStreamEvent;

      const chunks = adapter.handleEvent(event);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("thinking-start");
      if (chunks[0].type === "thinking-start") {
        expect(chunks[0].data.index).toBe(1);
        expect(chunks[0].data.redacted).toBeUndefined();
      }
    });

    test("should handle response.reasoning_text.delta event", () => {
      const adapter = createResponsesAPIStreamingAdapter();

      // First add the reasoning item
      adapter.handleEvent({
        type: "response.output_item.added",
        sequence_number: 2,
        output_index: 0,
        item: {
          id: "rs_123",
          type: "reasoning",
          summary: [],
        },
      } as ResponseStreamEvent);

      const event: ResponseStreamEvent = {
        type: "response.reasoning_text.delta",
        delta: "Let me think about this...",
        item_id: "rs_123",
        output_index: 0,
        content_index: 0,
        sequence_number: 3,
      } as ResponseStreamEvent;

      const chunks = adapter.handleEvent(event);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("thinking-delta");
      if (chunks[0].type === "thinking-delta") {
        expect(chunks[0].data.text).toBe("Let me think about this...");
        expect(chunks[0].data.index).toBe(1);
      }
    });

    test("should handle response.output_item.done with reasoning type", () => {
      const adapter = createResponsesAPIStreamingAdapter();

      // First add the reasoning item
      adapter.handleEvent({
        type: "response.output_item.added",
        sequence_number: 2,
        output_index: 0,
        item: {
          id: "rs_123",
          type: "reasoning",
          summary: [],
        },
      } as ResponseStreamEvent);

      const event: ResponseStreamEvent = {
        type: "response.output_item.done",
        sequence_number: 4,
        output_index: 0,
        item: {
          id: "rs_123",
          type: "reasoning",
          summary: [],
        },
      } as ResponseStreamEvent;

      const chunks = adapter.handleEvent(event);

      // This event doesn't produce any chunks, just cleanup
      expect(chunks).toHaveLength(0);
    });

    test("should handle multiple reasoning deltas", () => {
      const adapter = createResponsesAPIStreamingAdapter();

      // Add the reasoning item
      adapter.handleEvent({
        type: "response.output_item.added",
        sequence_number: 2,
        output_index: 0,
        item: {
          id: "rs_123",
          type: "reasoning",
          summary: [],
        },
      } as ResponseStreamEvent);

      // Send multiple deltas
      const chunks1 = adapter.handleEvent({
        type: "response.reasoning_text.delta",
        delta: "First, ",
        item_id: "rs_123",
        output_index: 0,
        content_index: 0,
        sequence_number: 3,
      } as ResponseStreamEvent);

      const chunks2 = adapter.handleEvent({
        type: "response.reasoning_text.delta",
        delta: "I need to analyze ",
        item_id: "rs_123",
        output_index: 0,
        content_index: 0,
        sequence_number: 4,
      } as ResponseStreamEvent);

      const chunks3 = adapter.handleEvent({
        type: "response.reasoning_text.delta",
        delta: "the problem.",
        item_id: "rs_123",
        output_index: 0,
        content_index: 0,
        sequence_number: 5,
      } as ResponseStreamEvent);

      if (chunks1[0].type === "thinking-delta") {
        expect(chunks1[0].data.text).toBe("First, ");
        expect(chunks1[0].data.index).toBe(1);
      }
      if (chunks2[0].type === "thinking-delta") {
        expect(chunks2[0].data.text).toBe("I need to analyze ");
        expect(chunks2[0].data.index).toBe(1);
      }
      if (chunks3[0].type === "thinking-delta") {
        expect(chunks3[0].data.text).toBe("the problem.");
        expect(chunks3[0].data.index).toBe(1);
      }
    });

    test("should handle response.reasoning_summary_text.delta event", () => {
      const adapter = createResponsesAPIStreamingAdapter();

      // First add the reasoning item
      adapter.handleEvent({
        type: "response.output_item.added",
        sequence_number: 2,
        output_index: 0,
        item: {
          id: "rs_123",
          type: "reasoning",
          summary: [],
        },
      } as ResponseStreamEvent);

      const event: ResponseStreamEvent = {
        type: "response.reasoning_summary_text.delta",
        delta: "This is the summary reasoning...",
        item_id: "rs_123",
        output_index: 0,
        content_index: 0,
        summary_index: 0,
        sequence_number: 3,
      } as ResponseStreamEvent;

      const chunks = adapter.handleEvent(event);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("thinking-delta");
      if (chunks[0].type === "thinking-delta") {
        expect(chunks[0].data.text).toBe("This is the summary reasoning...");
        expect(chunks[0].data.index).toBe(1);
      }
    });
  });

  describe("function call events", () => {
    test("should handle response.function_call_arguments.delta event", () => {
      const adapter = createResponsesAPIStreamingAdapter();
      const event: ResponseStreamEvent = {
        type: "response.function_call_arguments.delta",
        delta: '{"query": "',
        item_id: "call_123",
        output_index: 0,
        sequence_number: 1,
      } as ResponseStreamEvent;

      const chunks = adapter.handleEvent(event);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("tool-call-start");
      if (chunks[0].type === "tool-call-start") {
        expect(chunks[0].data.id).toBe("call_123");
        expect(chunks[0].data.index).toBe(1);
      }
    });

    test("should handle response.function_call_arguments.done event", () => {
      const adapter = createResponsesAPIStreamingAdapter();

      // Start the function call
      adapter.handleEvent({
        type: "response.function_call_arguments.delta",
        delta: '{"query": "',
        item_id: "call_123",
        output_index: 0,
        sequence_number: 1,
      } as ResponseStreamEvent);

      const event: ResponseStreamEvent = {
        type: "response.function_call_arguments.done",
        name: "search",
        arguments: '{"query": "test"}',
        item_id: "call_123",
        output_index: 0,
        sequence_number: 2,
      } as ResponseStreamEvent;

      const chunks = adapter.handleEvent(event);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("tool-call-complete");
      if (chunks[0].type === "tool-call-complete") {
        expect(chunks[0].data.name).toBe("search");
        expect(chunks[0].data.arguments).toEqual({ query: "test" });
        expect(chunks[0].data.id).toBe("call_123");
      }
    });
  });

  describe("mixed events", () => {
    test("should handle reasoning followed by text output", () => {
      const adapter = createResponsesAPIStreamingAdapter();

      // Create response
      const chunks1 = adapter.handleEvent({
        type: "response.created",
        response: {
          id: "resp_123",
          model: "o4-mini",
          status: "in_progress",
          object: "response",
          created_at: 1234567890,
          instructions: "",
          metadata: {},
        },
      } as ResponseStreamEvent);

      // Add reasoning item
      const chunks2 = adapter.handleEvent({
        type: "response.output_item.added",
        sequence_number: 2,
        output_index: 0,
        item: {
          id: "rs_123",
          type: "reasoning",
          summary: [],
        },
      } as ResponseStreamEvent);

      // Reasoning delta
      const chunks3 = adapter.handleEvent({
        type: "response.reasoning_text.delta",
        delta: "Thinking...",
        item_id: "rs_123",
        output_index: 0,
        content_index: 0,
        sequence_number: 3,
      } as ResponseStreamEvent);

      // Reasoning done
      const chunks4 = adapter.handleEvent({
        type: "response.output_item.done",
        sequence_number: 4,
        output_index: 0,
        item: {
          id: "rs_123",
          type: "reasoning",
          summary: [],
        },
      } as ResponseStreamEvent);

      // Text output
      const chunks5 = adapter.handleEvent({
        type: "response.output_text.delta",
        delta: "Here is my response",
        item_id: "item_123",
        output_index: 1,
        content_index: 0,
        sequence_number: 5,
      } as ResponseStreamEvent);

      expect(chunks1[0].type).toBe("start");
      expect(chunks2[0].type).toBe("thinking-start");
      expect(chunks3[0].type).toBe("thinking-delta");
      if (chunks3[0].type === "thinking-delta") {
        expect(chunks3[0].data.text).toBe("Thinking...");
      }
      expect(chunks4).toHaveLength(0);
      expect(chunks5[0].type).toBe("text");
      if (chunks5[0].type === "text") {
        expect(chunks5[0].data.text).toBe("Here is my response");
      }
    });
  });
});
