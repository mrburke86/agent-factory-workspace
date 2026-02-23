import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { layer2ConfigJsonSchema } from "../src/schemas/layer2-config.schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..", "..");
const outputDir = resolve(packageRoot, "dist", "schemas");
const outputPath = resolve(outputDir, "layer2-config.schema.json");

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, JSON.stringify(layer2ConfigJsonSchema, null, 2) + "\n", "utf8");

console.log(JSON.stringify({ event: "contracts.layer2-schema.generated", outputPath }));
