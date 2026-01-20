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

    $parts = Get-ChildItem -Path $zipDir -Filter "torgal-win32-x64-$Version-$BuildVariant.zip.part*" -ErrorAction SilentlyContinue

    if (Test-Path $zipPath) {
        $zipSize = (Get-Item $zipPath).Length
        if ($zipSize -le 2GB) {
            $assets += $zipPath
        }
    }

    # Include split parts if they exist
    foreach ($p in $parts) {
        $assets += $p.FullName
    }

    return $assets
}

function Test-RemoteTag {
    param([string]$Tag)

    try {
        $result = git ls-remote --tags origin "refs/tags/$Tag"
        return -not [string]::IsNullOrWhiteSpace($result)
    } catch {
        return $false
    }
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

# Check if tag and release already exist
$existingTag = git tag --list $tag
$localTagExists = -not [string]::IsNullOrWhiteSpace($existingTag)
$remoteTagExists = Test-RemoteTag -Tag $tag
$releaseExists = $false
try {
    & gh release view $tag *> $null
    if ($LASTEXITCODE -eq 0) { $releaseExists = $true }
} catch {
    $releaseExists = $false
}

if ($releaseExists) {
    Write-Host "[INFO] Release $tag already exists. Uploading assets..." -ForegroundColor Yellow
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

# Upload assets to existing release
if ($releaseExists) {
    & gh release upload $tag $assets --clobber
    Write-Host "[OK] Uploaded assets to $tag." -ForegroundColor Green
    exit 0
}

# Create git tag if missing
if (-not $localTagExists -and -not $remoteTagExists) {
    git tag $tag
    $localTagExists = $true
} elseif (-not $localTagExists -and $remoteTagExists) {
    Write-Host "[INFO] Tag $tag exists on origin but not locally. Fetching tags..." -ForegroundColor DarkGray
    git fetch --tags
}

if ($localTagExists -and -not $remoteTagExists) {
    Write-Host "[INFO] Pushing tag $tag to origin..." -ForegroundColor DarkGray
    git push origin $tag
    $remoteTagExists = $true
}

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
