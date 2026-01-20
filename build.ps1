# Torgal Build Script
# Builds both CPU and GPU versions of the application using separate venvs
#
# Usage:
#   .\build.ps1                    # Build both CPU and GPU installers
#   .\build.ps1 -Variant cpu       # Build CPU version only
#   .\build.ps1 -Variant gpu       # Build GPU version only
#   .\build.ps1 -SetupVenvs        # Create/update venvs only (no build)

param(
    [ValidateSet("both", "cpu", "gpu")]
    [string]$Variant = "both",
    [switch]$SetupVenvs
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$PackageJsonPath = Join-Path $ProjectRoot "app\package.json"
$DefaultPackageConfig = Get-Content $PackageJsonPath -Raw | ConvertFrom-Json
$DefaultExtraResource = $DefaultPackageConfig.config.forge.packagerConfig.extraResource
$DefaultMakers = $DefaultPackageConfig.config.forge.makers

Write-Host ("=" * 60) -ForegroundColor Cyan
Write-Host "  Torgal Build Script" -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor Cyan

# Function to setup a virtual environment
function Setup-Venv {
    param(
        [string]$VenvName,
        [string]$RequirementsFile,
        [string]$TorchIndex = ""
    )
    
    $VenvPath = Join-Path $ProjectRoot $VenvName
    $VenvActivate = Join-Path $VenvPath "Scripts\Activate.ps1"
    $ReqPath = Join-Path $ProjectRoot "python\$RequirementsFile"
    
    if (-not (Test-Path $VenvPath)) {
        Write-Host "`n[SETUP] Creating virtual environment: $VenvName..." -ForegroundColor Yellow
        python -m venv $VenvPath
    }
    
    Write-Host "[SETUP] Activating $VenvName and installing dependencies..." -ForegroundColor Yellow
    . $VenvActivate
    
    # Upgrade pip first
    python -m pip install --upgrade pip --quiet
    
    # Install PyTorch first (with correct index for CPU vs GPU)
    if ($TorchIndex) {
        Write-Host "[SETUP] Installing PyTorch (CUDA)..." -ForegroundColor Yellow
        pip install torch --index-url $TorchIndex --quiet
    }
    else {
        Write-Host "[SETUP] Installing PyTorch (CPU)..." -ForegroundColor Yellow
        pip install torch --index-url https://download.pytorch.org/whl/cpu --quiet
    }
    
    # Install remaining requirements
    pip install -r $ReqPath --quiet
    
    Write-Host "[OK] $VenvName ready!" -ForegroundColor Green
}

# Function to build Python executables with a specific venv
function Build-PythonExe {
    param([string]$BuildVariant)
    
    $VenvName = ".venv-$BuildVariant"
    $VenvActivate = Join-Path $ProjectRoot "$VenvName\Scripts\Activate.ps1"
    
    if (-not (Test-Path $VenvActivate)) {
        Write-Host "❌ Virtual environment not found: $VenvName" -ForegroundColor Red
        Write-Host "   Run: .\build.ps1 -SetupVenvs" -ForegroundColor Yellow
        return $false
    }
    
    Write-Host "`n📦 Building Python executables ($BuildVariant)..." -ForegroundColor Yellow
    
    # Activate the correct venv
    . $VenvActivate
    
    Push-Location (Join-Path $ProjectRoot "python")
    
    if ($BuildVariant -eq "cpu") {
        python build_exe.py --cpu
    }
    else {
        # GPU is the default
        python build_exe.py
    }
    
    $Result = $LASTEXITCODE
    Pop-Location
    
    # Deactivate
    deactivate 2>$null
    
    return ($Result -eq 0)
}

# Function to build Electron app for a variant
function Build-ElectronApp {
    param([string]$BuildVariant)
    
    Write-Host "`n📦 Building Electron app ($BuildVariant)..." -ForegroundColor Yellow
    
    $DistPath = Join-Path $ProjectRoot "python\dist\$BuildVariant"
    $ServerExe = Join-Path $DistPath "server.exe"
    $ParseExe = Join-Path $DistPath "parse_slides.exe"
    
    if (-not (Test-Path $ServerExe)) {
        Write-Host "❌ Missing: $ServerExe" -ForegroundColor Red
        return $false
    }
    
    # Update package.json to point to correct variant
    $Config = $DefaultPackageConfig | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    $Config.config.forge.packagerConfig.extraResource = @(
        "../python/dist/$BuildVariant/server.exe",
        "../python/dist/$BuildVariant/parse_slides.exe"
    )
    if ($BuildVariant -eq "gpu") {
        # Squirrel often fails for very large GPU builds; use zip maker only
        $Config.config.forge.makers = @(
            $DefaultMakers | Where-Object { $_.name -eq "@electron-forge/maker-zip" }
        )
    }
    $Config | ConvertTo-Json -Depth 10 | Set-Content $PackageJsonPath -Encoding UTF8
    
    # Clean up previous build artifacts
    $OutDir = Join-Path $ProjectRoot "app\out"
    $OutMake = Join-Path $OutDir "make"
    $OutUnpacked = Join-Path $OutDir "torgal-win32-x64"
    
    if (Test-Path $OutMake) {
        Remove-Item $OutMake -Recurse -Force
    }
    if (Test-Path $OutUnpacked) {
        Remove-Item $OutUnpacked -Recurse -Force
    }
    
    # Ensure Squirrel temp files go to a roomy location
    $TempDir = Join-Path $ProjectRoot ".tmp\squirrel"
    New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
    $env:TEMP = $TempDir
    $env:TMP = $TempDir
    $env:SQUIRREL_TEMP = $TempDir

    # Run electron-forge make
    Push-Location (Join-Path $ProjectRoot "app")
    npm run make
    $BuildResult = $LASTEXITCODE
    Pop-Location
    
    if ($BuildResult -ne 0) {
        Write-Host "❌ Electron build failed for $BuildVariant!" -ForegroundColor Red
        return $false
    }
    
    # Move output to variant-specific folder
    $OutVariant = Join-Path $OutDir "make-$BuildVariant"
    
    if (Test-Path $OutVariant) {
        Remove-Item $OutVariant -Recurse -Force
    }
    
    if (Test-Path $OutMake) {
        Move-Item $OutMake $OutVariant -Force
        Write-Host "✅ $BuildVariant build complete: app\out\make-$BuildVariant\" -ForegroundColor Green
    }

    # Rename zip asset to include variant suffix (cpu/gpu)
    $ZipDir = Join-Path $OutVariant "zip\win32\x64"
    if (Test-Path $ZipDir) {
        Get-ChildItem -Path $ZipDir -Filter "torgal-win32-x64-*.zip" | ForEach-Object {
            if ($_.BaseName -notlike "*-$BuildVariant") {
                $NewName = "$($_.BaseName)-$BuildVariant$($_.Extension)"
                Rename-Item -Path $_.FullName -NewName $NewName
            }
        }
    }
    
    # Clean up unpacked folder (not needed for distribution)
    if (Test-Path $OutUnpacked) {
        Remove-Item $OutUnpacked -Recurse -Force
    }
    
    return $true
}

# Setup venvs only mode
if ($SetupVenvs) {
    Write-Host "`n[SETUP] Setting up virtual environments..." -ForegroundColor Cyan
    Setup-Venv -VenvName ".venv-cpu" -RequirementsFile "requirements-cpu.txt"
    Setup-Venv -VenvName ".venv-gpu" -RequirementsFile "requirements-gpu.txt" -TorchIndex "https://download.pytorch.org/whl/cu121"
    Write-Host "`n[OK] Virtual environments ready!" -ForegroundColor Green
    Write-Host "   .venv-cpu/ - For CPU builds (~500-800MB exe)" -ForegroundColor Cyan
    Write-Host "   .venv-gpu/ - For GPU builds (~2.4GB exe)" -ForegroundColor Cyan
    exit 0
}

# Build based on variant
if ($Variant -eq "both") {
    # Build CPU Python exe
    Write-Host ("`n" + "=" * 60) -ForegroundColor Cyan
    Write-Host "  Building CPU Version" -ForegroundColor Cyan
    Write-Host ("=" * 60) -ForegroundColor Cyan
    
    if (-not (Build-PythonExe -BuildVariant "cpu")) {
        Write-Host "❌ CPU Python build failed!" -ForegroundColor Red
        exit 1
    }
    $CpuResult = Build-ElectronApp -BuildVariant "cpu"
    
    # Build GPU Python exe
    Write-Host ("`n" + "=" * 60) -ForegroundColor Cyan
    Write-Host "  Building GPU Version" -ForegroundColor Cyan  
    Write-Host ("=" * 60) -ForegroundColor Cyan
    
    if (-not (Build-PythonExe -BuildVariant "gpu")) {
        Write-Host "❌ GPU Python build failed!" -ForegroundColor Red
        exit 1
    }
    $GpuResult = Build-ElectronApp -BuildVariant "gpu"
    
    Write-Host ("`n" + "=" * 60) -ForegroundColor Green
    Write-Host "  Build Complete!" -ForegroundColor Green
    Write-Host ("=" * 60) -ForegroundColor Green
    Write-Host "`nOutput locations:"
    Write-Host "  CPU: app\out\make-cpu\squirrel.windows\x64\TorgalSetup.exe" -ForegroundColor Cyan
    Write-Host "  GPU: app\out\make-gpu\squirrel.windows\x64\TorgalSetup.exe" -ForegroundColor Cyan
    
}
else {
    # Single variant build
    if (-not (Build-PythonExe -BuildVariant $Variant)) {
        Write-Host "❌ Python build failed!" -ForegroundColor Red
        exit 1
    }
    Build-ElectronApp -BuildVariant $Variant
}

# Restore package.json to default (cpu)
$Config = $DefaultPackageConfig | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$Config.config.forge.packagerConfig.extraResource = @(
    "../python/dist/cpu/server.exe",
    "../python/dist/cpu/parse_slides.exe"
)
$Config.config.forge.makers = $DefaultMakers
$Config | ConvertTo-Json -Depth 10 | Set-Content $PackageJsonPath -Encoding UTF8

Write-Host "`n✅ Done!" -ForegroundColor Green
