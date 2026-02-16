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
    "events.IngestionFileReceivedV1": { type: "schema", signature: "z.object({fileId,source,originalFilename?,mimeType?,sha256,sizeBytes})" }
  }
};

const outPath = path.resolve(process.cwd(), "compat_snapshot.current.json");
fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
console.log(`✅ wrote ${outPath} with ${Object.keys(snapshot.exports).length} exports`);
