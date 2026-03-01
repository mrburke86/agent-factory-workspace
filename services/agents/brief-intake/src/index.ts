import { msBetween, nowIso, type AgentResult } from "@acme/agent-runtime";
import {
  BriefIntakeInputSchema,
  BriefIntakeOutputSchema,
  type BriefIntakeInput,
  type BriefIntakeOutput,
  type ClarificationRequest,
  type ScopeEstimate,
  type StructuredBrief,
} from "@acme/contracts";

const AGENT_NAME = "brief-intake";
const PRIORITY_ORDER = {
  security: 0,
  architecture: 1,
  features: 2,
  ux: 3,
} as const;
const IMPACT_ORDER = {
  high: 0,
  medium: 1,
  low: 2,
} as const;

class BriefIntakeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sentenceCase(value: string): string {
  const normalized = normalizeSpace(value).replace(/[.]+$/g, "");
  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function uniqueList(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeSpace(value)).filter((value) => value.length > 0)));
}

function inferTechStack(brief: string): StructuredBrief["techStack"] {
  const lower = brief.toLowerCase();
  const techStack: StructuredBrief["techStack"] = {
    language: "unspecified",
    framework: "unspecified",
  };

  if (lower.includes("next.js") || lower.includes("nextjs")) {
    techStack.language = "typescript";
    techStack.framework = "next.js";
  } else if (lower.includes("react")) {
    techStack.language = "typescript";
    techStack.framework = "react";
  } else if (lower.includes("express")) {
    techStack.language = "typescript";
    techStack.framework = "express";
  } else if (lower.includes("flask")) {
    techStack.language = "python";
    techStack.framework = "flask";
  } else if (lower.includes("django")) {
    techStack.language = "python";
    techStack.framework = "django";
  } else if (lower.includes("python")) {
    techStack.language = "python";
    techStack.framework = "custom";
  } else if (lower.includes("node")) {
    techStack.language = "javascript";
    techStack.framework = "node";
  }

  if (lower.includes("postgresql") || lower.includes("postgres")) {
    techStack.database = "postgresql";
  } else if (lower.includes("mysql")) {
    techStack.database = "mysql";
  } else if (lower.includes("sqlite")) {
    techStack.database = "sqlite";
  } else if (lower.includes("mongodb") || lower.includes("mongo")) {
    techStack.database = "mongodb";
  }

  if (lower.includes("nextauth")) {
    techStack.auth = "nextauth";
  } else if (lower.includes("auth0")) {
    techStack.auth = "auth0";
  } else if (lower.includes("oauth")) {
    techStack.auth = "oauth";
  } else if (lower.includes("jwt")) {
    techStack.auth = "jwt";
  }

  if (lower.includes("stripe")) {
    techStack.payments = "stripe";
  } else if (lower.includes("paypal")) {
    techStack.payments = "paypal";
  }

  return techStack;
}

function extractCrudFeatures(brief: string): string[] {
  const match = brief.match(/create,\s*read,\s*update,\s*and\s*delete\s+([^.]+?)(?:[.?!]|$)/i);
  if (!match) return [];
  const target = normalizeSpace(match[1]).replace(/^the\s+/i, "");
  if (!target) return [];
  return ["create", "read", "update", "delete"].map((action) => `${action} ${target}`);
}

function extractFeatures(brief: string): string[] {
  const lower = brief.toLowerCase();
  const features: string[] = [];

  features.push(...extractCrudFeatures(brief));

  if (lower.includes("track") && lower.includes("expense")) {
    features.push("track expenses");
  }
  if (lower.includes("share") && lower.includes("report")) {
    features.push("share reports");
  }
  if (lower.includes("report") && lower.includes("friend")) {
    features.push("share reports with friends");
  }

  if (features.length === 0) {
    const capabilityMatch = brief.match(/(?:where\s+users\s+can|users\s+can)\s+([^.]+?)(?:[.?!]|$)/i);
    if (capabilityMatch) {
      features.push(sentenceCase(capabilityMatch[1]).toLowerCase());
    }
  }

  return uniqueList(
    features.map((feature) => feature.replace(/^users?\s+can\s+/i, "").replace(/^to\s+/i, "").replace(/[.]+$/g, "")),
  );
}

function extractConstraints(brief: string): string[] {
  const matches = Array.from(brief.matchAll(/\b(no [^.?!]+?)(?:[.?!]|$)/gi)).map((match) => normalizeSpace(match[1]));
  return uniqueList(matches);
}

function deriveProjectName(brief: string, features: string[], techStack: StructuredBrief["techStack"]): string {
  const explicitName = brief.match(/(?:called|named)\s+["']?([^"'.!?]+)["']?/i)?.[1];
  if (explicitName) {
    return sentenceCase(explicitName);
  }

  const lower = brief.toLowerCase();
  if (lower.includes("expense")) return "Expense tracker";
  if (lower.includes("todo")) return "Todo app";
  if (features.length > 0) {
    const anchor = features[0].replace(/^create |^read |^update |^delete /, "");
    return sentenceCase(anchor) || "Requested app";
  }
  if (techStack.framework !== "unspecified") {
    return sentenceCase(`${techStack.framework} app`);
  }
  return "Requested app";
}

function buildUserStories(features: string[]): string[] {
  return uniqueList(features.map((feature) => `As a user, I want to ${feature}.`));
}

function buildQuestions(brief: string, techStack: StructuredBrief["techStack"], features: string[]): ClarificationRequest[] {
  const lower = brief.toLowerCase();
  const questions: ClarificationRequest[] = [];
  const hasUsers = /\busers?\b/.test(lower);
  const hasSharing = lower.includes("share");
  const impliesPersistence =
    features.some((feature) =>
      ["track", "create", "update", "delete", "expense", "todo", "report"].some((token) => feature.includes(token)),
    ) || /\b(track|save|store|create|update|delete)\b/.test(lower);
  const hasDeployment = /\b(deploy to|deployed to|host on|vercel|netlify|aws|azure|gcp)\b/.test(lower);
  const hasUxDirection = /\b(web app|mobile app|ios|android|tailwind|css|responsive|ui|ux|interface)\b/.test(lower);
  const hasDetailedReports = /\b(pdf|csv|dashboard|summary|chart|analytics)\b/.test(lower);

  if ((hasUsers || hasSharing) && !techStack.auth) {
    questions.push({
      id: "security-auth-strategy",
      question: "What authentication or account-sharing strategy should the app use?",
      category: "security",
      impact: "high",
      defaultAssumption: "Assume authentication is required but the provider will be chosen later.",
    });
  }

  if (impliesPersistence && !techStack.database) {
    questions.push({
      id: "architecture-data-store",
      question: "Which database or persistence layer should store the app data?",
      category: "architecture",
      impact: "high",
      defaultAssumption: "Assume a relational database will be selected during implementation planning.",
    });
  }

  if (!hasDeployment) {
    questions.push({
      id: "architecture-deployment-target",
      question: "What deployment target should this project use?",
      category: "architecture",
      impact: "medium",
      defaultAssumption: "Assume deployment remains undecided until platform constraints are clarified.",
    });
  }

  if (lower.includes("report") && !hasDetailedReports) {
    questions.push({
      id: "features-report-detail",
      question: "What report format or detail level should be shared with users?",
      category: "features",
      impact: "medium",
      defaultAssumption: "Assume reports are simple summary views until a richer format is requested.",
    });
  }

  if (/\bapp\b/.test(lower) && !hasUxDirection) {
    questions.push({
      id: "ux-primary-surface",
      question: "Should this be a web app or a mobile-first experience?",
      category: "ux",
      impact: "low",
      defaultAssumption: "Assume a responsive web app unless a mobile-first requirement is added.",
    });
  }

  questions.sort((left, right) => {
    const categoryDelta = PRIORITY_ORDER[left.category] - PRIORITY_ORDER[right.category];
    if (categoryDelta !== 0) return categoryDelta;
    return IMPACT_ORDER[left.impact] - IMPACT_ORDER[right.impact];
  });

  return questions.slice(0, 5);
}

function estimateScope(techStack: StructuredBrief["techStack"], features: string[], clarifyingQuestions: ClarificationRequest[]): ScopeEstimate {
  const featureCount = Math.max(features.length, 1);
  const sprintCountRange: ScopeEstimate["sprintCountRange"] =
    featureCount <= 3 ? [1, 2] : featureCount <= 7 ? [2, 4] : [4, 8];

  let score = 0;
  if (featureCount >= 4) score += 1;
  if (featureCount >= 8) score += 1;
  if (techStack.database) score += 2;
  if (techStack.auth) score += 2;
  if (techStack.payments) score += 2;
  if (clarifyingQuestions.length >= 2) score += 1;
  if (techStack.framework === "unspecified") score += 1;

  const complexityRating = score <= 2 ? "low" : score <= 5 ? "medium" : "high";
  return {
    sprintCountRange,
    complexityRating,
  };
}

async function runImpl(input: BriefIntakeInput): Promise<BriefIntakeOutput> {
  const parsed = BriefIntakeInputSchema.parse(input);
  const techStack = inferTechStack(parsed.brief);
  const features = extractFeatures(parsed.brief);
  const constraints = extractConstraints(parsed.brief);
  const structuredBrief: StructuredBrief = {
    projectName: deriveProjectName(parsed.brief, features, techStack),
    techStack,
    features,
    constraints,
    userStories: buildUserStories(features),
  };
  const clarifyingQuestions = buildQuestions(parsed.brief, structuredBrief.techStack, structuredBrief.features);
  const output: BriefIntakeOutput = {
    structuredBrief,
    clarifyingQuestions,
    resolvedAssumptions: clarifyingQuestions.map((question) => question.defaultAssumption),
    scopeEstimate: estimateScope(structuredBrief.techStack, structuredBrief.features, clarifyingQuestions),
  };
  return BriefIntakeOutputSchema.parse(output);
}

function toErrorInfo(error: unknown): { code: string; message: string } {
  if (error instanceof BriefIntakeError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: "UNHANDLED", message: error.message };
  }
  return { code: "UNHANDLED", message: String(error) };
}

export async function run(input: BriefIntakeInput): Promise<AgentResult<BriefIntakeOutput>> {
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
