import {
  type Content,
  FinishReason,
  type GenerateContentResponse,
  GoogleGenAI,
  type Part,
  ThinkingLevel,
} from "@google/genai";
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// pnpm exec tsx checks/captures/capture-gemini-continuation.ts \
//   --model gemini-4-argon --max-output-tokens 131072 --out /tmp/gemini-continuation
//
// Provokes FinishReason.CONTINUATION with a long-output prompt and a
// maxOutputTokens above the 65,536 per-request cap, then resumes with config.continuationToken on the same
// contents (variant "token-only"). If that request is rejected, retries with
// the partial model content appended (variant "token-and-partial").

interface CaptureOptions {
  model: string;
  prompt: string;
  out: string;
  maxResumes: number;
  maxOutputTokens: number;
  system: string;
  automatic: boolean;
}

function parseArgs(argv: string[]): CaptureOptions {
  const options: CaptureOptions = {
    model: process.env.GEMINI_CAPTURE_MODEL ?? "gemini-4-argon",
    prompt:
      "For every integer n from 1 to 5000, print one line of the form: n | n*n | n*n*n | sum of the decimal digits of n | n mod 7. Begin immediately with the line for n=1. No commentary, no headings, no code fences, no stopping early.",
    out: "/tmp/gemini-continuation",
    maxResumes: 3,
    maxOutputTokens: 131072,
    automatic: false,
    system:
      "This request runs with long decode enabled. The maximum output for this response is 131,072 tokens, well above the usual 65,536. Very long outputs are expected and must be produced in full. Never refuse, shorten, or summarize a task because of output length.",
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
    } else if (arg === "--out") {
      if (!value) throw new Error("--out requires a value");
      options.out = value;
      i += 1;
    } else if (arg === "--automatic") {
      options.automatic = true;
    } else if (arg === "--system") {
      if (!value) throw new Error("--system requires a value");
      options.system = value;
      i += 1;
    } else if (arg === "--max-output-tokens") {
      if (!value) throw new Error("--max-output-tokens requires a value");
      options.maxOutputTokens = Number(value);
      i += 1;
    } else if (arg === "--max-resumes") {
      if (!value) throw new Error("--max-resumes requires a value");
      options.maxResumes = Number(value);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

interface StreamOutcome {
  parts: Part[];
  finishReason?: FinishReason;
  continuationToken?: string;
  chunkCount: number;
  textChars: number;
  checkpointChunks: number;
  finishReasons: string[];
  usage?: GenerateContentResponse["usageMetadata"];
}

async function streamToFile(
  client: GoogleGenAI,
  model: string,
  contents: Content[],
  continuationToken: string | undefined,
  maxOutputTokens: number,
  system: string,
  automatic: boolean,
  path: string,
): Promise<StreamOutcome> {
  const stream = await client.models.generateContentStream({
    model,
    contents,
    config: {
      systemInstruction: system,
      automaticContinuation: automatic,
      maxOutputTokens,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      ...(continuationToken ? { continuationToken } : {}),
    },
  });
  const lines: string[] = [];
  const outcome: StreamOutcome = {
    parts: [],
    chunkCount: 0,
    textChars: 0,
    checkpointChunks: 0,
    finishReasons: [],
  };
  for await (const chunk of stream) {
    outcome.chunkCount += 1;
    lines.push(JSON.stringify(chunk));
    const candidate = chunk.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      outcome.parts.push(part);
      if (part.text) outcome.textChars += part.text.length;
    }
    if (candidate?.finishReason) {
      outcome.finishReason = candidate.finishReason;
      outcome.finishReasons.push(candidate.finishReason);
    }
    if (candidate?.continuationToken) {
      outcome.continuationToken = candidate.continuationToken;
      if (!candidate.finishReason) outcome.checkpointChunks += 1;
    }
    if (chunk.usageMetadata) outcome.usage = chunk.usageMetadata;
    if (outcome.chunkCount % 50 === 0) {
      console.error(`[capture]   ${outcome.chunkCount} chunks, ${outcome.textChars} chars`);
    }
  }
  writeFileSync(path, lines.join("\n") + "\n");
  console.error(
    `[capture] wrote ${outcome.chunkCount} chunks (${outcome.textChars} chars) to ${path}; finish=${outcome.finishReasons.join(",") || "(none)"}; checkpoints=${outcome.checkpointChunks}; token=${outcome.continuationToken ? `${outcome.continuationToken.length} chars` : "(none)"}; usage=${JSON.stringify(outcome.usage ?? null)}`,
  );
  return outcome;
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY in environment or .env");
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(options.out, { recursive: true });
  const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: 20 * 60 * 1000 } });
  console.error(`[capture] model: ${options.model}`);

  const contents: Content[] = [{ role: "user", parts: [{ text: options.prompt }] }];
  let outcome = await streamToFile(
    client,
    options.model,
    contents,
    undefined,
    options.maxOutputTokens,
    options.system,
    options.automatic,
    join(options.out, "request-1.jsonl"),
  );
  const partsSoFar: Part[] = [...outcome.parts];

  let resumes = 0;
  while (outcome.finishReason === FinishReason.CONTINUATION && resumes < options.maxResumes) {
    resumes += 1;
    const token = outcome.continuationToken;
    if (!token) throw new Error("CONTINUATION without a continuationToken");
    const tokenOnly = join(options.out, `resume-${resumes}-token-only.jsonl`);
    writeFileSync(
      join(options.out, `resume-${resumes}-token-only-request.json`),
      JSON.stringify(
        {
          contents,
          config: { maxOutputTokens: options.maxOutputTokens, continuationToken: token },
        },
        null,
        2,
      ),
    );
    console.error(`[capture] resume ${resumes}: token only, same contents`);
    try {
      outcome = await streamToFile(
        client,
        options.model,
        contents,
        token,
        options.maxOutputTokens,
        options.system,
        options.automatic,
        tokenOnly,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[capture] token-only resume rejected: ${message}`);
      writeFileSync(join(options.out, `resume-${resumes}-token-only-error.txt`), message + "\n");
      const withPartial: Content[] = [...contents, { role: "model", parts: partsSoFar }];
      writeFileSync(
        join(options.out, `resume-${resumes}-token-and-partial-request.json`),
        JSON.stringify(
          {
            contents: withPartial,
            config: {
              systemInstruction: options.system,
              maxOutputTokens: options.maxOutputTokens,
              continuationToken: token,
            },
          },
          null,
          2,
        ),
      );
      console.error(`[capture] resume ${resumes}: token plus partial model content`);
      outcome = await streamToFile(
        client,
        options.model,
        withPartial,
        token,
        options.maxOutputTokens,
        options.system,
        options.automatic,
        join(options.out, `resume-${resumes}-token-and-partial.jsonl`),
      );
    }
    partsSoFar.push(...outcome.parts);
  }

  const fullText = partsSoFar.map((part) => part.text ?? "").join("");
  writeFileSync(join(options.out, "full-text.txt"), fullText);
  const lines = fullText.split("\n").filter((line) => line.trim().length > 0);
  console.error(
    `[capture] done: final finish=${outcome.finishReason}, resumes=${resumes}, total text chars=${fullText.length}, non-empty lines=${lines.length}, first line=${JSON.stringify(lines[0] ?? "")}, last line=${JSON.stringify(lines[lines.length - 1] ?? "")}`,
  );
}

main().catch((error) => {
  console.error(`[capture] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
