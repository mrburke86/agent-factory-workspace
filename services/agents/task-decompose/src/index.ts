import { msBetween, nowIso, type AgentResult } from "@acme/agent-runtime";
import {
  DecomposedTaskListSchema,
  TaskDecomposeInputSchema,
  type DecomposedTask,
  type DecomposedTaskList,
  type TaskComplexity,
  type TaskDecomposeInput,
} from "@acme/contracts";

const AGENT_NAME = "task-decompose";
const MIN_TASK_COUNT = 3;
const MAX_TASK_COUNT = 15;
const MIN_FILES_PER_TASK = 1;
const MAX_FILES_PER_TASK = 3;
const ENDPOINT_PATTERN = /\/[a-z0-9/_-]*/i;

class TaskDecomposeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type DraftTask = {
  id: string;
  title: string;
  description: string;
  dependsOn: string[];
  fileScope: string[];
};

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/").replace(/\/+$/, "").trim();
}

function sanitizeSegment(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "feature";
}

function extractEndpointSlug(projectBrief: string): string {
  const match = projectBrief.match(ENDPOINT_PATTERN)?.[0] ?? "";
  const normalized = match.replace(/^\/+/, "");
  const firstSegment = normalized.split("/").filter((segment) => segment.length > 0)[0] ?? "";
  return sanitizeSegment(firstSegment || "feature");
}

function parseMaxTasks(constraints: string[] | undefined): number | undefined {
  if (!Array.isArray(constraints)) return undefined;

  for (const constraint of constraints) {
    const match = constraint.trim().toLowerCase().match(/^max-tasks:(\d+)$/);
    if (!match) continue;
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function shouldExcludeDocs(constraints: string[] | undefined): boolean {
  if (!Array.isArray(constraints)) return false;
  return constraints
    .map((entry) => entry.trim().toLowerCase())
    .some((entry) => entry === "no-docs" || entry === "omit-docs");
}

function getFileExtension(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (normalized.includes("typescript")) return "ts";
  if (normalized.includes("javascript")) return "js";
  if (normalized.includes("python")) return "py";
  return "ts";
}

function estimateComplexity(fileScope: string[]): TaskComplexity {
  const fileCount = fileScope.length;
  if (fileCount <= 1) return "S";
  if (fileCount <= 3) return "M";
  return "L";
}

function buildExpressTasks(endpointSlug: string, extension: string): DraftTask[] {
  return [
    {
      id: "task-1-setup-routing",
      title: "Wire route registration",
      description: `Prepare Express route wiring for /${endpointSlug} endpoint.`,
      dependsOn: [],
      fileScope: [`src/server.${extension}`, `src/routes/index.${extension}`],
    },
    {
      id: "task-2-implement-handler",
      title: "Implement endpoint handler",
      description: `Implement /${endpointSlug} route handler and service logic.`,
      dependsOn: ["task-1-setup-routing"],
      fileScope: [
        `src/routes/${endpointSlug}.${extension}`,
        `src/controllers/${endpointSlug}-controller.${extension}`,
        `src/services/${endpointSlug}-service.${extension}`,
      ],
    },
    {
      id: "task-3-add-tests",
      title: "Add endpoint tests",
      description: `Add integration tests for /${endpointSlug} endpoint behavior.`,
      dependsOn: ["task-2-implement-handler"],
      fileScope: [`test/${endpointSlug}.test.${extension}`],
    },
    {
      id: "task-4-update-docs",
      title: "Update API documentation",
      description: `Document /${endpointSlug} endpoint contract and expected responses.`,
      dependsOn: ["task-2-implement-handler"],
      fileScope: ["README.md"],
    },
  ];
}

function buildNextTasks(endpointSlug: string, extension: string): DraftTask[] {
  return [
    {
      id: "task-1-create-route-scaffold",
      title: "Create route scaffold",
      description: `Create Next.js route structure for /${endpointSlug} API endpoint.`,
      dependsOn: [],
      fileScope: [`src/app/api/${endpointSlug}/route.${extension}`],
    },
    {
      id: "task-2-implement-route-logic",
      title: "Implement route logic",
      description: `Implement /${endpointSlug} response logic and status payload.`,
      dependsOn: ["task-1-create-route-scaffold"],
      fileScope: [
        `src/app/api/${endpointSlug}/route.${extension}`,
        `src/lib/${endpointSlug}-service.${extension}`,
      ],
    },
    {
      id: "task-3-add-route-tests",
      title: "Add route tests",
      description: `Add tests for /${endpointSlug} API endpoint response behavior.`,
      dependsOn: ["task-2-implement-route-logic"],
      fileScope: [`test/${endpointSlug}.test.${extension}`],
    },
    {
      id: "task-4-update-docs",
      title: "Update API documentation",
      description: `Document /${endpointSlug} endpoint usage and response shape.`,
      dependsOn: ["task-2-implement-route-logic"],
      fileScope: ["README.md"],
    },
  ];
}

function buildGenericTasks(endpointSlug: string, extension: string): DraftTask[] {
  return [
    {
      id: "task-1-setup-entrypoints",
      title: "Set up entrypoints",
      description: `Prepare project entrypoints for /${endpointSlug} functionality.`,
      dependsOn: [],
      fileScope: [`src/main.${extension}`],
    },
    {
      id: "task-2-implement-feature",
      title: "Implement feature logic",
      description: `Implement core logic for /${endpointSlug} objective.`,
      dependsOn: ["task-1-setup-entrypoints"],
      fileScope: [`src/features/${endpointSlug}.${extension}`, `src/features/${endpointSlug}-service.${extension}`],
    },
    {
      id: "task-3-add-tests",
      title: "Add feature tests",
      description: `Add tests validating /${endpointSlug} behavior.`,
      dependsOn: ["task-2-implement-feature"],
      fileScope: [`test/${endpointSlug}.test.${extension}`],
    },
    {
      id: "task-4-update-docs",
      title: "Update docs",
      description: `Document /${endpointSlug} implementation and usage.`,
      dependsOn: ["task-2-implement-feature"],
      fileScope: ["README.md"],
    },
  ];
}

function buildDraftTasks(input: TaskDecomposeInput): DraftTask[] {
  const endpointSlug = extractEndpointSlug(input.projectBrief);
  const extension = getFileExtension(input.techStack.language);
  const framework = input.techStack.framework.trim().toLowerCase();

  if (framework.includes("express")) {
    return buildExpressTasks(endpointSlug, extension);
  }
  if (framework.includes("next")) {
    return buildNextTasks(endpointSlug, extension);
  }
  return buildGenericTasks(endpointSlug, extension);
}

function topologicalSort(tasks: DecomposedTask[]): DecomposedTask[] {
  const idToTask = new Map<string, DecomposedTask>();
  const taskOrder = new Map<string, number>();

  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    if (idToTask.has(task.id)) {
      throw new TaskDecomposeError("INVALID_TASK_GRAPH", `duplicate task id '${task.id}'`);
    }
    idToTask.set(task.id, task);
    taskOrder.set(task.id, index);
  }

  const adjacency = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const task of tasks) {
    adjacency.set(task.id, new Set<string>());
    indegree.set(task.id, 0);
  }

  for (const task of tasks) {
    const seenDeps = new Set<string>();
    for (const dependencyId of task.dependsOn) {
      if (task.id === dependencyId) {
        throw new TaskDecomposeError("CIRCULAR_DEPENDENCY", `task '${task.id}' cannot depend on itself`);
      }
      if (!idToTask.has(dependencyId)) {
        throw new TaskDecomposeError("INVALID_TASK_GRAPH", `unknown dependency id '${dependencyId}'`);
      }
      if (seenDeps.has(dependencyId)) continue;
      seenDeps.add(dependencyId);
      adjacency.get(dependencyId)?.add(task.id);
      indegree.set(task.id, (indegree.get(task.id) ?? 0) + 1);
    }
  }

  const ready = tasks
    .filter((task) => (indegree.get(task.id) ?? 0) === 0)
    .map((task) => task.id)
    .sort((a, b) => (taskOrder.get(a) ?? 0) - (taskOrder.get(b) ?? 0));

  const sortedIds: string[] = [];
  while (ready.length > 0) {
    const currentId = ready.shift();
    if (!currentId) break;
    sortedIds.push(currentId);

    for (const dependentId of adjacency.get(currentId) ?? []) {
      const nextIndegree = (indegree.get(dependentId) ?? 0) - 1;
      indegree.set(dependentId, nextIndegree);
      if (nextIndegree === 0) {
        ready.push(dependentId);
        ready.sort((a, b) => (taskOrder.get(a) ?? 0) - (taskOrder.get(b) ?? 0));
      }
    }
  }

  if (sortedIds.length !== tasks.length) {
    throw new TaskDecomposeError("CIRCULAR_DEPENDENCY", "circular dependency detected in decomposed tasks");
  }

  return sortedIds.map((id) => idToTask.get(id)).filter((task): task is DecomposedTask => Boolean(task));
}

function enforceTaskLimits(tasks: DecomposedTask[]): void {
  if (tasks.length < MIN_TASK_COUNT || tasks.length > MAX_TASK_COUNT) {
    throw new TaskDecomposeError(
      "TASK_COUNT_OUT_OF_RANGE",
      `task count must be between ${MIN_TASK_COUNT} and ${MAX_TASK_COUNT}; received ${tasks.length}`,
    );
  }

  for (const task of tasks) {
    if (task.fileScope.length < MIN_FILES_PER_TASK || task.fileScope.length > MAX_FILES_PER_TASK) {
      throw new TaskDecomposeError(
        "TASK_GRANULARITY_OUT_OF_RANGE",
        `task '${task.id}' must target ${MIN_FILES_PER_TASK}-${MAX_FILES_PER_TASK} files`,
      );
    }
  }
}

function normalizeDraftTask(draft: DraftTask): DecomposedTask {
  const uniqueFiles = Array.from(new Set(draft.fileScope.map(normalizePath).filter((pathValue) => pathValue.length > 0)));
  const uniqueDeps = Array.from(new Set(draft.dependsOn.map((id) => id.trim()).filter((id) => id.length > 0)));
  const task: DecomposedTask = {
    id: draft.id.trim(),
    title: draft.title.trim(),
    description: draft.description.trim(),
    dependsOn: uniqueDeps,
    fileScope: uniqueFiles,
    estimatedComplexity: estimateComplexity(uniqueFiles),
  };
  return task;
}

function applyConstraintFilters(tasks: DraftTask[], constraints: string[] | undefined): DraftTask[] {
  const maxTasks = parseMaxTasks(constraints);
  if (maxTasks !== undefined && (maxTasks < MIN_TASK_COUNT || maxTasks > MAX_TASK_COUNT)) {
    throw new TaskDecomposeError(
      "TASK_COUNT_OUT_OF_RANGE",
      `max-tasks constraint must be between ${MIN_TASK_COUNT} and ${MAX_TASK_COUNT}; received ${maxTasks}`,
    );
  }

  let result = shouldExcludeDocs(constraints)
    ? tasks.filter((task) => task.id !== "task-4-update-docs")
    : [...tasks];

  if (maxTasks !== undefined) {
    result = result.slice(0, maxTasks);
  }

  return result;
}

async function runImpl(input: TaskDecomposeInput): Promise<DecomposedTaskList> {
  const parsed = TaskDecomposeInputSchema.parse(input);
  const draftTasks = applyConstraintFilters(buildDraftTasks(parsed), parsed.constraints);
  const normalizedTasks = draftTasks.map(normalizeDraftTask);
  const orderedTasks = topologicalSort(normalizedTasks);
  enforceTaskLimits(orderedTasks);
  return DecomposedTaskListSchema.parse({ tasks: orderedTasks });
}

function toErrorInfo(error: unknown): { code: string; message: string } {
  if (error instanceof TaskDecomposeError) {
    return {
      code: error.code,
      message: error.message,
    };
  }
  if (error instanceof Error) {
    return {
      code: "UNHANDLED",
      message: error.message,
    };
  }
  return {
    code: "UNHANDLED",
    message: String(error),
  };
}

export async function run(input: TaskDecomposeInput): Promise<AgentResult<DecomposedTaskList>> {
  const startedAt = nowIso();
  const startedMs = Date.now();
  try {
    const data = await runImpl(input);
    const endedMs = Date.now();
    return {
      ok: true,
      agent: AGENT_NAME,
      startedAt,
      finishedAt: nowIso(),
      ms: msBetween(startedMs, endedMs),
      errors: [],
      data,
    };
  } catch (error) {
    const endedMs = Date.now();
    const errorInfo = toErrorInfo(error);
    return {
      ok: false,
      agent: AGENT_NAME,
      startedAt,
      finishedAt: nowIso(),
      ms: msBetween(startedMs, endedMs),
      errors: [
        {
          code: errorInfo.code,
          message: errorInfo.message,
        },
      ],
    };
  }
}
