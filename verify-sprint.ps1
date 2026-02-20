# Agent Factory — Post-Sprint Verification Script
# Run this AFTER Codex completes a sprint.
# Paste the full output into Claude for the next turn.
#
# Usage: .\verify-sprint.ps1
# Or copy the commands below and run them one at a time.

$ErrorActionPreference = "Continue"
$separator = "=" * 60

Write-Output ""
Write-Output $separator
Write-Output "AGENT FACTORY SPRINT VERIFICATION"
Write-Output "Timestamp: $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')"
Write-Output $separator
Write-Output ""

# --- Step 1: Build ---
Write-Output ">>> COMMAND: pnpm -r build"
pnpm -r build 2>&1 | Select-Object -Last 20
$buildExit = $LASTEXITCODE
Write-Output ">>> EXIT_CODE: $buildExit"
Write-Output ""

# --- Step 2: Agent list (sanity check) ---
Write-Output ">>> COMMAND: pnpm af agent:list"
pnpm af agent:list 2>&1
$listExit = $LASTEXITCODE
Write-Output ">>> EXIT_CODE: $listExit"
Write-Output ""

# --- Step 3: Validate all agents ---
Write-Output ">>> COMMAND: pnpm af agent:validate:all"
pnpm af agent:validate:all 2>&1
$validateExit = $LASTEXITCODE
Write-Output ">>> EXIT_CODE: $validateExit"
Write-Output ""

# --- Step 4: Milestone-specific commands ---
# Uncomment/add the acceptance commands for the current milestone.
# These change per sprint — Codex output will list them.

# Example for D3a:
# Write-Output ">>> COMMAND: pnpm af agent:run repo-patch --input '{...}' --validate-input"
# pnpm af agent:run repo-patch --input '{"taskId":"test-001","goal":"add hello.txt with content hello world","constraints":[],"fileScope":["hello.txt"],"mode":"dry-run"}' --validate-input 2>&1
# $milestoneExit = $LASTEXITCODE
# Write-Output ">>> EXIT_CODE: $milestoneExit"
# Write-Output ""

# --- Step 5: Factory health (MUST be last) ---
Write-Output ">>> COMMAND: pnpm factory:health"
pnpm factory:health 2>&1 | Select-Object -Last 30
$healthExit = $LASTEXITCODE
Write-Output ">>> EXIT_CODE: $healthExit"
Write-Output ""

# --- Summary ---
Write-Output $separator
Write-Output "VERIFICATION SUMMARY"
Write-Output $separator
Write-Output "Build:        EXIT $buildExit"
Write-Output "Agent List:   EXIT $listExit"
Write-Output "Validate All: EXIT $validateExit"
Write-Output "Health:       EXIT $healthExit"

$allPassed = ($buildExit -eq 0) -and ($listExit -eq 0) -and ($validateExit -eq 0) -and ($healthExit -eq 0)
if ($allPassed) {
    Write-Output ""
    Write-Output "GATE: PASS"
} else {
    Write-Output ""
    Write-Output "GATE: FAIL"
    Write-Output "First failure: $(
        if ($buildExit -ne 0) { 'pnpm -r build' }
        elseif ($listExit -ne 0) { 'pnpm af agent:list' }
        elseif ($validateExit -ne 0) { 'pnpm af agent:validate:all' }
        elseif ($healthExit -ne 0) { 'pnpm factory:health' }
    )"
}

Write-Output $separator