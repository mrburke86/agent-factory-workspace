# db-schema

## Purpose
Generate deterministic database schema and migration artifacts from a structured data model, with Drizzle as the primary target and Prisma as a secondary target.

## Contracts
- Input: `{ dataModel, techStack, outputDir, seedData?, correlationId? }`
- Output: `{ schemaFiles, migrationFiles, seedFile?, runtimeEvents, recovery? }`
- Reused shared contracts from `@acme/contracts`:
  - `GeneratedFile`
  - `FileSpec`
  - `EventEnvelope`
  - `RecoveryAction`

## Supported Targets
- Databases: `postgresql`, `sqlite`
- ORMs: `drizzle` (primary), `prisma` (secondary)

## Relationship Coverage
- one-to-many
- many-to-many (junction table/model generation)
- self-referential

## Safety Constraints
- File scope enforcement: all generated paths must stay inside `outputDir`.
- Multi-file atomicity: if generation or validation fails, the run returns `ok: false` and emits no schema/migration files.
- Compile validation: generated TypeScript files are validated with TypeScript compiler API in `noEmit` mode.
- Shared failure model only: failures emit `runtimeEvents` and `recovery` through shared contracts (no ORM-specific retry subsystem).

## Usage
```bash
pnpm af agent:validate db-schema
pnpm af agent:run db-schema --input '{"dataModel":{"entities":[{"name":"users","fields":[{"name":"id","type":"uuid","primaryKey":true},{"name":"email","type":"string","unique":true}]},{"name":"posts","fields":[{"name":"id","type":"uuid","primaryKey":true},{"name":"authorId","type":"uuid","references":{"entity":"users","field":"id"}},{"name":"parentId","type":"uuid","nullable":true,"references":{"entity":"posts","field":"id"}}]},{"name":"tags","fields":[{"name":"id","type":"uuid","primaryKey":true},{"name":"name","type":"string","unique":true}]}],"relationships":[{"type":"one-to-many","from":"users","to":"posts","foreignKey":"authorId"},{"type":"many-to-many","from":"posts","to":"tags","junctionTable":"post_tags"},{"type":"self-referential","entity":"posts","foreignKey":"parentId"}]},"techStack":{"database":"postgresql","orm":"drizzle"},"outputDir":"src/db"}' --validate-input
```
