type LogLevel = "debug" | "info" | "warn" | "error" | "silent";
type LogFormat = "json" | "pretty";

const levelOrder: Record<Exclude<LogLevel, "silent">, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function getLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || "").toLowerCase();
  if (!raw) return "silent";
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  if (raw === "silent") return "silent";
  return "info";
}

function getFormat(): LogFormat {
  const raw = (process.env.LOG_FORMAT || "").toLowerCase();
  return raw === "pretty" ? "pretty" : "json";
}

function shouldLog(msgLevel: Exclude<LogLevel, "silent">): boolean {
  const cur = getLevel();
  if (cur === "silent") return false;
  return levelOrder[msgLevel] >= levelOrder[cur];
}

function nowIso() {
  return new Date().toISOString();
}

export type LogFields = Record<string, unknown>;

export function logDebug(event: string, fields: LogFields = {}) {
  if (!shouldLog("debug")) return;
  emit("debug", event, fields);
}

export function logInfo(event: string, fields: LogFields = {}) {
  if (!shouldLog("info")) return;
  emit("info", event, fields);
}

export function logWarn(event: string, fields: LogFields = {}) {
  if (!shouldLog("warn")) return;
  emit("warn", event, fields);
}

export function logError(event: string, fields: LogFields = {}) {
  if (!shouldLog("error")) return;
  emit("error", event, fields);
}

function emit(level: Exclude<LogLevel, "silent">, event: string, fields: LogFields) {
  const fmt = getFormat();
  const payload = { ts: nowIso(), level, event, ...fields };

  if (fmt === "pretty") {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(JSON.stringify(payload));
  }
}
