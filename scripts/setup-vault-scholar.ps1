# ============================================================
#  Vault Scholar — Setup Script
#  Installs Node.js + Docker Desktop, verifies Ollama models,
#  and registers the plugin in Obsidian.
# ============================================================
#  Run from PowerShell (Admin recommended for Docker install):
#    powershell -ExecutionPolicy Bypass -File setup-vault-scholar.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$VaultRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PluginDir = Join-Path $VaultRoot ".obsidian\plugins\vault-scholar"
$CommunityPlugins = Join-Path $VaultRoot ".obsidian\community-plugins.json"

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  Vault Scholar Setup" -ForegroundColor Cyan
Write-Host "  Vault: $VaultRoot" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

# ------------------------------------------------------------
# 1. Verify plugin files exist
# ------------------------------------------------------------
Write-Host "[1/6] Verifying plugin files..." -ForegroundColor Yellow
if (-not (Test-Path (Join-Path $PluginDir "manifest.json"))) {
    Write-Host "  ERROR: manifest.json not found at $PluginDir" -ForegroundColor Red
    Write-Host "  Ensure the plugin folder exists before running setup." -ForegroundColor Red
    exit 1
}
Write-Host "  OK: Plugin files present." -ForegroundColor Green

# ------------------------------------------------------------
# 2. Verify / install Node.js
# ------------------------------------------------------------
Write-Host "[2/6] Checking Node.js..." -ForegroundColor Yellow
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $nodeVer = & node --version
    Write-Host "  OK: Node.js $nodeVer found." -ForegroundColor Green
} else {
    Write-Host "  Node.js not found. Installing via winget..." -ForegroundColor Yellow
    try {
        winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
        Write-Host "  Node.js installed. A new terminal may be needed for PATH refresh." -ForegroundColor Green
    } catch {
        Write-Host "  WARNING: winget install failed. Install Node.js LTS manually from https://nodejs.org" -ForegroundColor Red
    }
}

# ------------------------------------------------------------
# 3. Verify / install Docker Desktop
# ------------------------------------------------------------
Write-Host "[3/6] Checking Docker..." -ForegroundColor Yellow
$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
    Write-Host "  OK: Docker found." -ForegroundColor Green
} else {
    Write-Host "  Docker not found. Installing Docker Desktop via winget..." -ForegroundColor Yellow
    try {
        winget install --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements --silent
        Write-Host "  Docker Desktop installed." -ForegroundColor Green
        Write-Host "  IMPORTANT: A system restart is required before Docker works." -ForegroundColor Magenta
    } catch {
        Write-Host "  WARNING: winget install failed. Install Docker Desktop manually from https://www.docker.com/products/docker-desktop/" -ForegroundColor Red
    }
}

# ------------------------------------------------------------
# 4. Verify Ollama is running
# ------------------------------------------------------------
Write-Host "[4/6] Checking Ollama..." -ForegroundColor Yellow
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollama) {
    Write-Host "  ERROR: Ollama not found. Install from https://ollama.com" -ForegroundColor Red
    exit 1
}
try {
    $ollamaList = & ollama list 2>&1
    Write-Host "  OK: Ollama is available." -ForegroundColor Green
} catch {
    Write-Host "  WARNING: Could not reach Ollama. Ensure the Ollama app is running." -ForegroundColor Red
}

# ------------------------------------------------------------
# 5. Verify / pull required models
# ------------------------------------------------------------
Write-Host "[5/6] Verifying Ollama models..." -ForegroundColor Yellow
$requiredModels = @(
    "qwen3:8b",
    "qwen3-embedding:0.6b",
    "mathstral:latest",
    "gemma4:12b",
    "huihui_ai/qwen2.5-coder-abliterate:7b"
)
$pulled = @()
if ($ollamaList) {
    $pulled = $ollamaList | Select-String -Pattern "^\S+" | ForEach-Object { ($_ -split "\s+")[0] }
}
foreach ($model in $requiredModels) {
    if ($pulled -contains $model) {
        Write-Host "  OK: $model present." -ForegroundColor Green
    } else {
        Write-Host "  Pulling $model ..." -ForegroundColor Yellow
        & ollama pull $model
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  OK: $model pulled." -ForegroundColor Green
        } else {
            Write-Host "  WARNING: Failed to pull $model" -ForegroundColor Red
        }
    }
}

# ------------------------------------------------------------
# 6. Register plugin in community-plugins.json
# ------------------------------------------------------------
Write-Host "[6/6] Registering plugin in Obsidian..." -ForegroundColor Yellow
$plugins = @()
if (Test-Path $CommunityPlugins) {
    try {
        $plugins = Get-Content $CommunityPlugins -Raw | ConvertFrom-Json
    } catch {
        $plugins = @()
    }
}
if ($plugins -notcontains "vault-scholar") {
    $plugins += "vault-scholar"
    $plugins | ConvertTo-Json | Set-Content $CommunityPlugins -Encoding UTF8
    Write-Host "  OK: 'vault-scholar' added to community-plugins.json" -ForegroundColor Green
} else {
    Write-Host "  OK: 'vault-scholar' already registered." -ForegroundColor Green
}

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  Setup complete!" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. If Docker was installed, restart your computer." -ForegroundColor Yellow
Write-Host "  2. Restart Obsidian (or reload the vault)." -ForegroundColor Yellow
Write-Host "  3. Enable 'Vault Scholar' in Settings -> Community plugins." -ForegroundColor Yellow
Write-Host "  4. Open the Vault Scholar settings tab to configure models & security." -ForegroundColor Yellow
Write-Host ""