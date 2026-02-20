# Agent Factory — Post-Sprint Verification Script (v3)
# Run this AFTER Codex completes a sprint.
# Paste the FULL output into Claude for the next turn.
#
# Usage: .\verify-sprint.ps1
#        .\verify-sprint.ps1 -SkipCI              # local only, no CI wait
#        .\verify-sprint.ps1 -CIOnly              # skip local, just check CI
#        .\verify-sprint.ps1 -FailFast            # stop on first local failure
#        .\verify-sprint.ps1 -CIRetries 5         # retry CI lookup up to N times
#
# Requires: gh CLI authenticated (for CI gate)

param(
    [switch]$SkipCI,
    [switch]$CIOnly,
    [switch]$FailFast,
    [int]$CIRetries = 3
)

$ErrorActionPreference = "Continue"
$separator = "=" * 60

Write-Output ""
Write-Output $separator
Write-Output "AGENT FACTORY SPRINT VERIFICATION (v3)"
Write-Output "Timestamp: $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')"
Write-Output $separator
Write-Output ""

# ============================================================
# GIT CONTEXT (anchor everything to HEAD)
# ============================================================

$headSha = (git rev-parse HEAD 2>$null)
$headShort = if ($headSha) { $headSha.Substring(0, 8) } else { "unknown" }
$headMsg = (git log -1 --format="%s" 2>$null)
$branch = (git branch --show-current 2>$null)

Write-Output "GIT CONTEXT"
Write-Output "  Branch:  $branch"
Write-Output "  Commit:  $headShort"
Write-Output "  Message: $headMsg"
Write-Output ""

# ============================================================
# WORKSPACE CONTEXT
# ============================================================

$workspaceCount = (Get-ChildItem -Path "services/agents" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne "_shared" } | Measure-Object).Count
$totalProjects = 0
try {
    $pnpmList = pnpm ls --depth -1 --json 2>$null | ConvertFrom-Json
    $totalProjects = ($pnpmList | Measure-Object).Count
}
catch {
    $totalProjects = "unknown"
}
Write-Output "WORKSPACE CONTEXT"
Write-Output "  Agent count (excl _shared): $workspaceCount"
Write-Output "  Workspace projects: $totalProjects"
Write-Output ""

# Track exit codes
$lockfileExit = 0
$buildExit = 0
$listExit = 0
$validateExit = 0
$healthExit = 0
$ciExit = -1  # -1 = not run
$localFailed = $false

function Test-ShouldContinue {
    if ($FailFast -and $localFailed) {
        Write-Output ""
        Write-Output "!!! FailFast enabled — skipping remaining local checks."
        Write-Output ""
        return $false
    }
    return $true
}

if (-not $CIOnly) {

    # ============================================================
    # LOCAL VERIFICATION
    # ============================================================

    # --- Step 0: Lockfile sync check ---
    Write-Output ">>> COMMAND: pnpm install --frozen-lockfile"
    pnpm install --frozen-lockfile 2>&1 | Select-Object -Last 10
    $lockfileExit = $LASTEXITCODE
    Write-Output ">>> EXIT_CODE: $lockfileExit"
    Write-Output ""

    if ($lockfileExit -ne 0) {
        $localFailed = $true
        Write-Output "!!! LOCKFILE_DRIFT detected. pnpm-lock.yaml is out of sync."
        Write-Output "!!! Fix: run 'pnpm install' (without --frozen-lockfile) to regenerate,"
        Write-Output "!!! then commit the updated pnpm-lock.yaml."
        Write-Output ""
    }

    # --- Step 1: Build ---
    if (Test-ShouldContinue) {
        Write-Output ">>> COMMAND: pnpm -r build"
        pnpm -r build 2>&1 | Select-Object -Last 20
        $buildExit = $LASTEXITCODE
        Write-Output ">>> EXIT_CODE: $buildExit"
        Write-Output ""
        if ($buildExit -ne 0) { $localFailed = $true }
    }

    # --- Step 2: Agent list (sanity check) ---
    if (Test-ShouldContinue) {
        Write-Output ">>> COMMAND: pnpm af agent:list"
        pnpm af agent:list 2>&1
        $listExit = $LASTEXITCODE
        Write-Output ">>> EXIT_CODE: $listExit"
        Write-Output ""
        if ($listExit -ne 0) { $localFailed = $true }
    }

    # --- Step 3: Validate all agents ---
    if (Test-ShouldContinue) {
        Write-Output ">>> COMMAND: pnpm af agent:validate:all"
        pnpm af agent:validate:all 2>&1
        $validateExit = $LASTEXITCODE
        Write-Output ">>> EXIT_CODE: $validateExit"
        Write-Output ""
        if ($validateExit -ne 0) { $localFailed = $true }
    }

    # --- Step 4: Factory health (MUST be last local check) ---
    if (Test-ShouldContinue) {
        Write-Output ">>> COMMAND: pnpm factory:health"
        pnpm factory:health 2>&1 | Select-Object -Last 30
        $healthExit = $LASTEXITCODE
        Write-Output ">>> EXIT_CODE: $healthExit"
        Write-Output ""
        if ($healthExit -ne 0) { $localFailed = $true }
    }

    # --- Local Summary ---
    Write-Output $separator
    Write-Output "LOCAL VERIFICATION SUMMARY"
    Write-Output $separator
    Write-Output "Lockfile:     EXIT $lockfileExit$(if ($lockfileExit -ne 0) { ' *** LOCKFILE_DRIFT ***' })"
    Write-Output "Build:        EXIT $buildExit"
    Write-Output "Agent List:   EXIT $listExit"
    Write-Output "Validate All: EXIT $validateExit"
    Write-Output "Health:       EXIT $healthExit"

    $localPassed = ($lockfileExit -eq 0) -and ($buildExit -eq 0) -and ($listExit -eq 0) -and ($validateExit -eq 0) -and ($healthExit -eq 0)
    if ($localPassed) {
        Write-Output ""
        Write-Output "LOCAL_GATE: PASS"
    }
    else {
        Write-Output ""
        Write-Output "LOCAL_GATE: FAIL"
        Write-Output "First failure: $(
            if ($lockfileExit -ne 0) { 'pnpm install --frozen-lockfile (LOCKFILE_DRIFT)' }
            elseif ($buildExit -ne 0) { 'pnpm -r build (BUILD_ERROR)' }
            elseif ($listExit -ne 0) { 'pnpm af agent:list (WIRING_ERROR)' }
            elseif ($validateExit -ne 0) { 'pnpm af agent:validate:all (SCHEMA_ERROR)' }
            elseif ($healthExit -ne 0) { 'pnpm factory:health (TEST_FAILURE)' }
        )"
    }
    Write-Output ""

}
else {
    $localPassed = $true  # skip local for CIOnly mode
    Write-Output "(Skipping local verification — CIOnly mode)"
    Write-Output ""
}

# ============================================================
# CI GATE (GitHub Actions) — commit-anchored
# ============================================================

if (-not $SkipCI) {

    Write-Output $separator
    Write-Output "CI GATE (GitHub Actions)"
    Write-Output "Verifying CI for commit: $headShort"
    Write-Output $separator
    Write-Output ""

    # Check if gh CLI is available
    $ghAvailable = Get-Command gh -ErrorAction SilentlyContinue
    if (-not $ghAvailable) {
        Write-Output "!!! gh CLI not found. Install from https://cli.github.com/"
        Write-Output "!!! Skipping CI gate."
        Write-Output "CI_GATE: SKIPPED (gh not installed)"
        $ciExit = -1
    }
    else {
        # Check auth status
        $null = gh auth status 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Output "!!! gh CLI not authenticated. Run 'gh auth login' first."
            Write-Output "CI_GATE: SKIPPED (not authenticated)"
            $ciExit = -1
        }
        else {
            # ---------------------------------------------------------
            # Strategy: find the CI run matching HEAD commit.
            # If no run exists yet (Codex just pushed), wait and retry.
            # This avoids the stale-run bug where gh run watch finds
            # nothing in-progress and falls back to an old run.
            # ---------------------------------------------------------

            $runId = $null
            $runStatus = $null
            $runConclusion = $null
            $attempt = 0

            while ($attempt -lt $CIRetries) {
                $attempt++
                Write-Output ">>> Searching for CI run matching commit $headShort (attempt $attempt/$CIRetries)..."

                # Query recent runs and find one matching HEAD SHA
                $runsJson = gh run list --limit 10 --json databaseId, headSha, status, conclusion 2>&1
                if ($LASTEXITCODE -eq 0) {
                    try {
                        $runs = $runsJson | ConvertFrom-Json
                        $matchingRun = $runs | Where-Object { $_.headSha -eq $headSha } | Select-Object -First 1

                        if ($matchingRun) {
                            $runId = $matchingRun.databaseId
                            $runStatus = $matchingRun.status
                            $runConclusion = $matchingRun.conclusion
                            Write-Output ">>> Found CI run $runId (status: $runStatus, conclusion: $runConclusion)"
                            break
                        }
                    }
                    catch {
                        Write-Output ">>> Could not parse run list JSON."
                    }
                }

                if ($attempt -lt $CIRetries) {
                    Write-Output ">>> No CI run found for $headShort. Waiting 15s before retry..."
                    Start-Sleep -Seconds 15
                }
            }

            if (-not $runId) {
                Write-Output ""
                Write-Output "!!! No CI run found for commit $headShort after $CIRetries attempts."
                Write-Output "!!! Possible causes:"
                Write-Output "!!!   - Codex hasn't pushed yet (check git log vs remote)"
                Write-Output "!!!   - CI workflow not triggered (check .github/workflows/)"
                Write-Output "!!!   - Push is still propagating (try: .\verify-sprint.ps1 -CIOnly -CIRetries 6)"
                Write-Output ""
                Write-Output "CI_GATE: NOT_FOUND"
                $ciExit = -1
            }
            else {
                # If the run is still in progress, watch it
                if ($runStatus -eq "in_progress" -or $runStatus -eq "queued" -or $runStatus -eq "waiting" -or $runStatus -eq "pending") {
                    Write-Output ""
                    Write-Output ">>> COMMAND: gh run watch $runId --exit-status"
                    gh run watch $runId --exit-status 2>&1
                    $ciExit = $LASTEXITCODE
                    Write-Output ">>> EXIT_CODE: $ciExit"
                    Write-Output ""
                }
                elseif ($runConclusion -eq "success") {
                    # Already completed successfully
                    $ciExit = 0
                    Write-Output ">>> CI run $runId already completed with 'success'."
                    Write-Output ""
                }
                else {
                    # Already completed with failure
                    $ciExit = 1
                    Write-Output ">>> CI run $runId already completed with '$runConclusion'."
                    Write-Output ""
                }

                Write-Output "CI_RUN_ID: $runId"
                Write-Output "CI_COMMIT: $headShort"

                if ($ciExit -ne 0) {
                    Write-Output ""
                    Write-Output "CI FAILED — capturing failure logs..."
                    Write-Output ""
                    Write-Output ">>> COMMAND: gh run view $runId --log-failed"
                    gh run view $runId --log-failed 2>&1 | Select-Object -Last 50
                    Write-Output ""
                    Write-Output "CI_GATE: FAIL"
                }
                else {
                    Write-Output ""
                    Write-Output "CI_GATE: PASS"
                }
            }
        }
    }
    Write-Output ""

}
else {
    Write-Output "(Skipping CI gate — SkipCI flag set)"
    Write-Output "CI_GATE: SKIPPED"
    Write-Output ""
}

# ============================================================
# FINAL COMBINED GATE
# ============================================================

Write-Output $separator
Write-Output "COMBINED GATE RESULT"
Write-Output $separator

$ciPassed = ($ciExit -eq 0)
$ciSkipped = ($ciExit -eq -1)

if ($localPassed -and ($ciPassed -or $ciSkipped)) {
    Write-Output ""
    if ($ciSkipped) {
        Write-Output "GATE: PASS (local only — CI was skipped or not found)"
        Write-Output "WARNING: CI result not verified. Run without -SkipCI before advancing milestone."
    }
    else {
        Write-Output "GATE: PASS"
        Write-Output "Both local and CI ($headShort) verified."
    }
}
elseif ($localPassed -and -not $ciPassed) {
    Write-Output ""
    Write-Output "GATE: FAIL (CI)"
    Write-Output "Local passed but CI failed for commit $headShort."
    Write-Output "Likely cause: LOCKFILE_DRIFT or ENV_MISMATCH."
    Write-Output "Paste the full output above into Claude for a FIX prompt."
}
elseif (-not $localPassed) {
    Write-Output ""
    Write-Output "GATE: FAIL (local)"
    Write-Output "Fix local failures first before checking CI."
}
else {
    Write-Output ""
    Write-Output "GATE: FAIL"
}

Write-Output $separator