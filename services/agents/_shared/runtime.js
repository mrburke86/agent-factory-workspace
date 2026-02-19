"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nowIso = nowIso;
exports.msBetween = msBetween;
exports.wrap = wrap;
function nowIso() {
    return new Date().toISOString();
}
function msBetween(startMs, endMs) {
    return Math.max(0, endMs - startMs);
}
async function wrap(agent, fn, input) {
    const startedAt = nowIso();
    const start = Date.now();
    try {
        const data = await fn(input);
        const end = Date.now();
        const finishedAt = nowIso();
        return {
            ok: true,
            agent,
            startedAt,
            finishedAt,
            ms: msBetween(start, end),
            errors: [],
            data,
        };
    }
    catch (e) {
        const end = Date.now();
        const finishedAt = nowIso();
        const message = typeof e?.message === "string"
            ? e.message
            : typeof e === "string"
                ? e
                : JSON.stringify(e);
        return {
            ok: false,
            agent,
            startedAt,
            finishedAt,
            ms: msBetween(start, end),
            errors: [{ code: "UNHANDLED", message }],
        };
    }
}
