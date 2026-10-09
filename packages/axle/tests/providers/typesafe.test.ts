import { afterEach, describe, expect, test, vi } from "vitest";
import { choice, decide, noul, score } from "../../src/providers/decide.js";
import { typesafe } from "../../src/providers/typesafe/index.js";

const questions = {
  is_bug: noul("Is the customer reporting a defect?", {
    true: "Broken behavior",
    false: "A question",
  }),
  team: choice("Which team owns this?", { payments: "Billing issues", frontend: null }),
  urgency: score("How urgent?", ["Can wait", "This week", "Blocking"]),
};

const responseBody = {
  model: "jev-1.13.0",
  answers: {
    is_bug: { type: "noul", noul: 0.96 },
    team: {
      type: "choice",
      choice: "payments",
      confidence: 0.67,
      probabilities: { payments: 0.78, frontend: 0.22 },
    },
    urgency: {
      type: "score",
      score: 1.99,
      confidence: 0.99,
      probabilities: { "0": 0, "1": 0, "2": 1 },
      legend: { "0": "Can wait", "1": "This week", "2": "Blocking" },
    },
  },
  usage: { input_tokens: 476, output_tokens: 70 },
};

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("typesafe", () => {
  test("posts state and questions to System One and maps the response", async () => {
    const fetchMock = stubFetch(Response.json(responseBody));

    const result = await decide({
      provider: typesafe("ts-key"),
      model: "jev-latest",
      input: { ticket: "Checkout shows a blank screen" },
      questions,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer ts-key",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "jev-latest",
      state: { ticket: "Checkout shows a blank screen" },
      questions: {
        is_bug: {
          type: "noul",
          instructions: "Is the customer reporting a defect?",
          criteria: { true: "Broken behavior", false: "A question" },
        },
        team: {
          type: "choice",
          instructions: "Which team owns this?",
          criteria: { payments: "Billing issues", frontend: null },
        },
        urgency: {
          type: "score",
          instructions: "How urgent?",
          criteria: ["Can wait", "This week", "Blocking"],
        },
      },
    });
    expect(result).toEqual({
      model: "jev-1.13.0",
      answers: responseBody.answers,
      usage: { in: 476, out: 70 },
    });
  });

  test("routes through a compatible host and accepts its extra response fields", async () => {
    const fetchMock = stubFetch(
      Response.json({
        ...responseBody,
        id: "gen-dec-1",
        provider: "TypeSafe",
        usage: { ...responseBody.usage, cost: 0.00002 },
      }),
    );

    const result = await decide({
      provider: typesafe("or-key", {
        baseUrl: "https://openrouter.ai/api/",
        headers: { "X-Title": "axle-test" },
      }),
      model: "jev-latest",
      input: "text",
      questions,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/systemone");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer or-key",
      "X-Title": "axle-test",
    });
    expect(result.usage).toEqual({ in: 476, out: 70 });
  });

  test("retries a rate-limited request", async () => {
    const fetchMock = stubFetch(
      new Response("slow down", { status: 429, headers: { "retry-after-ms": "0" } }),
      Response.json(responseBody),
    );

    const result = await decide({
      provider: typesafe("ts-key"),
      model: "jev-latest",
      input: "text",
      questions,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.model).toBe("jev-1.13.0");
  });

  test("gives up on an unanswered request after ten seconds by default", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => new Promise<Response>(() => {})),
    );

    const outcome = decide({
      provider: typesafe("ts-key", { maxRetries: 0 }),
      model: "jev-latest",
      input: "text",
      questions,
    }).catch((error: Error) => error);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(await outcome).toMatchObject({
      name: "TimeoutError",
      message: "Request timed out after 10000ms",
    });
  });

  test("reports the status and body of a rejected request", async () => {
    stubFetch(new Response('{"detail":"questions: field required"}', { status: 422 }));

    await expect(
      decide({ provider: typesafe("ts-key"), model: "jev-latest", input: "text", questions }),
    ).rejects.toMatchObject({
      code: "DECISION_REQUEST_FAILED",
      message: 'TypeSafe request failed with status 422: {"detail":"questions: field required"}',
      details: { status: 422 },
    });
  });

  test("rejects a response body that is not a System One result", async () => {
    stubFetch(Response.json({ model: "jev-1.13.0", answers: { is_bug: { type: "noul" } } }));

    await expect(
      decide({ provider: typesafe("ts-key"), model: "jev-latest", input: "text", questions }),
    ).rejects.toMatchObject({ code: "DECISION_RESPONSE_INVALID" });
  });
});
