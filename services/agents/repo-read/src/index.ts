import { existsSync, readdirSync, readFileSync, type Dirent } from "node:fs";
import { relative, resolve } from "node:path";
import { wrap, type AgentResult } from "@acme/agent-runtime";

type QueryType = "file-list" | "file-content" | "symbol-search" | "references";

type RepoReadQuery = {
  type: QueryType;
  pattern: string;
  scope?: string;
};

export type AgentInput = {
  repoRoot: string;
  queries: RepoReadQuery[];
};

type FileListMatch = {
  path: string;
};

type FileContentMatch = {
  path: string;
  content: string;
  lineCount: number;
};

type SymbolSearchMatch = {
  path: string;
  line: string;
  lineNumber: number;
  symbol: string;
};

type ReferenceMatch = {
  path: string;
  line: string;
  lineNumber: number;
};

type RepoReadResult = {
  queryIndex: number;
  type: QueryType;
  matches: Array<FileListMatch | FileContentMatch | SymbolSearchMatch | ReferenceMatch>;
};

export type AgentData = {
  results: RepoReadResult[];
};

type IgnoreRule = {
  negated: boolean;
  directoryOnly: boolean;
  pattern: string;
};

const AGENT_NAME = "repo-read";
const SYMBOL_DECLARATION = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
}

function sanitizeScope(scope?: string): string | undefined {
  if (!scope) return undefined;
  const normalized = normalizePath(scope.trim());
  return normalized.length === 0 ? undefined : normalized;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function pathMatchesPattern(pathValue: string, pattern: string): boolean {
  const normalizedPath = normalizePath(pathValue);
  const baseName = normalizedPath.split("/").pop() ?? normalizedPath;
  if (pattern === "*") return true;
  if (pattern.includes("*")) {
    const regex = globToRegExp(pattern);
    return regex.test(normalizedPath) || regex.test(baseName);
  }
  return normalizedPath.includes(pattern) || baseName.includes(pattern);
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
  const normalizedRule = rule.directoryOnly ? rule.pattern.slice(0, -1) : rule.pattern;
  const pathSegments = normalizedPath.split("/");
  const baseName = pathSegments[pathSegments.length - 1];

  if (rule.directoryOnly && !isDirectory) {
    if (normalizedPath === normalizedRule || normalizedPath.startsWith(`${normalizedRule}/`)) {
      return true;
    }
  }

  if (!normalizedRule.includes("/") && !normalizedRule.includes("*")) {
    if (rule.directoryOnly) {
      return pathSegments.includes(normalizedRule);
    }
    return baseName === normalizedRule || pathSegments.includes(normalizedRule);
  }

  if (normalizedRule.includes("*")) {
    const regex = globToRegExp(normalizedRule);
    if (regex.test(normalizedPath) || regex.test(baseName)) return true;
    if (rule.directoryOnly) {
      for (const segment of pathSegments) {
        if (regex.test(segment)) return true;
      }
    }
    return false;
  }

  if (normalizedPath === normalizedRule) return true;
  return normalizedPath.startsWith(`${normalizedRule}/`);
}

function isIgnored(pathValue: string, isDirectory: boolean, rules: IgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (!ignoreRuleMatches(pathValue, isDirectory, rule)) continue;
    ignored = !rule.negated;
  }
  return ignored;
}

function isPathInScope(pathValue: string, scope?: string): boolean {
  if (!scope) return true;
  return pathValue === scope || pathValue.startsWith(`${scope}/`);
}

function shouldTraverseDirectory(pathValue: string, scope?: string): boolean {
  if (!scope) return true;
  return pathValue === scope || pathValue.startsWith(`${scope}/`) || scope.startsWith(`${pathValue}/`);
}

function collectFiles(repoRootAbs: string, scope?: string): string[] {
  if (!existsSync(repoRootAbs)) return [];

  const ignoreRules = parseIgnoreRules(repoRootAbs);
  const normalizedScope = sanitizeScope(scope);
  const files: string[] = [];

  const walk = (dirAbs: string) => {
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true, encoding: "utf8" }).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryAbs = resolve(dirAbs, entry.name);
      const relPath = normalizePath(relative(repoRootAbs, entryAbs));
      if (relPath.length === 0) continue;

      if (entry.isDirectory()) {
        if (isIgnored(relPath, true, ignoreRules)) continue;
        if (!shouldTraverseDirectory(relPath, normalizedScope)) continue;
        walk(entryAbs);
        continue;
      }

      if (isIgnored(relPath, false, ignoreRules)) continue;
      if (!isPathInScope(relPath, normalizedScope)) continue;
      files.push(relPath);
    }
  };

  walk(repoRootAbs);
  return files.sort((a, b) => a.localeCompare(b));
}

function readText(pathAbs: string): string | undefined {
  try {
    return readFileSync(pathAbs, "utf8");
  } catch {
    return undefined;
  }
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === "\n") count += 1;
  }
  if (content.endsWith("\n")) count -= 1;
  return Math.max(count, 0);
}

function symbolForLine(trimmedLine: string): string {
  const match = trimmedLine.match(SYMBOL_DECLARATION);
  return match?.[1] ?? trimmedLine;
}

function comparePathLine(
  a: { path: string; lineNumber: number },
  b: { path: string; lineNumber: number },
): number {
  const pathOrder = a.path.localeCompare(b.path);
  if (pathOrder !== 0) return pathOrder;
  return a.lineNumber - b.lineNumber;
}

function buildFileListMatches(files: string[], pattern: string): FileListMatch[] {
  return files
    .filter((filePath) => pathMatchesPattern(filePath, pattern))
    .map((pathValue) => ({ path: pathValue }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function buildFileContentMatches(repoRootAbs: string, files: string[], pattern: string): FileContentMatch[] {
  const matches: FileContentMatch[] = [];
  for (const filePath of files) {
    if (!pathMatchesPattern(filePath, pattern)) continue;
    const text = readText(resolve(repoRootAbs, filePath));
    if (text === undefined) continue;
    matches.push({
      path: filePath,
      content: text,
      lineCount: countLines(text),
    });
  }
  return matches.sort((a, b) => a.path.localeCompare(b.path));
}

function buildSymbolSearchMatches(repoRootAbs: string, files: string[], pattern: string): SymbolSearchMatch[] {
  const matches: SymbolSearchMatch[] = [];
  for (const filePath of files) {
    const text = readText(resolve(repoRootAbs, filePath));
    if (text === undefined) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trimStart();
      if (!SYMBOL_DECLARATION.test(trimmed)) continue;
      if (pattern.length > 0 && !trimmed.includes(pattern)) continue;
      matches.push({
        path: filePath,
        line,
        lineNumber: i + 1,
        symbol: symbolForLine(trimmed),
      });
    }
  }
  return matches.sort(comparePathLine);
}

function buildReferenceMatches(repoRootAbs: string, files: string[], pattern: string): ReferenceMatch[] {
  const matches: ReferenceMatch[] = [];
  for (const filePath of files) {
    const text = readText(resolve(repoRootAbs, filePath));
    if (text === undefined) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trimStart();
      const isReferenceLine = trimmed.startsWith("import ") || trimmed.includes("require(");
      if (!isReferenceLine) continue;
      if (!line.includes(pattern)) continue;
      matches.push({
        path: filePath,
        line,
        lineNumber: i + 1,
      });
    }
  }
  return matches.sort(comparePathLine);
}

function buildQueryResult(
  repoRootAbs: string,
  query: RepoReadQuery,
  queryIndex: number,
  files: string[],
): RepoReadResult {
  if (query.type === "file-list") {
    return {
      queryIndex,
      type: query.type,
      matches: buildFileListMatches(files, query.pattern),
    };
  }

  if (query.type === "file-content") {
    return {
      queryIndex,
      type: query.type,
      matches: buildFileContentMatches(repoRootAbs, files, query.pattern),
    };
  }

  if (query.type === "symbol-search") {
    return {
      queryIndex,
      type: query.type,
      matches: buildSymbolSearchMatches(repoRootAbs, files, query.pattern),
    };
  }

  return {
    queryIndex,
    type: query.type,
    matches: buildReferenceMatches(repoRootAbs, files, query.pattern),
  };
}

async function runImpl(input: AgentInput): Promise<AgentData> {
  if (!input || typeof input !== "object") {
    return { results: [] };
  }

  const repoRootValue = typeof input.repoRoot === "string" ? input.repoRoot : ".";
  const queryList = Array.isArray(input.queries) ? input.queries : [];
  const repoRootAbs = resolve(process.cwd(), repoRootValue);
  const fileCache = new Map<string, string[]>();

  const readFilesForScope = (scope?: string): string[] => {
    const normalizedScope = sanitizeScope(scope);
    const cacheKey = normalizedScope ?? "__all__";
    const cached = fileCache.get(cacheKey);
    if (cached) return cached;
    const files = collectFiles(repoRootAbs, normalizedScope);
    fileCache.set(cacheKey, files);
    return files;
  };

  const results: RepoReadResult[] = [];
  for (let i = 0; i < queryList.length; i += 1) {
    const query = queryList[i];
    if (!query || typeof query !== "object") {
      continue;
    }
    const files = readFilesForScope(query.scope);
    results.push(buildQueryResult(repoRootAbs, query, i, files));
  }

  return { results };
}

export async function run(input: AgentInput): Promise<AgentResult<AgentData>> {
  return wrap<AgentInput, AgentData>(AGENT_NAME, runImpl, input);
}
