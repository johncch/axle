import "dotenv/config";

// pnpm exec tsx scripts/capture-openrouter-web-search.ts \
//   --model "your/openrouter-model" \
//   > /tmp/openrouter-web-search.sse

interface CaptureOptions {
  model: string;
  prompt: string;
  outputAnnotationsOnly: boolean;
}

function parseArgs(argv: string[]): CaptureOptions {
  const options: Partial<CaptureOptions> = {
    model: process.env.OPENROUTER_MODEL,
    prompt:
      process.env.OPENROUTER_CAPTURE_PROMPT ??
      "Search the web for today's top AI news and cite sources.",
    outputAnnotationsOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];

    if (arg === "--model") {
      if (!value) throw new Error("--model requires a value");
      options.model = value;
      i += 1;
    } else if (arg === "--prompt") {
      if (!value) throw new Error("--prompt requires a value");
      options.prompt = value;
      i += 1;
    } else if (arg === "--annotations-only") {
      options.outputAnnotationsOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.model) {
    throw new Error("Missing model. Set OPENROUTER_MODEL or pass --model <model-id>.");
  }

  return options as CaptureOptions;
}

function printHelp() {
  console.error(`Usage:
  OPENROUTER_API_KEY=... pnpm exec tsx scripts/capture-openrouter-web-search.ts --model <model-id> > /tmp/openrouter-web-search.sse

Options:
  --model <id>            OpenRouter model id. Defaults to OPENROUTER_MODEL.
  --prompt <text>         Prompt to send. Defaults to OPENROUTER_CAPTURE_PROMPT or a news prompt.
  --annotations-only      Print only SSE data lines whose JSON contains delta.annotations.
  -h, --help              Show this help.
`);
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY in environment or .env");

  const options = parseArgs(process.argv.slice(2));

  console.error("[capture] requesting OpenRouter streamed web search");
  console.error(`[capture] model: ${options.model}`);
  console.error(`[capture] prompt: ${options.prompt}`);

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(process.env.OPENROUTER_REFERER ? { "HTTP-Referer": process.env.OPENROUTER_REFERER } : {}),
      ...(process.env.OPENROUTER_APP_TITLE ? { "X-Title": process.env.OPENROUTER_APP_TITLE } : {}),
    },
    body: JSON.stringify({
      model: options.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: options.prompt }],
      tools: [{ type: "openrouter:web_search" }],
    }),
  });

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `OpenRouter request failed: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines = 0;
  let annotationLines = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;
      if (!trimmed.startsWith("data: ")) {
        if (!options.outputAnnotationsOnly) console.log(trimmed);
        continue;
      }

      dataLines += 1;
      if (trimmed === "data: [DONE]") {
        if (!options.outputAnnotationsOnly) console.log(trimmed);
        continue;
      }

      const hasAnnotations = hasDeltaAnnotations(trimmed.slice("data: ".length));
      if (hasAnnotations) annotationLines += 1;

      if (!options.outputAnnotationsOnly || hasAnnotations) {
        console.log(trimmed);
      }
    }
  }

  if (buffer.trim()) {
    console.log(buffer.trimEnd());
  }

  console.error(`[capture] complete: ${dataLines} data lines, ${annotationLines} annotation lines`);
}

function hasDeltaAnnotations(data: string): boolean {
  try {
    const parsed = JSON.parse(data);
    return Boolean(parsed?.choices?.some((choice: any) => choice?.delta?.annotations?.length > 0));
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(`[capture] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
