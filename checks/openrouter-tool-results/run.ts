import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { inspect } from "node:util";
import { openRouterToolResultModels, type OpenRouterToolResultModel } from "./models.js";

type AttachmentKind = "image" | "pdf";
type AttachmentSource = "data-url" | "url";
type Placement = "tool" | "user";
type ProbeStatus = "seen" | "accepted-unseen" | "rejected" | "error" | "skip";

interface RunOptions {
  models: string[];
  probes: string[];
  out: string;
  report: string;
  baseUrl: string;
  imagePath: string;
  imageUrl: string;
  pdfPath: string;
  pdfUrl: string;
  maxTokens: number;
  delayMs: number;
  all: boolean;
  list: boolean;
}

interface OpenRouterModelMetadata {
  id: string;
  name?: string;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    modality?: string;
  };
  supported_parameters?: string[];
}

interface Probe {
  id: string;
  placement: Placement;
  attachmentKind: AttachmentKind;
  source: AttachmentSource;
}

interface ProbeRecord {
  timestamp: string;
  model: string;
  modelLabel: string;
  modelGroup: OpenRouterToolResultModel["group"];
  probe: string;
  placement: Placement;
  attachmentKind: AttachmentKind;
  source: AttachmentSource;
  advertisedInputModalities?: string[];
  advertisedModality?: string;
  status: ProbeStatus;
  httpStatus?: number;
  durationMs: number;
  provider?: string;
  responseModel?: string;
  output?: string;
  reasoning?: string;
  usage?: unknown;
  response?: unknown;
  error?: unknown;
}

interface AttachmentFixtures {
  imageDataUrl: string;
  imageUrl: string;
  pdfDataUrl: string;
  pdfUrl: string;
}

const probes: Probe[] = [
  {
    id: "tool-image-data-url",
    placement: "tool",
    attachmentKind: "image",
    source: "data-url",
  },
  {
    id: "tool-image-url",
    placement: "tool",
    attachmentKind: "image",
    source: "url",
  },
  {
    id: "tool-pdf-data-url",
    placement: "tool",
    attachmentKind: "pdf",
    source: "data-url",
  },
  {
    id: "tool-pdf-url",
    placement: "tool",
    attachmentKind: "pdf",
    source: "url",
  },
  {
    id: "user-image-data-url",
    placement: "user",
    attachmentKind: "image",
    source: "data-url",
  },
  {
    id: "user-image-url",
    placement: "user",
    attachmentKind: "image",
    source: "url",
  },
  {
    id: "user-pdf-data-url",
    placement: "user",
    attachmentKind: "pdf",
    source: "data-url",
  },
  {
    id: "user-pdf-url",
    placement: "user",
    attachmentKind: "pdf",
    source: "url",
  },
];

const options = parseArgs(process.argv.slice(2));

if (options.list) {
  printAvailable();
  process.exit(0);
}

const selectedModels = selectModels(options.models, options.all);
const selectedProbes = selectProbes(options.probes);
const apiKey = getEnv("OPENROUTER_API_KEY");
const fixtures = await loadFixtures(options);
const metadata = await fetchModelMetadata(options.baseUrl);

await mkdir(dirname(options.out), { recursive: true });
await mkdir(dirname(options.report), { recursive: true });
await writeFile(options.out, "");

const records: ProbeRecord[] = [];

for (const model of selectedModels) {
  const modelMetadata = metadata.get(model.id);
  console.log(`[Model] ${model.label} (${model.id})`);

  for (const probe of selectedProbes) {
    const startedAt = Date.now();
    let record: ProbeRecord;

    try {
      record = await runProbe({
        apiKey,
        baseUrl: options.baseUrl,
        fixtures,
        maxTokens: options.maxTokens,
        model,
        modelMetadata,
        probe,
        startedAt,
      });
    } catch (error) {
      record = {
        ...baseRecord(model, modelMetadata, probe),
        timestamp: new Date().toISOString(),
        status: "error",
        durationMs: Date.now() - startedAt,
        error: serializeError(error),
      };
    }

    records.push(record);
    await writeFile(options.out, `${JSON.stringify(record)}\n`, { flag: "a" });
    console.log(`  ${formatStatus(record.status)} [${probe.id}]${formatOutput(record)}`);

    if (options.delayMs > 0) await delay(options.delayMs);
  }
}

await writeFile(options.report, renderReport(records, metadata));

const counts = countStatuses(records);
console.log(
  `\n[Summary] ${counts.seen} seen, ${counts["accepted-unseen"]} accepted-unseen, ${counts.rejected} rejected, ${counts.error} errors`,
);
console.log(`[JSONL] ${options.out}`);
console.log(`[Report] ${options.report}`);

async function runProbe({
  apiKey,
  baseUrl,
  fixtures,
  maxTokens,
  model,
  modelMetadata,
  probe,
  startedAt,
}: {
  apiKey: string;
  baseUrl: string;
  fixtures: AttachmentFixtures;
  maxTokens: number;
  model: OpenRouterToolResultModel;
  modelMetadata?: OpenRouterModelMetadata;
  probe: Probe;
  startedAt: number;
}): Promise<ProbeRecord> {
  const requestBody = createRequestBody(model.id, probe, fixtures, maxTokens);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/johncch/axle",
      "X-Title": "Axle OpenRouter Tool Result Experiment",
    },
    body: JSON.stringify(requestBody),
  });
  const responseBody = await readJsonResponse(response);
  const common = {
    ...baseRecord(model, modelMetadata, probe),
    timestamp: new Date().toISOString(),
    httpStatus: response.status,
    durationMs: Date.now() - startedAt,
  };

  if (!response.ok) {
    return {
      ...common,
      status: "rejected",
      error: responseBody,
    };
  }

  const output = extractOutput(responseBody);
  const reasoning = extractReasoning(responseBody);
  if (isRecord(responseBody) && responseBody.error !== undefined) {
    return {
      ...common,
      status: "rejected",
      error: responseBody.error,
      response: responseBody,
    };
  }

  return {
    ...common,
    status: answerShowsAttachment(probe.attachmentKind, `${output}\n${reasoning}`)
      ? "seen"
      : "accepted-unseen",
    provider: getString(responseBody, "provider"),
    responseModel: getString(responseBody, "model"),
    output,
    reasoning,
    usage: getUnknown(responseBody, "usage"),
    ...(output ? {} : { response: responseBody }),
  };
}

function createRequestBody(
  model: string,
  probe: Probe,
  fixtures: AttachmentFixtures,
  maxTokens: number,
): Record<string, unknown> {
  const prompt =
    probe.attachmentKind === "image"
      ? "Inspect the attached image and answer with only the full name of the university ranked first."
      : "Inspect the attached PDF and answer with only the author's full name.";
  const attachment = createAttachment(probe, fixtures);
  const content = [{ type: "text", text: prompt }, attachment];

  if (probe.placement === "user") {
    return {
      model,
      messages: [{ role: "user", content }],
      max_tokens: maxTokens,
    };
  }

  return {
    model,
    messages: [
      {
        role: "user",
        content: "Use the inspect_attachment tool and answer from its returned attachment.",
      },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_attachment",
            type: "function",
            function: {
              name: "inspect_attachment",
              arguments: "{}",
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_attachment",
        content,
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "inspect_attachment",
          description: "Returns an attachment to inspect.",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      },
    ],
    max_tokens: maxTokens,
  };
}

function createAttachment(probe: Probe, fixtures: AttachmentFixtures): Record<string, unknown> {
  if (probe.attachmentKind === "image") {
    return {
      type: "image_url",
      image_url: {
        url: probe.source === "url" ? fixtures.imageUrl : fixtures.imageDataUrl,
      },
    };
  }

  return {
    type: "file",
    file: {
      filename: "attachment.pdf",
      file_data: probe.source === "url" ? fixtures.pdfUrl : fixtures.pdfDataUrl,
    },
  };
}

async function loadFixtures(options: RunOptions): Promise<AttachmentFixtures> {
  const [image, pdf] = await Promise.all([readFile(options.imagePath), readFile(options.pdfPath)]);

  return {
    imageDataUrl: `data:image/png;base64,${image.toString("base64")}`,
    imageUrl: options.imageUrl,
    pdfDataUrl: `data:application/pdf;base64,${pdf.toString("base64")}`,
    pdfUrl: options.pdfUrl,
  };
}

async function fetchModelMetadata(baseUrl: string): Promise<Map<string, OpenRouterModelMetadata>> {
  const response = await fetch(`${baseUrl}/models`);
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenRouter model metadata: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { data?: OpenRouterModelMetadata[] };
  return new Map((body.data ?? []).map((model) => [model.id, model]));
}

function selectModels(values: string[], all: boolean): OpenRouterToolResultModel[] {
  if (all && values.length > 0) throw new Error("--all cannot be combined with --model");
  if (all) return openRouterToolResultModels;
  if (values.length === 0) {
    throw new Error("Select at least one --model or pass --all for the full matrix");
  }
  const normalized = new Set(values.map((value) => value.toLowerCase()));
  const selected = openRouterToolResultModels.filter(
    (model) =>
      normalized.has(model.id.toLowerCase()) ||
      normalized.has(model.label.toLowerCase()) ||
      normalized.has(model.group),
  );
  const known = new Set(
    selected.flatMap((model) => [model.id.toLowerCase(), model.label.toLowerCase(), model.group]),
  );
  const unknown = [...normalized].filter((value) => !known.has(value));
  if (unknown.length > 0) {
    throw new Error(`Unknown model or group: ${unknown.join(", ")}`);
  }
  return selected;
}

function selectProbes(values: string[]): Probe[] {
  if (values.length === 0) return probes;
  const selected = probes.filter((probe) => values.includes(probe.id));
  const selectedIds = new Set(selected.map((probe) => probe.id));
  const unknown = values.filter((value) => !selectedIds.has(value));
  if (unknown.length > 0) throw new Error(`Unknown probe: ${unknown.join(", ")}`);
  return selected;
}

function baseRecord(
  model: OpenRouterToolResultModel,
  metadata: OpenRouterModelMetadata | undefined,
  probe: Probe,
): Omit<ProbeRecord, "timestamp" | "status" | "durationMs"> {
  return {
    model: model.id,
    modelLabel: model.label,
    modelGroup: model.group,
    probe: probe.id,
    placement: probe.placement,
    attachmentKind: probe.attachmentKind,
    source: probe.source,
    advertisedInputModalities: metadata?.architecture?.input_modalities,
    advertisedModality: metadata?.architecture?.modality,
  };
}

function answerShowsAttachment(kind: AttachmentKind, output: string): boolean {
  if (kind === "image") return /carnegie\s+mellon/i.test(output);
  return /terry\s+winograd/i.test(output);
}

function extractOutput(value: unknown): string {
  const message = extractResponseMessage(value);
  if (!message) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join("");
}

function extractReasoning(value: unknown): string {
  const message = extractResponseMessage(value);
  if (!message) return "";
  if (typeof message.reasoning === "string") return message.reasoning;
  if (typeof message.reasoning_content === "string") return message.reasoning_content;
  return "";
}

function extractResponseMessage(value: unknown): Record<string, any> | undefined {
  if (!isRecord(value)) return undefined;
  const choices = value.choices;
  if (!Array.isArray(choices) || !isRecord(choices[0])) return undefined;
  const message = choices[0].message;
  return isRecord(message) ? message : undefined;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function getString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value[key] === "string" ? value[key] : undefined;
}

function getUnknown(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function renderReport(
  records: ProbeRecord[],
  metadata: Map<string, OpenRouterModelMetadata>,
): string {
  const probeIds = [...new Set(records.map((record) => record.probe))];
  const models = [...new Set(records.map((record) => record.model))];
  const lines = [
    "# OpenRouter Tool Result Experiment",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Legend: `seen` means the response contained the fixture's expected answer; `accepted-unseen` means HTTP succeeded but the expected answer was absent.",
    "",
    `| Model | Advertised input | ${probeIds.join(" | ")} |`,
    `| --- | --- | ${probeIds.map(() => "---").join(" | ")} |`,
  ];

  for (const model of models) {
    const modelRecords = records.filter((record) => record.model === model);
    const modelMetadata = metadata.get(model);
    const modalities = modelMetadata?.architecture?.input_modalities?.join(", ") ?? "unknown";
    lines.push(
      `| ${modelRecords[0]?.modelLabel ?? model}<br>\`${model}\` | ${modalities} | ${probeIds
        .map((probe) => modelRecords.find((record) => record.probe === probe)?.status ?? "missing")
        .join(" | ")} |`,
    );
  }

  lines.push("", "## Details", "");
  for (const record of records) {
    if (record.status === "seen") continue;
    lines.push(
      `### ${record.modelLabel}: ${record.probe}`,
      "",
      `Status: \`${record.status}\`${record.httpStatus ? `, HTTP ${record.httpStatus}` : ""}`,
      "",
      "```text",
      truncate(
        record.output ||
          record.reasoning ||
          (record.error === undefined ? "" : inspect(record.error, { depth: 8, compact: false })),
        4000,
      ),
      "```",
      "",
    );
  }

  return `${lines.join("\n")}\n`;
}

function countStatuses(records: ProbeRecord[]): Record<ProbeStatus, number> {
  const counts: Record<ProbeStatus, number> = {
    seen: 0,
    "accepted-unseen": 0,
    rejected: 0,
    error: 0,
    skip: 0,
  };
  for (const record of records) counts[record.status] += 1;
  return counts;
}

function formatStatus(status: ProbeStatus): string {
  if (status === "seen") return color(32, "✓ seen");
  if (status === "accepted-unseen") return color(33, "? accepted-unseen");
  if (status === "skip") return color(90, "- skip");
  return color(31, `✗ ${status}`);
}

function formatOutput(record: ProbeRecord): string {
  if (record.status === "seen") return "";
  const value =
    record.output || record.reasoning || (record.error === undefined ? "" : inspect(record.error));
  return value ? `: ${truncate(value.replace(/\s+/g, " "), 180)}` : "";
}

function color(code: number, value: string): string {
  return `\x1b[${code}m${value}\x1b[0m`;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(args: string[]): RunOptions {
  const timestamp = Date.now();
  const parsed: RunOptions = {
    models: [],
    probes: [],
    out: join("output", "checks", `openrouter-tool-results-${timestamp}.jsonl`),
    report: join("output", "checks", `openrouter-tool-results-${timestamp}.md`),
    baseUrl: "https://openrouter.ai/api/v1",
    imagePath: "examples/data/economist-brainy-imports.png",
    imageUrl:
      "https://raw.githubusercontent.com/johncch/axle/main/examples/data/economist-brainy-imports.png",
    pdfPath: "examples/data/designing-a-new-foundation.pdf",
    pdfUrl:
      "https://raw.githubusercontent.com/johncch/axle/main/examples/data/designing-a-new-foundation.pdf",
    maxTokens: 128,
    delayMs: 0,
    all: false,
    list: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = () => {
      const value = args[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    switch (arg) {
      case "--model":
      case "--models":
        parsed.models.push(...splitList(next()));
        break;
      case "--probe":
      case "--probes":
        parsed.probes.push(...splitList(next()));
        break;
      case "--out":
        parsed.out = next();
        break;
      case "--report":
        parsed.report = next();
        break;
      case "--base-url":
        parsed.baseUrl = next().replace(/\/$/, "");
        break;
      case "--image-path":
        parsed.imagePath = next();
        break;
      case "--image-url":
        parsed.imageUrl = next();
        break;
      case "--pdf-path":
        parsed.pdfPath = next();
        break;
      case "--pdf-url":
        parsed.pdfUrl = next();
        break;
      case "--max-tokens":
        parsed.maxTokens = parsePositiveInteger(next(), arg);
        break;
      case "--delay-ms":
        parsed.delayMs = parseNonNegativeInteger(next(), arg);
        break;
      case "--all":
        parsed.all = true;
        break;
      case "--list":
        parsed.list = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function printAvailable(): void {
  console.log("Models:");
  for (const model of openRouterToolResultModels) {
    console.log(`  ${model.group.padEnd(12)} ${model.label.padEnd(22)} ${model.id}`);
  }
  console.log("\nProbes:");
  for (const probe of probes) console.log(`  ${probe.id}`);
}

function printHelp(): void {
  console.log(`OpenRouter rich tool-result experiment

Usage:
  pnpm exec tsx checks/openrouter-tool-results/run.ts [options]

Options:
  --model <id|label|group>  Model, label, or group. Repeat or comma-separate.
  --all                     Run every configured model.
  --probe <id>              Probe id. Repeat or comma-separate.
  --out <path>              JSONL output path.
  --report <path>           Markdown matrix output path.
  --max-tokens <number>     Maximum completion tokens. Default: 128.
  --delay-ms <number>       Delay between requests.
  --list                    List configured models and probes.
`);
}
