import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { ContextGatherInputSchema, type ContextGatherInput, type ContextGatherOutput, type RankedFile } from "@acme/contracts";
import { wrap, type AgentResult } from "@acme/agent-runtime";

type IgnoreRule = {
  negated: boolean;
  directoryOnly: boolean;
  pattern: string;
};

type FileRecord = {
  path: string;
  sizeBytes: number;
  content?: string;
};

const AGENT_NAME = "context-gather";
const DEFAULT_MAX_FILES = 20;
const MAX_DIRECTORY_DISTANCE = 8;
const SCORING_WEIGHTS = {
  filename: 0.4,
  directory: 0.3,
  importGraph: 0.3,
} as const;

const SKIP_DIRECTORIES = new Set(["node_modules", "dist", ".factory", ".git"]);
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const IMPORT_SPECIFIER_PATTERN =
  /(?:import\s+(?:[^"'\n]+?\s+from\s+)?|export\s+[^"'\n]*?\s+from\s+|require\()\s*["']([^"']+)["']/g;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "add",
  "the",
  "for",
  "with",
  "into",
  "from",
  "that",
  "this",
  "endpoint",
]);

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
}

function normalizeKeyword(value: string): string {
  return value.toLowerCase().trim();
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "___DOUBLE_STAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DOUBLE_STAR___/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function parseIgnoreRules(repoRootAbs: string): IgnoreRule[] {
  const gitignorePath = resolve(repoRootAbs, ".gitignore");
  if (!existsSync(gitignorePath)) return [];

  let text = "";
  try {
    text = readFileSync(gitignorePath, "utf8");
  } catch {
    return [];
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const negated = line.startsWith("!");
      const rawPattern = negated ? line.slice(1).trim() : line;
      const directoryOnly = rawPattern.endsWith("/");
      const normalized = normalizePath(rawPattern.replace(/^\/+/, ""));
      return {
        negated,
        directoryOnly,
        pattern: directoryOnly ? `${normalized}/` : normalized,
      };
    })
    .filter((rule) => rule.pattern.length > 0);
}

function ignoreRuleMatches(pathValue: string, isDirectory: boolean, rule: IgnoreRule): boolean {
  const normalizedPath = normalizePath(pathValue);
  const pathSegments = normalizedPath.split("/");
  const baseName = pathSegments[pathSegments.length - 1];
  const rawRule = rule.directoryOnly ? rule.pattern.slice(0, -1) : rule.pattern;

  if (rule.directoryOnly) {
    if (isDirectory && (normalizedPath === rawRule || normalizedPath.startsWith(`${rawRule}/`))) {
      return true;
    }
    if (!isDirectory) {
      const parentDir = normalizePath(dirname(normalizedPath));
      if (parentDir === rawRule || parentDir.startsWith(`${rawRule}/`)) {
        return true;
      }
    }
  }

  if (!rawRule.includes("/") && !rawRule.includes("*")) {
    if (rule.directoryOnly) {
      return pathSegments.includes(rawRule);
    }
    return baseName === rawRule || pathSegments.includes(rawRule);
  }

  if (rawRule.includes("*")) {
    const regex = globToRegExp(rawRule);
    return regex.test(normalizedPath) || regex.test(baseName);
  }

  if (normalizedPath === rawRule) return true;
  return normalizedPath.startsWith(`${rawRule}/`);
}

function isIgnored(pathValue: string, isDirectory: boolean, rules: IgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (!ignoreRuleMatches(pathValue, isDirectory, rule)) continue;
    ignored = !rule.negated;
  }
  return ignored;
}

function readText(fileAbsPath: string): string | undefined {
  try {
    return readFileSync(fileAbsPath, "utf8");
  } catch {
    return undefined;
  }
}

function fileSummary(filePath: string, content?: string): string {
  if (!content) return `File: ${filePath}`;
  const firstMeaningfulLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstMeaningfulLine) return `File: ${filePath}`;
  return firstMeaningfulLine.length > 140 ? `${firstMeaningfulLine.slice(0, 140)}...` : firstMeaningfulLine;
}

function extractKeywords(taskDescription: string): string[] {
  const rawTokens = taskDescription
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => normalizeKeyword(token))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
  return Array.from(new Set(rawTokens));
}

function filenameKeywordScore(filePath: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const normalizedPath = normalizePath(filePath).toLowerCase();
  let hits = 0;
  for (const keyword of keywords) {
    if (normalizedPath.includes(keyword)) {
      hits += 1;
    }
  }
  return hits / keywords.length;
}

function directoryDistance(aPath: string, bPath: string): number {
  const aSegments = normalizePath(dirname(aPath))
    .split("/")
    .filter((part) => part.length > 0);
  const bSegments = normalizePath(dirname(bPath))
    .split("/")
    .filter((part) => part.length > 0);

  let shared = 0;
  while (shared < aSegments.length && shared < bSegments.length && aSegments[shared] === bSegments[shared]) {
    shared += 1;
  }

  return (aSegments.length - shared) + (bSegments.length - shared);
}

function directoryProximityScore(filePath: string, seedFiles: string[]): number {
  if (seedFiles.length === 0) return 0;
  let minDistance = Number.POSITIVE_INFINITY;
  for (const seedPath of seedFiles) {
    const distance = directoryDistance(filePath, seedPath);
    if (distance < minDistance) minDistance = distance;
  }
  if (!Number.isFinite(minDistance)) return 0;
  return Math.max(0, 1 - minDistance / MAX_DIRECTORY_DISTANCE);
}

function parseImportSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  IMPORT_SPECIFIER_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = IMPORT_SPECIFIER_PATTERN.exec(content);
  while (match) {
    const specifier = match[1]?.trim();
    if (specifier && specifier.length > 0) {
      specifiers.push(specifier);
    }
    match = IMPORT_SPECIFIER_PATTERN.exec(content);
  }
  return specifiers;
}

function resolveImportTarget(
  sourcePath: string,
  specifier: string,
  fileSet: Set<string>,
  repoRootAbs: string,
): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const sourceDirAbs = resolve(repoRootAbs, dirname(sourcePath));
  const baseAbs = resolve(sourceDirAbs, specifier);
  const candidateAbsPaths = [
    baseAbs,
    `${baseAbs}.ts`,
    `${baseAbs}.tsx`,
    `${baseAbs}.js`,
    `${baseAbs}.jsx`,
    `${baseAbs}.mjs`,
    `${baseAbs}.cjs`,
    resolve(baseAbs, "index.ts"),
    resolve(baseAbs, "index.tsx"),
    resolve(baseAbs, "index.js"),
    resolve(baseAbs, "index.jsx"),
    resolve(baseAbs, "index.mjs"),
    resolve(baseAbs, "index.cjs"),
  ];

  for (const candidateAbsPath of candidateAbsPaths) {
    const relativePath = normalizePath(relative(repoRootAbs, candidateAbsPath));
    if (fileSet.has(relativePath)) return relativePath;
  }

  return undefined;
}

function buildImportAdjacency(files: FileRecord[], repoRootAbs: string): Map<string, Set<string>> {
  const fileSet = new Set(files.map((file) => file.path));
  const adjacency = new Map<string, Set<string>>();

  for (const file of files) {
    adjacency.set(file.path, new Set<string>());
  }

  for (const file of files) {
    if (!CODE_EXTENSIONS.has(extname(file.path).toLowerCase())) continue;
    const content = file.content;
    if (!content) continue;

    const specifiers = parseImportSpecifiers(content);
    for (const specifier of specifiers) {
      const targetPath = resolveImportTarget(file.path, specifier, fileSet, repoRootAbs);
      if (!targetPath) continue;
      adjacency.get(file.path)?.add(targetPath);
      adjacency.get(targetPath)?.add(file.path);
    }
  }

  return adjacency;
}

function importGraphScores(files: FileRecord[], seedFiles: string[], adjacency: Map<string, Set<string>>): Map<string, number> {
  const scores = new Map<string, number>();
  for (const file of files) {
    scores.set(file.path, 0);
  }

  if (seedFiles.length === 0) return scores;

  const queue: Array<{ path: string; distance: number }> = [];
  const visited = new Set<string>();

  for (const seed of seedFiles) {
    queue.push({ path: seed, distance: 0 });
    visited.add(seed);
    scores.set(seed, 1);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current.distance >= 2) continue;

    const neighbors = adjacency.get(current.path);
    if (!neighbors) continue;
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      const nextDistance = current.distance + 1;
      if (nextDistance === 1) {
        scores.set(neighbor, 0.7);
      } else if (nextDistance === 2) {
        scores.set(neighbor, 0.4);
      }
      queue.push({ path: neighbor, distance: nextDistance });
    }
  }

  return scores;
}

function collectFiles(repoRootAbs: string): FileRecord[] {
  if (!existsSync(repoRootAbs)) return [];
  const ignoreRules = parseIgnoreRules(repoRootAbs);
  const files: FileRecord[] = [];

  const walk = (dirAbs: string): void => {
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryAbs = resolve(dirAbs, entry.name);
      const relPath = normalizePath(relative(repoRootAbs, entryAbs));
      if (relPath.length === 0) continue;

      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        if (isIgnored(relPath, true, ignoreRules)) continue;
        walk(entryAbs);
        continue;
      }

      if (isIgnored(relPath, false, ignoreRules)) continue;
      let sizeBytes = 0;
      try {
        sizeBytes = statSync(entryAbs).size;
      } catch {
        sizeBytes = 0;
      }
      files.push({
        path: relPath,
        sizeBytes,
        content: readText(entryAbs),
      });
    }
  };

  walk(repoRootAbs);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function scoreFiles(files: FileRecord[], keywords: string[], repoRootAbs: string): RankedFile[] {
  const baseKeywordScores = new Map<string, number>();
  const seedFiles: string[] = [];

  for (const file of files) {
    const score = filenameKeywordScore(file.path, keywords);
    baseKeywordScores.set(file.path, score);
    if (score > 0) {
      seedFiles.push(file.path);
    }
  }

  const adjacency = buildImportAdjacency(files, repoRootAbs);
  const importScores = importGraphScores(files, seedFiles, adjacency);

  const ranked = files.map((file): RankedFile => {
    const filenameScore = baseKeywordScores.get(file.path) ?? 0;
    const directoryScore = directoryProximityScore(file.path, seedFiles);
    const importScore = importScores.get(file.path) ?? 0;
    const relevanceScore = Number(
      (
        SCORING_WEIGHTS.filename * filenameScore +
        SCORING_WEIGHTS.directory * directoryScore +
        SCORING_WEIGHTS.importGraph * importScore
      ).toFixed(6),
    );

    return {
      path: file.path,
      relevanceScore,
      summary: fileSummary(file.path, file.content),
    };
  });

  return ranked.sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
    return a.path.localeCompare(b.path);
  });
}

function estimateTokens(files: FileRecord[]): number {
  const bytes = files.reduce((total, file) => total + Math.max(0, file.sizeBytes), 0);
  return Math.ceil(bytes / 4);
}

async function runImpl(input: ContextGatherInput): Promise<ContextGatherOutput> {
  const parsed = ContextGatherInputSchema.parse(input);
  const maxFiles =
    typeof parsed.maxFiles === "number" && Number.isFinite(parsed.maxFiles)
      ? Math.max(1, Math.floor(parsed.maxFiles))
      : DEFAULT_MAX_FILES;

  const repoRootAbs = resolve(process.cwd(), parsed.repoRoot);
  const files = collectFiles(repoRootAbs);
  const keywords = extractKeywords(parsed.taskDescription);
  const rankedFiles = scoreFiles(files, keywords, repoRootAbs).slice(0, maxFiles);

  return {
    files: rankedFiles,
    tokenEstimate: estimateTokens(files),
  };
}

export async function run(input: ContextGatherInput): Promise<AgentResult<ContextGatherOutput>> {
  return wrap<ContextGatherInput, ContextGatherOutput>(AGENT_NAME, runImpl, input);
}
