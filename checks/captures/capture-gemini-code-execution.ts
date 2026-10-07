import {
  type Content,
  type FunctionDeclaration,
  type GenerateContentResponse,
  GoogleGenAI,
  type Part,
  Type,
} from "@google/genai";
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// pnpm exec tsx checks/captures/capture-gemini-code-execution.ts \
//   --model gemini-2.5-flash --out /tmp/gemini-code-execution
//
// With --with-function a client function is declared next to code execution
// and its call is answered, to see whether Gemini emits toolCall /
// toolResponse parts when built-in and client tools are combined.

interface CaptureOptions {
  model: string;
  prompt: string;
  followUp: string;
  out: string;
  withFunction: boolean;
}

function parseArgs(argv: string[]): CaptureOptions {
  const options: CaptureOptions = {
    model: process.env.GEMINI_CAPTURE_MODEL ?? "gemini-2.5-flash",
    prompt:
      "Use code execution to compute the sum of the first 50 prime numbers. Print the result and then tell me the answer in one sentence.",
    followUp: "Without running code again, divide that sum by 7 and give me the remainder.",
    out: "/tmp/gemini-code-execution",
    withFunction: false,
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
    } else if (arg === "--follow-up") {
      if (!value) throw new Error("--follow-up requires a value");
      options.followUp = value;
      i += 1;
    } else if (arg === "--out") {
      if (!value) throw new Error("--out requires a value");
      options.out = value;
      i += 1;
    } else if (arg === "--with-function") {
      options.withFunction = true;
      options.prompt =
        "Call get_secret_number to fetch my number, then use code execution to compute the sum of all primes below that number. Print the result and tell me the answer in one sentence.";
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.error(`Usage:
  GEMINI_API_KEY=... pnpm exec tsx checks/captures/capture-gemini-code-execution.ts [--model <id>] [--out <dir>]

Writes <dir>/turn-1.jsonl (streamed chunks of the code execution answer),
<dir>/turn-2-request.json (the contents echoed back) and <dir>/turn-2.jsonl
(streamed chunks of the follow-up).

Options:
  --model <id>        Gemini model id. Defaults to GEMINI_CAPTURE_MODEL or gemini-2.5-flash.
  --prompt <text>     First prompt. Defaults to a prime-sum computation.
  --follow-up <text>  Second prompt that depends on the first answer.
  --out <dir>         Output directory. Defaults to /tmp/gemini-code-execution.
  --with-function     Also declare a client function and answer its call.
  -h, --help          Show this help.
`);
}

const SECRET_NUMBER: FunctionDeclaration = {
  name: "get_secret_number",
  description: "Returns the user's secret number.",
  parameters: { type: Type.OBJECT, properties: {} },
};

async function streamToFile(
  client: GoogleGenAI,
  model: string,
  contents: Content[],
  path: string,
  withFunction: boolean,
): Promise<Part[]> {
  const stream = await client.models.generateContentStream({
    model,
    contents,
    config: {
      tools: [
        { codeExecution: {} },
        ...(withFunction ? [{ functionDeclarations: [SECRET_NUMBER] }] : []),
      ],
      ...(withFunction ? { toolConfig: { includeServerSideToolInvocations: true } } : {}),
    },
  });

  const lines: string[] = [];
  const modelParts: Part[] = [];
  let chunkCount = 0;
  for await (const chunk of stream) {
    chunkCount += 1;
    lines.push(JSON.stringify(chunk));
    describeChunk(chunkCount, chunk);
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      modelParts.push(part);
    }
  }
  writeFileSync(path, lines.join("\n") + "\n");
  console.error(`[capture] wrote ${chunkCount} chunks to ${path}`);
  return modelParts;
}

function describeChunk(n: number, chunk: GenerateContentResponse) {
  const candidate = chunk.candidates?.[0];
  const parts = (candidate?.content?.parts ?? []).map((part) => {
    const keys = Object.keys(part).filter((key) => key !== "text" || part.text);
    const sig = part.thoughtSignature ? ` sig(${part.thoughtSignature.length})` : "";
    const id =
      part.executableCode?.id ??
      part.codeExecutionResult?.id ??
      part.toolCall?.id ??
      part.functionCall?.id ??
      undefined;
    return `{${keys.join(",")}${sig}${id ? ` id=${id}` : ""}}`;
  });
  console.error(
    `[capture] chunk ${n}: ${parts.join(" ") || "(no parts)"}${candidate?.finishReason ? ` finish=${candidate.finishReason}` : ""}`,
  );
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY in environment or .env");
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(options.out, { recursive: true });

  const client = new GoogleGenAI({ apiKey });
  console.error(`[capture] model: ${options.model}`);

  const contents: Content[] = [{ role: "user", parts: [{ text: options.prompt }] }];
  let turn = 0;

  const run = async (label: string): Promise<Part[]> => {
    turn += 1;
    console.error(`[capture] turn ${turn}: ${label}`);
    const modelParts = await streamToFile(
      client,
      options.model,
      contents,
      join(options.out, `turn-${turn}.jsonl`),
      options.withFunction,
    );
    contents.push({ role: "model", parts: modelParts });
    return modelParts;
  };

  let modelParts = await run(options.prompt);
  while (modelParts.some((part) => part.functionCall)) {
    const responses: Part[] = modelParts
      .filter((part) => part.functionCall)
      .map((part) => ({
        functionResponse: {
          id: part.functionCall?.id,
          name: part.functionCall?.name ?? "",
          response: { number: 100 },
        },
      }));
    contents.push({ role: "user", parts: responses });
    modelParts = await run("function response { number: 100 }");
  }

  contents.push({ role: "user", parts: [{ text: options.followUp }] });
  writeFileSync(
    join(options.out, `turn-${turn + 1}-request.json`),
    JSON.stringify(contents, null, 2),
  );
  await run(options.followUp);
}

main().catch((error) => {
  console.error(`[capture] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
