import { Instruct, loadFileContent } from "@fifthrevision/axle";
import type { RunTarget } from "./agent-config.js";
import { resolveTarget } from "./agent-config.js";
import type { AgentRecipe, CliConfig, JobConfig, ServiceConfig } from "./configs/schemas.js";
import { agentRecipeOf } from "./configs/schemas.js";
import type { AgentSessionSpec, BatchRunSpec } from "./runners.js";
import type { CliSessionFile } from "./sessions.js";
import { SessionStore } from "./sessions.js";
import { promptForInputs, promptForMissingModel } from "./setup.js";

export interface CommonOpts {
  renderer: "plain" | "ink";
  log: boolean;
  debug: boolean;
}

export type KernelScheduling = { kind: "none" } | { kind: "occurrence"; id: string };

export type Invocation =
  | {
      kind: "kernel";
      job?: string;
      message?: string;
      interactive: boolean;
      scheduling: KernelScheduling;
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
      recipe: AgentRecipe;
      target: RunTarget;
      spec: Omit<BatchRunSpec, "agentConfig" | "recipe" | "contextWindow">;
    }
  | {
      kind: "session";
      recipe: AgentRecipe;
      target: RunTarget;
      spec: Omit<AgentSessionSpec, "agentConfig" | "contextWindow">;
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
  /** The session file a resume re-enters; loaded by the caller. */
  saved?: CliSessionFile;
}): Promise<PendingPlan> {
  const {
    invocation: inv,
    cliConfig,
    serviceConfig,
    jobConfig,
    jobScope,
    variables,
    interactiveTerminal,
    saved,
  } = options;

  let pending: PendingPlan;
  if (inv.kind === "resume") {
    if (!saved) throw new Error(`Session ${inv.id} was not loaded.`);
    pending = {
      kind: "session",
      recipe: saved.recipe,
      target: resolveTarget(saved.recipe, cliConfig, serviceConfig),
      spec: {
        spanName: "resume",
        session: saved.session,
        priorTurns: saved.turns,
        priorUsage: saved.meter,
        resumedFromCwd: saved.cwd,
        initial: inv.message,
        interactive: inv.message === undefined,
        compaction: saved.recipe.compaction,
      },
      sessionStore: new SessionStore(saved.recipe, { cwd: saved.cwd, createdAt: saved.createdAt }),
    };
  } else if (jobConfig) {
    const recipe = agentRecipeOf(jobConfig);
    const target = resolveTarget(recipe, cliConfig, serviceConfig);
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
        recipe,
        target,
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
        recipe,
        target,
        spec: {
          spanName: "job",
          initial: instruct.withInputs(variables),
          interactive: inv.kind === "kernel" && inv.interactive,
          compaction: jobConfig.compaction,
        },
        sessionStore: new SessionStore(recipe),
      };
    }
  } else {
    const recipe: AgentRecipe = {};
    pending = {
      kind: "session",
      recipe,
      target: resolveTarget(recipe, cliConfig, serviceConfig),
      spec: {
        spanName: "chat",
        initial: inv.kind === "kernel" ? inv.message : undefined,
        interactive: inv.kind !== "kernel" || inv.message === undefined,
      },
      sessionStore: new SessionStore(recipe),
    };
  }

  // A picked model is this run's, not the recipe's: the session does not
  // record it, so every run offers to make it the default.
  if (!pending.target.model && interactiveTerminal) {
    pending.target.model = await promptForMissingModel(pending.target.providerName, {
      saveAs: pending.target.providerName,
    });
  }

  return pending;
}
