# Error Recover Agent

The `error-recover` agent classifies failed agent runs and returns a deterministic recovery recommendation.

## Inputs

- `failedAgentId`
- `agentResult`
- `errorOutput`
- `attemptCount`
- `totalRetries`

## Recovery Taxonomy

- `BUILD_ERROR` -> `retry_modified`
- `TEST_FAILURE` -> `retry_modified`
- `SCHEMA_ERROR` -> `retry_modified`
- `MISSING_FILE` -> `retry_modified`
- `PATCH_FAILURE` -> `rollback`
- `VALIDATION_FAILURE` -> `retry_modified`
- `BUDGET_EXCEEDED` -> `escalate`
- `DEPENDENCY_FAILED` -> `skip_and_flag`
- `MAX_RETRIES` -> `escalate`
- `RUNTIME_ERROR` -> `escalate`
- `WIRING_ERROR` -> `escalate`

## Retry Caps

- `attemptCount >= 3` forces `MAX_RETRIES`
- `totalRetries >= 10` forces `MAX_RETRIES`
- `shouldRetry` is only `true` when the selected action is `retry_modified` and neither cap has been reached

## Usage

```powershell
pnpm af agent:run error-recover --input '{"failedAgentId":"plan","agentResult":{"ok":false},"errorOutput":"error TS2304: Cannot find name '\''x'\''","attemptCount":1,"totalRetries":2}' --validate-input
```
