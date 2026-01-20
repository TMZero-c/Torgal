# Torgal Release Publisher
# Builds CPU + GPU variants locally and publishes a GitHub Release when VERSION changes.
#
# Prereqs:
# - GitHub CLI installed and authenticated: gh auth login
# - Local builds available or build.ps1 runnable
#
# Usage:
#   .\publish.ps1                 # Build both, create release, upload assets
#   .\publish.ps1 -SkipBuild       # Use existing build outputs
#   .\publish.ps1 -Draft           # Create as draft release
#   .\publish.ps1 -Prerelease      # Mark as prerelease

param(
    [ValidateSet("both", "cpu", "gpu")]
    [string]$Variant = "both",
    [switch]$SkipBuild,
    [switch]$Draft,
    [switch]$Prerelease
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$VersionFile = Join-Path $ProjectRoot "VERSION"
$BuildScript = Join-Path $ProjectRoot "build.ps1"

function Get-Version {
    if (-not (Test-Path $VersionFile)) {
        throw "VERSION file not found at $VersionFile"
    }
    $ver = (Get-Content $VersionFile -Raw).Trim()
    if (-not $ver) {
        throw "VERSION file is empty"
    }
    return $ver
}

function Get-AssetPaths {
    param([string]$Version, [string]$BuildVariant)

    $assets = @()
    $zipDir = Join-Path $ProjectRoot "app\out\make-$BuildVariant\zip\win32\x64"
    if (-not (Test-Path $zipDir)) {
        return $assets
    }

    $zipName = "torgal-win32-x64-$Version-$BuildVariant.zip"
    $zipPath = Join-Path $zipDir $zipName
    if (Test-Path $zipPath) {
        $assets += $zipPath
    }

    # Include split parts if they exist
    $parts = Get-ChildItem -Path $zipDir -Filter "torgal-win32-x64-$Version-$BuildVariant.zip.part*" -ErrorAction SilentlyContinue
    foreach ($p in $parts) {
        $assets += $p.FullName
    }

    return $assets
}

function Split-File {
    param(
        [string]$FilePath,
        [int64]$ChunkSizeBytes = 1900MB
    )

    if (-not (Test-Path $FilePath)) {
        return
    }

    $dir = Split-Path $FilePath
    $base = [IO.Path]::GetFileNameWithoutExtension($FilePath)
    $ext = [IO.Path]::GetExtension($FilePath)
    $size = (Get-Item $FilePath).Length

    if ($size -le 2GB) {
        return
    }

    # Clean old parts
    Get-ChildItem -Path $dir -Filter "$base$ext.part*" -ErrorAction SilentlyContinue | Remove-Item -Force

    $fs = [IO.File]::OpenRead($FilePath)
    $buffer = New-Object byte[] (4MB)
    $part = 1

    while ($fs.Position -lt $fs.Length) {
        $partPath = Join-Path $dir ("{0}{1}.part{2:000}" -f $base, $ext, $part)
        $out = [IO.File]::OpenWrite($partPath)
        $written = 0

        while ($written -lt $ChunkSizeBytes -and $fs.Position -lt $fs.Length) {
            $read = $fs.Read($buffer, 0, $buffer.Length)
            if ($read -le 0) { break }
            $out.Write($buffer, 0, $read)
            $written += $read
        }

        $out.Close()
        $part++
    }

    $fs.Close()
}

function Ensure-ReleaseAssets {
    param([string]$Version, [string]$BuildVariant)

    $zipDir = Join-Path $ProjectRoot "app\out\make-$BuildVariant\zip\win32\x64"
    if (-not (Test-Path $zipDir)) {
        return
    }

    $zipName = "torgal-win32-x64-$Version-$BuildVariant.zip"
    $zipPath = Join-Path $zipDir $zipName

    if (Test-Path $zipPath) {
        Split-File -FilePath $zipPath
    }
}

$version = Get-Version
$tag = "v$version"

# Skip if version tag already exists
$existingTag = git tag --list $tag
if ($existingTag) {
    Write-Host "[INFO] Tag $tag already exists. Nothing to publish." -ForegroundColor Yellow
    exit 0
}

# Build if needed
if (-not $SkipBuild) {
    if (-not (Test-Path $BuildScript)) {
        throw "build.ps1 not found at $BuildScript"
    }
    & $BuildScript -Variant $Variant
}

# Ensure GPU zip is split if needed
if ($Variant -in @("gpu", "both")) {
    Ensure-ReleaseAssets -Version $version -BuildVariant "gpu"
}

# Collect assets
$assets = @()
if ($Variant -in @("cpu", "both")) {
    $assets += Get-AssetPaths -Version $version -BuildVariant "cpu"
}
if ($Variant -in @("gpu", "both")) {
    $assets += Get-AssetPaths -Version $version -BuildVariant "gpu"
}

if ($assets.Count -eq 0) {
    throw "No release assets found. Ensure builds exist in app/out/make-*/zip/win32/x64"
}

# Create git tag
git tag $tag

# Build gh release create args
$ghArgs = @("release", "create", $tag)
$ghArgs += $assets
$ghArgs += @("-t", "Torgal $version")
$ghArgs += @("-n", "Release $version")
if ($Draft) { $ghArgs += "--draft" }
if ($Prerelease) { $ghArgs += "--prerelease" }

# Create release
& gh @ghArgs

Write-Host "[OK] Published release $tag with $($assets.Count) assets." -ForegroundColor Green
