# Layer 2 Configuration Schema

This document defines the Layer 2 configuration schema for project-specific templates, aligned to the `AGENTS.md` section `## Layer 2 Interface Contract`.

## Required Fields

Every Layer 2 configuration must declare:

| Field | Type | Description |
| --- | --- | --- |
| `projectName` | string | Human-readable project identifier |
| `techStack` | object | `{ language, framework, database?, auth?, payments? }` |
| `stages` | object | Per-stage overrides keyed by stage name (plan, implement, verify, integrate, operate) |

## `techStack` Object

The `techStack` object includes required and optional fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `language` | string | yes | Primary implementation language for the project |
| `framework` | string | yes | Primary framework or platform |
| `database` | string | no | Data store technology, if used |
| `auth` | string | no | Authentication approach or provider, if used |
| `payments` | string | no | Payment system integration, if used |

## Stage Override Structure

Each stage override in the `stages` object must include:

| Field | Type | Description |
| --- | --- | --- |
| `promptTemplate` | string | Stage-specific prompt template with `{{placeholders}}` for runtime values |
| `constraints` | string[] | Hard constraints for this stage (e.g., "no ORM queries in plan stage") |
| `expectedOutputs` | string[] | What this stage should produce (e.g., "migration file", "API route") |
| `acceptanceCriteria` | string[] | Binary pass/fail conditions for stage completion |

## Validation Rules

A valid Layer 2 config must satisfy:

1. All required fields are present and non-empty.
2. The `stages` object includes at least `plan` and `implement` overrides.
3. Every `promptTemplate` contains at least one `{{placeholder}}`.
4. Every stage lists at least one `acceptanceCriteria` item.
5. No stage override references files or commands outside the project's declared tech stack.

## Discovery and Loading

- Layer 2 configs are discovered by scanning `docs/examples/*.md` for files containing a `## Layer 2 Configuration` section.
- Each config file is self-contained markdown with no external dependencies.
- The sprint loop operator selects the appropriate config for their project and provides it as context to the Claude Project compiler.

## Example (Minimal Valid Configuration)

```json
{
  "projectName": "{{project_name}}",
  "techStack": {
    "language": "{{language}}",
    "framework": "{{framework}}",
    "database": "{{database_optional}}",
    "auth": "{{auth_optional}}",
    "payments": "{{payments_optional}}"
  },
  "stages": {
    "plan": {
      "promptTemplate": "Plan work for {{feature_scope}}.",
      "constraints": ["{{plan_constraint}}"],
      "expectedOutputs": ["plan.json"],
      "acceptanceCriteria": ["{{plan_acceptance}}"]
    },
    "implement": {
      "promptTemplate": "Implement changes for {{feature_scope}}.",
      "constraints": ["{{implement_constraint}}"],
      "expectedOutputs": ["patches/*.diff"],
      "acceptanceCriteria": ["{{implement_acceptance}}"]
    }
  }
}
```
