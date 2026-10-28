# BuildYourTeam installer (Windows PowerShell 5.1+ / PowerShell 7).
#   From a clone:   .\install.ps1
#   From the web:   irm https://raw.githubusercontent.com/FrenchCedricus/BuildYourTeam/main/install.ps1 | iex
$ErrorActionPreference = 'Stop'

$Repo = 'FrenchCedricus/BuildYourTeam'
$Branch = if ($env:BYT_BRANCH) { $env:BYT_BRANCH } else { 'main' }
$ClaudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$SkillDir = Join-Path $ClaudeDir 'skills\byt'
$BytHome = if ($env:BYT_HOME) { $env:BYT_HOME } else { Join-Path $HOME '.byt' }

function Write-Ok($msg) { Write-Host "[ok] $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "> $msg" -ForegroundColor Cyan }
function Stop-Install($msg) { Write-Host "[error] $msg" -ForegroundColor Red; exit 1 }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Stop-Install 'Node.js not found. Install Node.js 18 or later: https://nodejs.org' }
$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 18) { Stop-Install "Node.js $nodeMajor found: version 18 or later is required." }

# Source: the local clone when run from one, otherwise the GitHub archive.
$tmp = $null
$localSkill = if ($PSScriptRoot) { Join-Path $PSScriptRoot 'skill' } else { $null }
if ($localSkill -and (Test-Path (Join-Path $localSkill 'byt.mjs'))) {
  $src = $localSkill
  Write-Info "Installing from $PSScriptRoot"
} else {
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("byt-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Force $tmp | Out-Null
  $zip = Join-Path $tmp 'byt.zip'
  Write-Info "Downloading $Repo ($Branch)..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri "https://codeload.github.com/$Repo/zip/refs/heads/$Branch" -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $found = Get-ChildItem -Path $tmp -Directory | ForEach-Object { Join-Path $_.FullName 'skill' } | Where-Object { Test-Path (Join-Path $_ 'byt.mjs') } | Select-Object -First 1
  if (-not $found) { Stop-Install 'Unexpected archive: skill\ folder not found.' }
  $src = $found
}

try {
  # The skill folder belongs to BYT only: replace it entirely.
  if (Test-Path $SkillDir) { Remove-Item -Recurse -Force $SkillDir }
  New-Item -ItemType Directory -Force $SkillDir | Out-Null
  Copy-Item -Path (Join-Path $src '*') -Destination $SkillDir -Recurse -Force
  New-Item -ItemType Directory -Force (Join-Path $BytHome 'teams') | Out-Null
} finally {
  if ($tmp) { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
}

Write-Ok "Skill installed in $SkillDir"
Write-Ok "Data folder: $BytHome"
$version = & node (Join-Path $SkillDir 'byt.mjs') version
Write-Ok "BuildYourTeam $version ready."
Write-Host ''
Write-Host '  In Claude Code:'
Write-Host '    /byt help'
Write-Host '    /byt list --available'
Write-Host '    /byt install software-dev'
Write-Host ''
Write-Host "  (Restart Claude Code if the /byt command does not show up.)"
