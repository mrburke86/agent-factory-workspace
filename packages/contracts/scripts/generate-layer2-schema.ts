import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  briefIntakeInputJsonSchema,
  briefIntakeOutputJsonSchema,
} from "../src/schemas/brief-intake.schema.js";
import { layer2ConfigJsonSchema } from "../src/schemas/layer2-config.schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..", "..");
const outputDir = resolve(packageRoot, "dist", "schemas");
const outputPath = resolve(outputDir, "layer2-config.schema.json");
const briefIntakeInputOutputPath = resolve(outputDir, "brief-intake.input.schema.json");
const briefIntakeOutputOutputPath = resolve(outputDir, "brief-intake.output.schema.json");

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, JSON.stringify(layer2ConfigJsonSchema, null, 2) + "\n", "utf8");
writeFileSync(briefIntakeInputOutputPath, JSON.stringify(briefIntakeInputJsonSchema, null, 2) + "\n", "utf8");
writeFileSync(briefIntakeOutputOutputPath, JSON.stringify(briefIntakeOutputJsonSchema, null, 2) + "\n", "utf8");

console.log(
  JSON.stringify({
    event: "contracts.schemas.generated",
    outputPaths: [outputPath, briefIntakeInputOutputPath, briefIntakeOutputOutputPath],
  }),
);
