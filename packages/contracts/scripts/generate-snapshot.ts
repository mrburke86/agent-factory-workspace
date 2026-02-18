import fs from "node:fs";
import path from "node:path";

type Snapshot = {
  version: string;
  exports: Record<string, { type: "schema" | "type" | "openapi"; signature: string }>;
};

const snapshot: Snapshot = {
  version: "0.1.0",
  exports: {
    "errors.ErrorEnvelopeSchema": { type: "schema", signature: "z.object({code,message,correlationId?,details?})" },
    "events.EventEnvelopeSchema": { type: "schema", signature: "z.object({eventName,eventVersion,occurredAt,correlationId,tenantId?,payload})" },
    "events.IngestionFileReceivedV1": { type: "schema", signature: "z.object({fileId,source,originalFilename?,mimeType?,sha256,sizeBytes})" },
    "schemas.RepoPatchTaskSchema": {
      type: "schema",
      signature: "z.object({taskId,goal,constraints[],fileScope[],mode:enum(dry-run|apply|validate|pr-ready)})"
    },
    "schemas.RepoPatchPlanSchema": {
      type: "schema",
      signature: "z.object({steps[],touchedFiles[],commands[],risks[]})"
    },
    "schemas.RepoPatchPatchSchema": {
      type: "schema",
      signature: "z.array(z.object({path,unifiedDiff,rationale}))"
    },
    "schemas.RepoPatchResultSchema": {
      type: "schema",
      signature: "z.object({ok,correlationId,timings:{startedAt,finishedAt,durationMs},outputs[],errors[]})"
    }
  }
};

const outPath = path.resolve(process.cwd(), "compat_snapshot.current.json");
fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
console.log(`✅ wrote ${outPath} with ${Object.keys(snapshot.exports).length} exports`);
