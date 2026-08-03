# Rick Desktop self-updater (Windows). Replaces the running executable with the
# downloaded binary once the parent process exits, then relaunches it.
param(
    [Parameter(Mandatory = $true)][string]$NewBinary,
    [Parameter(Mandatory = $true)][string]$Target,
    [int]$ParentPid = 0
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $NewBinary)) {
    throw "Downloaded binary missing: $NewBinary"
}

# Wait for the parent (old) process to exit so the target file is unlocked.
if ($ParentPid -gt 0) {
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
        $proc = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
        if (-not $proc) { break }
        Start-Sleep -Seconds 1
    }
    if (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) {
        throw "Timed out waiting for Rick Desktop to exit"
    }
}

# Backup the current binary so a failed swap can be recovered.
if (Test-Path -LiteralPath $Target) {
    Copy-Item -LiteralPath $Target -Destination "$Target.old" -Force -ErrorAction SilentlyContinue
}
Move-Item -LiteralPath $NewBinary -Destination $Target -Force

# Relaunch the freshly installed binary.
Start-Process -FilePath $Target
