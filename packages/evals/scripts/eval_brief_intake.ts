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

type ClarificationRequest = {
  id: string;
  question: string;
  category: "security" | "architecture" | "features" | "ux";
  impact: "high" | "medium" | "low";
  defaultAssumption: string;
};

const CATEGORY_ORDER: Record<ClarificationRequest["category"], number> = {
  security: 0,
  architecture: 1,
  features: 2,
  ux: 3,
};

function ensureDir(pathValue: string): void {
  if (!existsSync(pathValue)) {
    mkdirSync(pathValue, { recursive: true });
  }
}

function loadFixture(pathValue: string): unknown {
  return JSON.parse(readFileSync(pathValue, "utf8"));
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

function hasStructuredBrief(value: any): boolean {
  const structuredBrief = value?.structuredBrief;
  return Boolean(
    structuredBrief &&
      typeof structuredBrief.projectName === "string" &&
      structuredBrief.projectName.length > 0 &&
      structuredBrief.techStack &&
      typeof structuredBrief.techStack.language === "string" &&
      structuredBrief.techStack.language.length > 0 &&
      typeof structuredBrief.techStack.framework === "string" &&
      structuredBrief.techStack.framework.length > 0 &&
      Array.isArray(structuredBrief.features) &&
      Array.isArray(structuredBrief.constraints) &&
      Array.isArray(structuredBrief.userStories),
  );
}

function hasValidQuestionShape(question: ClarificationRequest): boolean {
  return (
    typeof question.id === "string" &&
    question.id.length > 0 &&
    typeof question.question === "string" &&
    question.question.length > 0 &&
    ["security", "architecture", "features", "ux"].includes(question.category) &&
    ["high", "medium", "low"].includes(question.impact) &&
    typeof question.defaultAssumption === "string" &&
    question.defaultAssumption.length > 0
  );
}

function isPriorityOrdered(questions: ClarificationRequest[]): boolean {
  for (let index = 1; index < questions.length; index += 1) {
    if (CATEGORY_ORDER[questions[index - 1].category] > CATEGORY_ORDER[questions[index].category]) {
      return false;
    }
  }
  return true;
}

function hasValidScopeEstimate(value: any): boolean {
  const scopeEstimate = value?.scopeEstimate;
  return Boolean(
    scopeEstimate &&
      Array.isArray(scopeEstimate.sprintCountRange) &&
      scopeEstimate.sprintCountRange.length === 2 &&
      scopeEstimate.sprintCountRange.every((entry: unknown) => Number.isInteger(entry)) &&
      ["low", "medium", "high"].includes(scopeEstimate.complexityRating),
  );
}

function fatal(message: string): never {
  console.log(JSON.stringify({ event: "eval_brief_intake.done", ok: false, error: message }));
  process.exit(1);
}

function runAgent(cliPath: string, repoRoot: string, input: unknown): { exitCode: number | null; parsed: any; stderr: string } {
  const completed = spawnSync(
    process.execPath,
    [cliPath, "agent:run", "brief-intake", "--input", JSON.stringify(input), "--validate-input"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  if (completed.error) {
    fatal(completed.error.message);
  }

  try {
    return {
      exitCode: completed.status,
      parsed: parseStdoutJson(completed.stdout ?? ""),
      stderr: (completed.stderr ?? "").trim(),
    };
  } catch (error) {
    fatal(`unable to parse CLI JSON output: ${(error as Error).message}`);
  }
}

async function main(): Promise<void> {
  const suiteName = "eval_brief_intake";
  const repoRoot = resolve(process.cwd(), "..", "..");
  const cliPath = resolve(repoRoot, "packages", "factory", "dist", "cli.js");
  if (!existsSync(cliPath)) {
    fatal(`missing built CLI file: ${cliPath}. Did you run: pnpm -r build ?`);
  }

  const ambiguousFixture = loadFixture(resolve(process.cwd(), "fixtures", "brief-intake", "ambiguous-brief.json"));
  const completeFixture = loadFixture(resolve(process.cwd(), "fixtures", "brief-intake", "complete-brief.json"));

  const ambiguousRun = runAgent(cliPath, repoRoot, ambiguousFixture);
  const completeRun = runAgent(cliPath, repoRoot, completeFixture);

  const ambiguousData = ambiguousRun.parsed?.result?.data;
  const completeData = completeRun.parsed?.result?.data;
  const ambiguousQuestions = Array.isArray(ambiguousData?.clarifyingQuestions)
    ? (ambiguousData.clarifyingQuestions as ClarificationRequest[])
    : [];
  const completeQuestions = Array.isArray(completeData?.clarifyingQuestions)
    ? (completeData.clarifyingQuestions as ClarificationRequest[])
    : [];

  const results: CheckResult[] = [
    {
      id: "ambiguous-agent-run-ok",
      passed: ambiguousRun.exitCode === 0 && ambiguousRun.parsed?.ok === true && ambiguousRun.parsed?.result?.ok === true,
      details: { exitCode: ambiguousRun.exitCode },
      ...(ambiguousRun.exitCode === 0 && ambiguousRun.parsed?.ok === true && ambiguousRun.parsed?.result?.ok === true
        ? {}
        : { error: ambiguousRun.stderr || "ambiguous fixture run failed" }),
    },
    {
      id: "ambiguous-structured-brief",
      passed: hasStructuredBrief(ambiguousData),
      ...(hasStructuredBrief(ambiguousData) ? {} : { error: "ambiguous fixture missing structuredBrief fields" }),
    },
    {
      id: "ambiguous-question-count",
      passed: ambiguousQuestions.length >= 1 && ambiguousQuestions.length <= 5,
      details: { questionCount: ambiguousQuestions.length },
      ...(ambiguousQuestions.length >= 1 && ambiguousQuestions.length <= 5
        ? {}
        : { error: `expected 1-5 questions, got ${ambiguousQuestions.length}` }),
    },
    {
      id: "ambiguous-question-shape",
      passed: ambiguousQuestions.every(hasValidQuestionShape),
      ...(ambiguousQuestions.every(hasValidQuestionShape) ? {} : { error: "ambiguous fixture returned malformed question objects" }),
    },
    {
      id: "ambiguous-question-order",
      passed: isPriorityOrdered(ambiguousQuestions),
      ...(isPriorityOrdered(ambiguousQuestions) ? {} : { error: "ambiguous fixture questions are not ordered by category priority" }),
    },
    {
      id: "complete-agent-run-ok",
      passed: completeRun.exitCode === 0 && completeRun.parsed?.ok === true && completeRun.parsed?.result?.ok === true,
      details: { exitCode: completeRun.exitCode },
      ...(completeRun.exitCode === 0 && completeRun.parsed?.ok === true && completeRun.parsed?.result?.ok === true
        ? {}
        : { error: completeRun.stderr || "complete fixture run failed" }),
    },
    {
      id: "complete-structured-brief",
      passed: hasStructuredBrief(completeData),
      ...(hasStructuredBrief(completeData) ? {} : { error: "complete fixture missing structuredBrief fields" }),
    },
    {
      id: "complete-question-count",
      passed: completeQuestions.length === 0,
      details: { questionCount: completeQuestions.length },
      ...(completeQuestions.length === 0 ? {} : { error: `expected 0 questions, got ${completeQuestions.length}` }),
    },
    {
      id: "complete-scope-estimate",
      passed: hasValidScopeEstimate(completeData),
      ...(hasValidScopeEstimate(completeData) ? {} : { error: "complete fixture missing valid scopeEstimate" }),
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
  const outPath = resolve(reportsDir, "eval_brief_intake.latest.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ event: "eval_brief_intake.done", ok: report.passRate === 1, outPath, passRate: report.passRate }));

  if (report.passRate !== 1) {
    process.exit(2);
  }
}

main().catch((error) => fatal((error as Error).message));
