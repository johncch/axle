import type { WorkflowStep } from "../actions/types.js";
import type { AIProvider } from "../ai/types.js";
import type { DAGJob } from "../cli/configs/schemas.js";
import { configToPlanner, configToTasks } from "../cli/utils.js";
import { AxleError } from "../errors/AxleError.js";
import type { TracingContext } from "../tracer/types.js";
import type { ProgramOptions, Stats } from "../types.js";
import { createErrorResult, createResult } from "../utils/result.js";
import { arrayify } from "../utils/utils.js";
import { concurrentWorkflow } from "./concurrent.js";
import { serialWorkflow } from "./serial.js";
import type {
  DAGConcurrentNodeDefinition,
  DAGDefinition,
  DAGExecutionPlan,
  DAGNode,
  DAGNodeDefinition,
  DAGWorkflowOptions,
  WorkflowExecutable,
  WorkflowResult,
} from "./types.js";

export class DAGParser {
  static parse(dagDefinition: DAGDefinition): DAGExecutionPlan {
    const nodes = new Map<string, DAGNode>();

    for (const [nodeId, definition] of Object.entries(dagDefinition)) {
      const dagNode = this.parseNodeDefinition(nodeId, definition);
      nodes.set(nodeId, dagNode);
    }

    this.validateDependencies(nodes);
    this.checkForCycles(nodes);

    const stages = this.createExecutionStages(nodes);

    return { stages, nodes };
  }

  private static parseNodeDefinition(nodeId: string, definition: any): DAGNode {
    if (this.isSimpleStep(definition)) {
      return {
        id: nodeId,
        steps: Array.isArray(definition) ? definition : [definition],
        dependencies: [],
        executionType: "serial",
      };
    }

    if (this.isConcurrentNodeDefinition(definition)) {
      const dependencies = definition.dependsOn ? arrayify(definition.dependsOn) : [];

      return {
        id: nodeId,
        steps: definition.steps,
        dependencies,
        planner: definition.planner,
        executionType: "concurrent",
      };
    }

    if (this.isNodeDefinition(definition)) {
      const dependencies = definition.dependsOn ? arrayify(definition.dependsOn) : [];
      const steps = arrayify(definition.step);

      return {
        id: nodeId,
        steps,
        dependencies,
        executionType: "serial",
      };
    }

    throw new Error(`Invalid DAG node definition for '${nodeId}'`);
  }

  private static isSimpleStep(definition: any): definition is WorkflowStep | WorkflowStep[] {
    return definition.name || Array.isArray(definition);
  }

  private static isConcurrentNodeDefinition(
    definition: any,
  ): definition is DAGConcurrentNodeDefinition {
    return definition && typeof definition === "object" && "planner" in definition;
  }

  private static isNodeDefinition(definition: any): definition is DAGNodeDefinition {
    return definition && typeof definition === "object" && "step" in definition;
  }

  private static validateDependencies(nodes: Map<string, DAGNode>): void {
    for (const node of nodes.values()) {
      for (const dep of node.dependencies) {
        if (!nodes.has(dep)) {
          throw new AxleError(`Node "${node.id}" depends on non-existent node "${dep}"`);
        }
      }
    }
  }

  private static checkForCycles(nodes: Map<string, DAGNode>): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (nodeId: string): boolean => {
      if (recursionStack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      recursionStack.add(nodeId);

      const node = nodes.get(nodeId)!;
      for (const depId of node.dependencies) {
        if (hasCycle(depId)) return true;
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of nodes.keys()) {
      if (hasCycle(nodeId)) {
        throw new AxleError(`Circular dependency detected involving node "${nodeId}"`);
      }
    }
  }

  private static createExecutionStages(nodes: Map<string, DAGNode>): string[][] {
    const stages: string[][] = [];
    const completed = new Set<string>();
    const remaining = new Set(nodes.keys());

    while (remaining.size > 0) {
      const currentStage: string[] = [];

      for (const nodeId of remaining) {
        const node = nodes.get(nodeId)!;
        const allDependenciesCompleted = node.dependencies.every((dep) => completed.has(dep));

        if (allDependenciesCompleted) {
          currentStage.push(nodeId);
        }
      }

      if (currentStage.length === 0) {
        throw new AxleError("Unable to resolve DAG dependencies - possible circular reference");
      }

      stages.push(currentStage);
      currentStage.forEach((nodeId) => {
        completed.add(nodeId);
        remaining.delete(nodeId);
      });
    }

    return stages;
  }
}

export class DAGJobToDefinition {
  static async convert(
    definition: DAGJob,
    context: { tracer?: TracingContext },
  ): Promise<DAGDefinition> {
    const { tracer } = context;
    const dagDefinition: DAGDefinition = {};

    for (const [nodeId, jobWithDeps] of Object.entries(definition)) {
      const { dependsOn, ...job } = jobWithDeps;

      if (job.type === "batch") {
        const planner = await configToPlanner(job, { tracer });
        const steps: WorkflowStep[] = await configToTasks(job, { tracer });

        const nodeDefinition: DAGConcurrentNodeDefinition = {
          planner,
          steps,
          ...(dependsOn ? { dependsOn } : {}),
        };
        dagDefinition[nodeId] = nodeDefinition;
      } else {
        const steps: WorkflowStep[] = await configToTasks(job, { tracer });

        if (dependsOn) {
          const nodeDefinition: DAGNodeDefinition = {
            step: steps,
            dependsOn,
          };
          dagDefinition[nodeId] = nodeDefinition;
        } else {
          dagDefinition[nodeId] = steps;
        }
      }
    }

    return dagDefinition;
  }
}

async function executeNode(
  nodeId: string,
  executionPlan: DAGExecutionPlan,
  context: {
    provider: AIProvider;
    variables: Record<string, any>;
    options?: ProgramOptions;
    stats?: Stats;
    tracer?: TracingContext;
  },
  workflowOptions: DAGWorkflowOptions = {},
): Promise<any> {
  const { variables, tracer } = context;
  const node = executionPlan.nodes.get(nodeId)!;

  const nodeSpan = tracer?.startSpan(nodeId, { type: "internal" });

  try {
    let result: WorkflowResult;
    if (node.executionType === "concurrent" && node.planner) {
      result = await concurrentWorkflow(node.planner, ...node.steps).execute({
        ...context,
        variables,
        tracer: nodeSpan,
        name: nodeId,
      });
    } else {
      result = await serialWorkflow(...node.steps).execute({
        ...context,
        variables,
        tracer: nodeSpan,
        name: nodeId,
      });
    }

    if (!result.success) {
      throw result.error;
    }
    nodeSpan?.end();
    return result.response;
  } catch (error) {
    nodeSpan?.end("error");
    if (!workflowOptions.continueOnError) {
      throw error;
    }
    return null;
  }
}

interface DAGWorkflow {
  (definition: DAGDefinition | DAGJob, options?: DAGWorkflowOptions): WorkflowExecutable;
}

/**
 * Type guard to check if the definition is a DAGJob
 */
function isDAGJob(definition: DAGDefinition | DAGJob): definition is DAGJob {
  const firstValue = Object.values(definition)[0];
  return firstValue && typeof firstValue === "object" && "steps" in firstValue;
}

export const dagWorkflow: DAGWorkflow = (
  definition: DAGDefinition | DAGJob,
  options: DAGWorkflowOptions = {},
) => {
  const prepare = async (
    definition: DAGDefinition | DAGJob,
    context: { tracer?: TracingContext },
  ): Promise<DAGDefinition> => {
    if (isDAGJob(definition)) {
      return await DAGJobToDefinition.convert(definition, context);
    }
    return definition;
  };

  const execute = async (context: {
    provider: AIProvider;
    variables: Record<string, any>;
    options?: ProgramOptions;
    stats?: Stats;
    tracer?: TracingContext;
  }): Promise<WorkflowResult> => {
    const { stats, tracer } = context;
    const { maxConcurrency = 3 } = options;

    const dagSpan = tracer?.startSpan("dag", { type: "workflow" });

    try {
      const dagDefinition = await prepare(definition, { tracer: dagSpan });
      dagSpan?.debug(JSON.stringify(dagDefinition, null, 2));
      const executionPlan = DAGParser.parse(dagDefinition);
      const nodeResults = new Map<string, any>();

      dagSpan?.setAttribute("stages", executionPlan.stages.length);

      for (const [stageIndex, stage] of executionPlan.stages.entries()) {
        const stageSpan = dagSpan?.startSpan(`stage-${stageIndex + 1}`, { type: "internal" });
        stageSpan?.setAttribute("nodes", stage.join(", "));

        const concurrencyLimit = Math.min(stage.length, maxConcurrency);

        for (let i = 0; i < stage.length; i += concurrencyLimit) {
          const batch = stage.slice(i, i + concurrencyLimit);

          const results = await Promise.all(
            batch.map(async (nodeId) => {
              const result = await executeNode(
                nodeId,
                executionPlan,
                { ...context, tracer: stageSpan },
                options,
              );
              return { nodeId, result };
            }),
          );

          results.forEach(({ nodeId, result }) => {
            nodeResults.set(nodeId, result);
          });
        }

        stageSpan?.end();
      }

      dagSpan?.end();

      const dagResult = Object.fromEntries(nodeResults);
      return createResult(dagResult, stats);
    } catch (error) {
      const axleError =
        error instanceof AxleError
          ? error
          : new AxleError(`DAG workflow execution failed`, {
              cause: error instanceof Error ? error : new Error(String(error)),
            });

      dagSpan?.error(axleError.message);
      dagSpan?.end("error");

      return createErrorResult(axleError, null, stats);
    }
  };

  return { execute };
};
