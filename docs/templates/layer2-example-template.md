# Layer 2 Configuration: {{Project Name}}

## Project Description

<!-- TODO: Summarize project goals, user outcomes, and technical scope in 3-6 sentences. -->

## Layer 2 Configuration

Reference contract: `AGENTS.md` section `## Layer 2 Interface Contract`.

```yaml
projectName: "{{project_name_human_readable}}"
techStack:
  language: "{{primary_language}}"
  framework: "{{primary_framework_or_platform}}"
  database: "{{database_if_applicable}}"
  auth: "{{auth_if_applicable}}"
  payments: "{{payments_if_applicable}}"
stages: {}
```

## Stage Overrides

### Plan Stage

```yaml
stages:
  plan:
    promptTemplate: "{{plan_prompt_with_at_least_one_placeholder}}"
    constraints:
      - "{{plan_constraint_1}}"
    expectedOutputs:
      - "{{plan_expected_output_1}}"
    acceptanceCriteria:
      - "{{plan_acceptance_criterion_1}}"
```

### Implement Stage

```yaml
stages:
  implement:
    promptTemplate: "{{implement_prompt_with_at_least_one_placeholder}}"
    constraints:
      - "{{implement_constraint_1}}"
    expectedOutputs:
      - "{{implement_expected_output_1}}"
    acceptanceCriteria:
      - "{{implement_acceptance_criterion_1}}"
```

### Verify Stage

```yaml
stages:
  verify:
    promptTemplate: "{{verify_prompt_with_at_least_one_placeholder}}"
    constraints:
      - "{{verify_constraint_1}}"
    expectedOutputs:
      - "{{verify_expected_output_1}}"
    acceptanceCriteria:
      - "{{verify_acceptance_criterion_1}}"
```

### Integrate Stage

```yaml
stages:
  integrate:
    promptTemplate: "{{integrate_prompt_with_at_least_one_placeholder}}"
    constraints:
      - "{{integrate_constraint_1}}"
    expectedOutputs:
      - "{{integrate_expected_output_1}}"
    acceptanceCriteria:
      - "{{integrate_acceptance_criterion_1}}"
```

### Operate Stage

```yaml
stages:
  operate:
    promptTemplate: "{{operate_prompt_with_at_least_one_placeholder}}"
    constraints:
      - "{{operate_constraint_1}}"
    expectedOutputs:
      - "{{operate_expected_output_1}}"
    acceptanceCriteria:
      - "{{operate_acceptance_criterion_1}}"
```

## Expected Outputs

- Plan: `{{plan_artifacts_list}}`
- Implement: `{{implement_artifacts_list}}`
- Verify: `{{verify_artifacts_list}}`
- Integrate: `{{integrate_artifacts_list}}`
- Operate: `{{operate_artifacts_list}}`

## How to Use This Example

1. Fill in `## Layer 2 Configuration` with project metadata and `techStack` values.
2. Populate every stage under `## Stage Overrides` with concrete `promptTemplate`, `constraints`, `expectedOutputs`, and `acceptanceCriteria`.
3. Keep at least one `{{placeholder}}` variable in each stage `promptTemplate`.
4. Save the completed file under `docs/examples/` and keep the `## Layer 2 Configuration` heading unchanged for discovery.
