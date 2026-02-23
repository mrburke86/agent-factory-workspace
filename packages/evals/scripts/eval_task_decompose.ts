import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type CheckResult = {
  id: string;
  passed: boolean;
  details?: unknown;
  error?: string;
};

type Report = {
  suiteName: string;
  passRate: number;
  count: number;
  results: CheckResult[];
};

type TaskComplexity = "S" | "M" | "L";

type DecomposedTask = {
  id: string;
  title: string;
  description: string;
  dependsOn: string[];
  fileScope: string[];
  estimatedComplexity: TaskComplexity;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function ensureDir(pathValue: string): void {
  if (!existsSync(pathValue)) {
    mkdirSync(pathValue, { recursive: true });
  }
}

function parseStdoutJson(stdout: string): any {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lastLine = lines[lines.length - 1];
  if (!lastLine) {
    throw new Error("no JSON output from CLI");
  }
  return JSON.parse(lastLine);
}

function loadFixture(pathValue: string): unknown {
  return JSON.parse(readFileSync(pathValue, "utf8"));
}

function expectedComplexity(fileCount: number): TaskComplexity {
  if (fileCount <= 1) return "S";
  if (fileCount <= 3) return "M";
  return "L";
}

function hasCycle(tasks: DecomposedTask[]): boolean {
  const status = new Map<string, "visiting" | "visited">();
  const idToTask = new Map(tasks.map((task) => [task.id, task]));

  const dfs = (taskId: string): boolean => {
    const existing = status.get(taskId);
    if (existing === "visiting") return true;
    if (existing === "visited") return false;

    status.set(taskId, "visiting");
    const task = idToTask.get(taskId);
    if (task) {
      for (const dep of task.dependsOn) {
        if (dfs(dep)) return true;
      }
    }
    status.set(taskId, "visited");
    return false;
  };

  for (const task of tasks) {
    if (dfs(task.id)) return true;
  }
  return false;
}

function isTopologicallyOrdered(tasks: DecomposedTask[]): boolean {
  const indexById = new Map<string, number>();
  tasks.forEach((task, index) => indexById.set(task.id, index));
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      const depIndex = indexById.get(dep);
      const taskIndex = indexById.get(task.id);
      if (depIndex === undefined || taskIndex === undefined || depIndex >= taskIndex) {
        return false;
      }
    }
  }
  return true;
}

function validateTaskShape(task: DecomposedTask): string[] {
  const errors: string[] = [];
  if (typeof task.id !== "string" || task.id.trim().length === 0) {
    errors.push("id must be a non-empty string");
  }
  if (typeof task.title !== "string" || task.title.trim().length === 0) {
    errors.push("title must be a non-empty string");
  }
  if (typeof task.description !== "string" || task.description.trim().length === 0) {
    errors.push("description must be a non-empty string");
  }
  if (!Array.isArray(task.dependsOn) || task.dependsOn.some((dep) => typeof dep !== "string" || dep.trim().length === 0)) {
    errors.push("dependsOn must be a string[]");
  }
  if (!Array.isArray(task.fileScope) || task.fileScope.length === 0) {
    errors.push("fileScope must be a non-empty array");
  }
  if (Array.isArray(task.fileScope) && (task.fileScope.length < 1 || task.fileScope.length > 3)) {
    errors.push("fileScope length must be between 1 and 3");
  }
  if (!["S", "M", "L"].includes(task.estimatedComplexity)) {
    errors.push("estimatedComplexity must be S|M|L");
  }
  if (Array.isArray(task.fileScope) && ["S", "M", "L"].includes(task.estimatedComplexity)) {
    const expected = expectedComplexity(task.fileScope.length);
    if (task.estimatedComplexity !== expected) {
      errors.push(`estimatedComplexity mismatch: expected ${expected}, got ${task.estimatedComplexity}`);
    }
  }
  return errors;
}

async function main(): Promise<void> {
  const suiteName = "eval_task_decompose";
  const repoRoot = resolve(process.cwd(), "..", "..");
  const cliPath = resolve(repoRoot, "packages", "factory", "dist", "cli.js");
  if (!existsSync(cliPath)) {
    fail(`missing built CLI file: ${cliPath}. Did you run: pnpm -r build ?`);
  }

  const fixturePath = resolve(process.cwd(), "fixtures", "task-decompose", "health-endpoint.json");
  const fixtureInput = loadFixture(fixturePath);
  const completed = spawnSync(
    process.execPath,
    [cliPath, "agent:run", "task-decompose", "--input", JSON.stringify(fixtureInput), "--validate-input"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  if (completed.error) {
    fail(completed.error.message);
  }

  let parsed: any;
  try {
    parsed = parseStdoutJson(completed.stdout ?? "");
  } catch (error) {
    fail(`unable to parse CLI JSON output: ${(error as Error).message}`);
  }

  const tasks = Array.isArray(parsed?.result?.data?.tasks) ? (parsed.result.data.tasks as DecomposedTask[]) : [];
  const taskIds = new Set(tasks.map((task) => task.id));
  const unknownDeps = tasks.flatMap((task) => task.dependsOn.filter((dep) => !taskIds.has(dep)).map((dep) => ({ taskId: task.id, dep })));
  const perTaskErrors = tasks.flatMap((task) => validateTaskShape(task).map((message) => ({ taskId: task.id, message })));

  const results: CheckResult[] = [
    {
      id: "agent-run-ok",
      passed: completed.status === 0 && parsed?.ok === true && parsed?.result?.ok === true,
      details: {
        exitCode: completed.status,
      },
      ...(completed.status === 0 && parsed?.ok === true && parsed?.result?.ok === true
        ? {}
        : { error: (completed.stderr || "task-decompose run failed").trim() || "task-decompose run failed" }),
    },
    {
      id: "tasks-count-range",
      passed: tasks.length >= 3 && tasks.length <= 15,
      details: {
        taskCount: tasks.length,
      },
      ...(tasks.length >= 3 && tasks.length <= 15 ? {} : { error: `tasks count must be between 3 and 15, got ${tasks.length}` }),
    },
    {
      id: "task-structure",
      passed: perTaskErrors.length === 0,
      details: {
        perTaskErrors,
      },
      ...(perTaskErrors.length === 0 ? {} : { error: "one or more tasks failed structural validation checks" }),
    },
    {
      id: "dependencies-exist",
      passed: unknownDeps.length === 0,
      details: {
        unknownDeps,
      },
      ...(unknownDeps.length === 0 ? {} : { error: "tasks reference unknown dependencies" }),
    },
    {
      id: "no-circular-dependencies",
      passed: !hasCycle(tasks),
      ...(hasCycle(tasks) ? { error: "detected cycle in task dependency graph" } : {}),
    },
    {
      id: "topological-order",
      passed: isTopologicallyOrdered(tasks),
      ...(isTopologicallyOrdered(tasks) ? {} : { error: "tasks are not in topological order" }),
    },
  ];

  const passedCount = results.filter((result) => result.passed).length;
  const report: Report = {
    suiteName,
    passRate: results.length === 0 ? 0 : passedCount / results.length,
    count: results.length,
    results,
  };

  const reportsDir = resolve(process.cwd(), ".reports");
  ensureDir(reportsDir);

  const outPath = resolve(reportsDir, "eval_task_decompose.latest.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ event: "eval_task_decompose.done", outPath, passRate: report.passRate }));

  if (report.passRate !== 1) {
    process.exit(2);
  }
}

main().catch((error) => fail((error as Error).message));
