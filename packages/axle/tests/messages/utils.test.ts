import { describe, expect, test } from "vitest";
import type { ContentPart } from "../../src/messages/message.js";
import { getCitations } from "../../src/messages/utils.js";

describe("getCitations", () => {
  test("collects anchored and unanchored citations, skipping uncited parts", () => {
    const content: ContentPart[] = [
      { type: "text", text: "no sources here" },
      {
        type: "text",
        text: "grounded claim",
        citations: [{ source: { type: "web", url: "https://a.com", title: "A" } }],
      },
      {
        type: "citation",
        citations: [
          { source: { type: "web", url: "https://b.com" } },
          { source: { type: "document", fileId: "f1", title: "Doc" } },
        ],
      },
    ];

    const citations = getCitations(content);

    expect(citations.map((c) => c.source.type)).toEqual(["web", "web", "document"]);
    expect(citations[0].source).toMatchObject({ url: "https://a.com" });
  });

  test("returns empty when no part carries citations", () => {
    expect(getCitations([{ type: "text", text: "plain" }])).toEqual([]);
  });
});
