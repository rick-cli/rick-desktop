# Install Rick Desktop (portable binary + rickserve daemon) for Windows.
# Existing rick CLI installations are left untouched; rickserve is installed
# next to the desktop binary so the app can always find it.
#
# Usage: .\Install-RickDesktop.ps1 [[-Version] <string>]   (default: latest)
param(
    [string]$Repository = "rick-cli/rick-desktop",
    [string]$InstallDirectory = "$env:LOCALAPPDATA\RickDesktop\bin",
    [string]$Version = "latest"
)

$ErrorActionPreference = "Stop"
$asset = "RickDesktop-v{0}-windows-amd64.exe" -f $Version
$daemonAsset = "rickserve-v{0}-windows-amd64.exe" -f $Version

$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases/latest" -Headers @{ Accept = "application/vnd.github+json" }
if ($Version -eq "latest") {
    $Version = $release.tag_name.TrimStart("v")
    $asset = "RickDesktop-v$Version-windows-amd64.exe"
    $daemonAsset = "rickserve-v$Version-windows-amd64.exe"
}
$downloadBase = "https://github.com/$Repository/releases/download/$($release.tag_name)"

New-Item -ItemType Directory -Force -Path $InstallDirectory | Out-Null

foreach ($pair in @(@($asset, "rickdesktop.exe"), @($daemonAsset, "rickserve.exe"))) {
    $remote = $pair[0]; $local = $pair[1]
    $target = Join-Path $InstallDirectory $local
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("rd-{0}-{1}" -f $local, ([guid]::NewGuid()))
    try {
        Write-Host "Downloading $remote…"
        Invoke-WebRequest -Uri "$downloadBase/$remote" -OutFile $tmp
        Move-Item -Force $tmp $target
    }
    finally {
        Remove-Item -Force $tmp -ErrorAction SilentlyContinue
    }
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$entries = @($userPath -split ";" | Where-Object { $_ })
if ($entries -notcontains $InstallDirectory) {
    [Environment]::SetEnvironmentVariable("Path", (($entries + $InstallDirectory) -join ";"), "User")
}
$env:Path = "$InstallDirectory;$env:Path"

Write-Host "Installed Rick Desktop to $InstallDirectory"
Write-Host "Run: rickdesktop"
