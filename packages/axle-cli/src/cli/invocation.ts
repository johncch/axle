import type { AgentDefinition } from "@fifthrevision/axle";
import { Instruct, loadFileContent } from "@fifthrevision/axle";
import {
  createAgentDefinition,
  createDefaultAgentDefinition,
  resolveTarget,
} from "./agent-config.js";
import type { CliConfig, JobConfig, ServiceConfig } from "./configs/schemas.js";
import type { AgentSessionSpec, BatchRunSpec } from "./runners.js";
import { loadSession, SessionStore } from "./sessions.js";
import { promptForInputs, promptForMissingModel } from "./setup.js";

export interface CommonOpts {
  renderer: "plain" | "ink";
  log: boolean;
  debug: boolean;
}

export type Invocation =
  | {
      kind: "kernel";
      job?: string;
      message?: string;
      interactive: boolean;
      args: string[];
      common: CommonOpts;
    }
  | {
      kind: "batch";
      job: string;
      inputs: string[];
      incremental?: boolean;
      verbose: boolean;
      args: string[];
      common: CommonOpts;
    }
  | { kind: "resume"; id: string; message?: string; common: CommonOpts };

export type PendingPlan =
  | {
      kind: "batch";
      definition: AgentDefinition;
      spec: Omit<BatchRunSpec, "agentConfig" | "definition">;
    }
  | {
      kind: "session";
      definition: AgentDefinition;
      spec: Omit<AgentSessionSpec, "agentConfig">;
      sessionStore: SessionStore;
    };

export function parseTemplateArgs(args: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const arg of args) {
    const separator = arg.indexOf("=");
    if (separator < 1) continue;
    const key = arg.slice(0, separator).trim();
    const value = arg.slice(separator + 1).trim();
    if (key && value) values[key] = value;
  }
  return values;
}

export async function buildPendingPlan(options: {
  invocation: Invocation;
  cliConfig: CliConfig;
  serviceConfig: ServiceConfig;
  jobConfig?: JobConfig;
  jobScope: string;
  variables: Record<string, string>;
  interactiveTerminal: boolean;
}): Promise<PendingPlan> {
  const {
    invocation: inv,
    cliConfig,
    serviceConfig,
    jobConfig,
    jobScope,
    variables,
    interactiveTerminal,
  } = options;

  let pending: PendingPlan;
  if (inv.kind === "resume") {
    const saved = await loadSession(inv.id);
    pending = {
      kind: "session",
      definition: saved.definition,
      spec: {
        spanName: "resume",
        session: saved.session,
        priorTurns: saved.turns,
        resumedFromCwd: saved.cwd,
        initial: inv.message,
        interactive: inv.message === undefined,
        compaction: saved.compaction,
      },
      sessionStore: new SessionStore(saved.definition, {
        cwd: saved.cwd,
        createdAt: saved.createdAt,
        compaction: saved.compaction,
      }),
    };
  } else if (jobConfig) {
    const definition = createAgentDefinition(jobConfig, cliConfig, serviceConfig);
    if (inv.kind === "batch" || jobConfig.batch) {
      if (inv.kind === "kernel" && inv.interactive) {
        throw new Error("A batch run cannot be combined with --interactive.");
      }

      let inputs: string[];
      if (inv.kind === "batch" && inv.inputs.length > 0) {
        inputs = inv.inputs;
      } else if (jobConfig.batch) {
        inputs = [jobConfig.batch.files];
      } else if (interactiveTerminal) {
        inputs = [await promptForInputs()];
      } else {
        throw new Error(
          "batch needs inputs: pass globs/paths after the recipe, or add a batch: block to it.",
        );
      }

      const verbose =
        (inv.kind === "batch" && inv.verbose) || (jobConfig.batch?.concurrency ?? 3) === 1;
      pending = {
        kind: "batch",
        definition,
        spec: {
          task: jobConfig.task,
          files: jobConfig.files,
          inputs,
          concurrency: verbose ? 1 : (jobConfig.batch?.concurrency ?? 3),
          jobName: jobScope,
          incremental:
            (inv.kind === "batch" ? inv.incremental : undefined) ??
            jobConfig.batch?.incremental ??
            false,
          verbose,
          compaction: jobConfig.compaction,
        },
      };
    } else {
      const instruct = new Instruct({ prompt: jobConfig.task });
      for (const filePath of jobConfig.files ?? []) {
        instruct.addFile(await loadFileContent(filePath));
      }
      pending = {
        kind: "session",
        definition,
        spec: {
          spanName: "job",
          initial: instruct.withInputs(variables),
          interactive: inv.kind === "kernel" && inv.interactive,
          compaction: jobConfig.compaction,
        },
        sessionStore: new SessionStore(definition, { compaction: jobConfig.compaction }),
      };
    }
  } else {
    const definition = createDefaultAgentDefinition(cliConfig, serviceConfig);
    pending = {
      kind: "session",
      definition,
      spec: {
        spanName: "chat",
        initial: inv.kind === "kernel" ? inv.message : undefined,
        interactive: inv.kind !== "kernel" || inv.message === undefined,
      },
      sessionStore: new SessionStore(definition),
    };
  }

  if (!pending.definition.model && interactiveTerminal) {
    const offerSave = pending.kind !== "session" || pending.spec.spanName !== "resume";
    pending.definition.model = await promptForMissingModel(pending.definition.provider.type, {
      offerSave,
      saveAs: offerSave
        ? resolveTarget(jobConfig, cliConfig, serviceConfig).providerName
        : undefined,
    });
  }

  return pending;
}
