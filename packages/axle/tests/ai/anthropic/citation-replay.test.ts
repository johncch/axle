import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, test } from "vitest";
import type { AxleMessage, Citation } from "../../../src/messages/message.js";
import {
  convertToProviderMessages,
  normalizeAnthropicCitation,
} from "../../../src/providers/anthropic/utils.js";

async function replayedTextBlock(citations: Citation[] | undefined) {
  const messages: AxleMessage[] = [
    {
      role: "assistant",
      id: "msg_1",
      content: [{ type: "text", text: "Axle is a runtime.", ...(citations ? { citations } : {}) }],
    },
  ];
  const [converted] = await convertToProviderMessages(messages);
  return (converted.content as Anthropic.ContentBlockParam[])[0];
}

const received: Record<string, Anthropic.TextCitation> = {
  web_search_result_location: {
    type: "web_search_result_location",
    cited_text: "Axle is a runtime",
    encrypted_index: "enc_idx",
    title: "Axle",
    url: "https://example.com/axle",
  },
  char_location: {
    type: "char_location",
    cited_text: "Axle is a runtime",
    document_index: 2,
    document_title: "Axle notes",
    start_char_index: 10,
    end_char_index: 27,
    file_id: null,
  },
  page_location: {
    type: "page_location",
    cited_text: "Axle is a runtime",
    document_index: 0,
    document_title: null,
    start_page_number: 3,
    end_page_number: 4,
    file_id: null,
  },
  content_block_location: {
    type: "content_block_location",
    cited_text: "Axle is a runtime",
    document_index: 1,
    document_title: "Axle notes",
    start_block_index: 0,
    end_block_index: 1,
    file_id: null,
  },
  search_result_location: {
    type: "search_result_location",
    cited_text: "Axle is a runtime",
    search_result_index: 4,
    source: "https://example.com/axle",
    title: "Axle",
    start_block_index: 0,
    end_block_index: 2,
  },
};

describe("Anthropic citation replay", () => {
  test.each(Object.keys(received))("sends a %s citation back as received", async (type) => {
    // Request-side citation shapes have no `file_id`; responses do.
    const expected: Record<string, unknown> = { ...received[type] };
    delete expected.file_id;

    const block = await replayedTextBlock([normalizeAnthropicCitation(received[type])]);

    expect(block).toEqual({ type: "text", text: "Axle is a runtime.", citations: [expected] });
  });

  test("keeps every citation of a text part, in order", async () => {
    const block = await replayedTextBlock([
      normalizeAnthropicCitation(received.web_search_result_location),
      normalizeAnthropicCitation(received.char_location),
    ]);

    expect(block).toMatchObject({
      citations: [{ type: "web_search_result_location" }, { type: "char_location" }],
    });
  });

  test("sends text without citations as a bare text block", async () => {
    expect(await replayedTextBlock(undefined)).toEqual({
      type: "text",
      text: "Axle is a runtime.",
    });
  });

  test("leaves out citations that another provider produced", async () => {
    const openAICitation: Citation = {
      source: { type: "web", title: "Axle", url: "https://example.com/axle" },
      outputSpan: { start: 0, end: 4 },
      providerMetadata: { type: "url_citation" },
    };

    expect(await replayedTextBlock([openAICitation])).toEqual({
      type: "text",
      text: "Axle is a runtime.",
    });
  });
});
