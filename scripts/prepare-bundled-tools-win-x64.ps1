param(
  [switch]$Force,
  [switch]$VerifyOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if ($env:OS -ne "Windows_NT") {
  throw "Bundled tool preparation is supported only on Windows."
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$resourcesRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "src-tauri/resources"))
$toolsRoot = [System.IO.Path]::GetFullPath((Join-Path $resourcesRoot "tools"))
$resourcePrefix = $resourcesRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $toolsRoot.StartsWith($resourcePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to prepare bundled tools outside the resource root."
}

$cloudflaredUrl = "https://github.com/cloudflare/cloudflared/releases/download/2026.2.0/cloudflared-windows-amd64.exe"
$cloudflaredSha256 = "B3279F2186A1C3C438AD5865E802BBBEC26090C5D3FDB4AC1113F1143A94837A"
$cloudflaredBytes = 65210696L
$uvArchiveUrl = "https://github.com/astral-sh/uv/releases/download/0.11.10/uv-x86_64-pc-windows-msvc.zip"
$uvArchiveSha256 = "7A0C424C7BC55A74751F13592235953EBBE182FA00355F7AE3FB7AB734A51638"
$uvArchiveBytes = 23346442L
$uvExeSha256 = "FA49AB924DE620FA2C68617E237A6130E64DA56AB76F7505C59DA21539F7FBED"
$uvxExeSha256 = "420A79F4FFF91DAE68A9AE2A6E29EBE5AF1F79E9EFA759D95B650165AE7E6839"
$tectonicArchiveUrl = "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.15.0/tectonic-0.15.0-x86_64-pc-windows-msvc.zip"
$tectonicArchiveSha256 = "1D6BB76F049C8A3774F6E9D66E4B04E1A8C3DCB37527B6B41B7E894328E7BF29"
$tectonicArchiveBytes = 19268177L
$tectonicExeSha256 = "6760C6368D3219C687EB1811E55379AF9526FBD97E97FA954968267F5241DEB9"
$tectonicBundleUrl = "https://data1.fullyjustified.net/tlextras-2022.0r0.tar"
# The packaged offline bundle is the hash-pinned prefix containing all runtime-required entries,
# not the upstream 2.68 GiB archive tail that the app never reads.
$tectonicBundleSha256 = "97C391AFC858845A66811C21DA7DD8318EA4E7D5BD6E2C509A893109F56C9848"
$tectonicBundleBytes = 414351360L
$cacheKey = "6ffe055852f8faf66c0acbe1a7fb27f87b869a90bad1204f3bf4d9683f597c7c"
$cacheManifestSha256 = "6326EE46A4AABC85256A4865AECBE3521961FDB9721BF4ACA1AD1C247D009150"
$cacheIndexSha256 = "0FB434B0FA5FDEBEA7F767ED9C31939C99A780D6F95CD3F540AAE55910BB5697"
$cmexPfbSha256 = "791B31AA1DB8608D0144B3A40FC0FE53383A60F6B00D0E8FD9F06AC4A11DF8CB"
$offlineSeedArchive = Join-Path $PSScriptRoot "assets/tectonic-offline-seed-2022.0r0.zip"
$offlineSeedArchiveSha256 = "8313FDD44E93D85B13653579A66C67D62893ACC20EE9F3FEB87B9393542D1281"

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Assert-PinnedFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Sha256,
    [long]$Length = -1
  )
  $item = Get-Item -LiteralPath $Path -ErrorAction Stop
  if (-not $item.PSIsContainer -and ($Length -lt 0 -or $item.Length -eq $Length)) {
    $actual = Get-Sha256 -Path $item.FullName
    if ($actual -eq $Sha256) {
      return
    }
    throw "Integrity mismatch for $Path (sha256=$actual)."
  }
  throw "Size or file-type mismatch for $Path."
}

function Assert-BundledTools {
  param([Parameter(Mandatory = $true)][string]$Root)

  Assert-PinnedFile (Join-Path $Root "cloudflared-windows-amd64.exe") $cloudflaredSha256 $cloudflaredBytes
  Assert-PinnedFile (Join-Path $Root "uv/windows-x64/uv.exe") $uvExeSha256
  Assert-PinnedFile (Join-Path $Root "uv/windows-x64/uvx.exe") $uvxExeSha256
  Assert-PinnedFile (Join-Path $Root "tectonic/windows-x64/tectonic.exe") $tectonicExeSha256
  Assert-PinnedFile (Join-Path $Root "tectonic/bundles/tlextras-2022.0r0.tar") $tectonicBundleSha256 $tectonicBundleBytes
  Assert-PinnedFile (Join-Path $Root "tectonic/cache-seed/manifests/$cacheKey.txt") $cacheManifestSha256
  Assert-PinnedFile (Join-Path $Root "tectonic/cache-seed/indexes/$cacheKey.txt") $cacheIndexSha256
  Assert-PinnedFile (Join-Path $Root "tectonic/pfb/cmex10.pfb") $cmexPfbSha256

  foreach ($relative in @("tectonic/cache-seed/files", "tectonic/cache-seed/redirects", "tectonic/cache-seed/urls")) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root $relative) -PathType Container)) {
      throw "Bundled Tectonic directory is missing: $relative"
    }
  }
  $cacheFiles = @(Get-ChildItem -LiteralPath (Join-Path $Root "tectonic/cache-seed/files") -Recurse -File)
  $pfbFiles = @(Get-ChildItem -LiteralPath (Join-Path $Root "tectonic/pfb") -File -Filter "*.pfb")
  if ($cacheFiles.Count -ne 107) {
    throw "Bundled Tectonic cache contains $($cacheFiles.Count) files; expected 107."
  }
  if ($pfbFiles.Count -ne 86) {
    throw "Bundled Tectonic PFB directory contains $($pfbFiles.Count) files; expected 86."
  }

  $cloudMetadata = Get-Content -LiteralPath (Join-Path $Root "cloudflared-version.json") -Raw | ConvertFrom-Json
  if ($cloudMetadata.version -ne "2026.2.0" -or $cloudMetadata.file -ne "cloudflared-windows-amd64.exe" -or [long]$cloudMetadata.size -ne $cloudflaredBytes -or [string]$cloudMetadata.sha256 -ne $cloudflaredSha256) {
    throw "Bundled cloudflared metadata mismatch."
  }
  $uvMetadata = Get-Content -LiteralPath (Join-Path $Root "uv/uv-version.json") -Raw | ConvertFrom-Json
  if ($uvMetadata.version -ne "uv 0.11.10 (add376fd9 2026-05-05 x86_64-pc-windows-msvc)" -or $uvMetadata.relativePath -ne "uv/windows-x64/uv.exe") {
    throw "Bundled uv metadata mismatch."
  }

  $uvVersion = (& (Join-Path $Root "uv/windows-x64/uv.exe") --version 2>&1 | Out-String).Trim()
  $tectonicVersion = (& (Join-Path $Root "tectonic/windows-x64/tectonic.exe") --version 2>&1 | Out-String).Trim()
  if (-not $uvVersion.Contains("uv 0.11.10") -or -not $tectonicVersion.Contains("Tectonic 0.15.0")) {
    throw "Bundled executable version verification failed."
  }
}

function Test-BundledTools {
  param([Parameter(Mandatory = $true)][string]$Root)
  try {
    Assert-BundledTools -Root $Root
    return $true
  } catch {
    Write-Host "[prepare-bundled-tools] verification miss: $($_.Exception.Message)"
    return $false
  }
}

function Save-PinnedDownload {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$Sha256,
    [long]$Length = -1,
    [long]$RangeEnd = -1
  )
  $parent = Split-Path -Parent $Destination
  [System.IO.Directory]::CreateDirectory($parent) | Out-Null
  $partial = "$Destination.download"
  if (Test-Path -LiteralPath $partial) {
    Remove-Item -LiteralPath $partial -Force
  }
  Write-Host "[prepare-bundled-tools] downloading $Uri"
  if ($RangeEnd -ge 0) {
    Invoke-WebRequest -Uri $Uri -OutFile $partial -MaximumRedirection 8 -TimeoutSec 900 -Headers @{ Range = "bytes=0-$RangeEnd" }
  } else {
    Invoke-WebRequest -Uri $Uri -OutFile $partial -MaximumRedirection 8 -TimeoutSec 900
  }
  Assert-PinnedFile -Path $partial -Sha256 $Sha256 -Length $Length
  Move-Item -LiteralPath $partial -Destination $Destination -Force
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )
  [System.IO.Directory]::CreateDirectory((Split-Path -Parent $Path)) | Out-Null
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

Assert-PinnedFile -Path $offlineSeedArchive -Sha256 $offlineSeedArchiveSha256

if ($VerifyOnly) {
  Assert-BundledTools -Root $toolsRoot
  Write-Host "[prepare-bundled-tools] pinned Windows x64 resources verified."
  exit 0
}

if (-not $Force -and (Test-BundledTools -Root $toolsRoot)) {
  Write-Host "[prepare-bundled-tools] pinned Windows x64 resources already ready."
  exit 0
}

$stageRoot = Join-Path $resourcesRoot ".tools-prepare-$PID"
$downloadRoot = Join-Path $stageRoot ".downloads"
$seedExtractRoot = Join-Path $stageRoot ".offline-seed"
if (Test-Path -LiteralPath $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
[System.IO.Directory]::CreateDirectory($downloadRoot) | Out-Null

try {
  Save-PinnedDownload -Uri $cloudflaredUrl -Destination (Join-Path $stageRoot "cloudflared-windows-amd64.exe") -Sha256 $cloudflaredSha256 -Length $cloudflaredBytes
  $cloudMetadata = [ordered]@{
    version = "2026.2.0"
    file = "cloudflared-windows-amd64.exe"
    size = $cloudflaredBytes
    sha256 = $cloudflaredSha256
  } | ConvertTo-Json
  Write-Utf8NoBom -Path (Join-Path $stageRoot "cloudflared-version.json") -Content $cloudMetadata

  $uvArchive = Join-Path $downloadRoot "uv-x86_64-pc-windows-msvc.zip"
  Save-PinnedDownload -Uri $uvArchiveUrl -Destination $uvArchive -Sha256 $uvArchiveSha256 -Length $uvArchiveBytes
  $uvRoot = Join-Path $stageRoot "uv/windows-x64"
  Expand-Archive -LiteralPath $uvArchive -DestinationPath $uvRoot -Force
  $uvMetadata = [ordered]@{
    source = "github.com/astral-sh/uv/releases/download/0.11.10"
    target = "x86_64-pc-windows-msvc"
    version = "uv 0.11.10 (add376fd9 2026-05-05 x86_64-pc-windows-msvc)"
    relativePath = "uv/windows-x64/uv.exe"
    updatedAt = "2026-05-05T20:24:25Z"
  } | ConvertTo-Json
  Write-Utf8NoBom -Path (Join-Path $stageRoot "uv/uv-version.json") -Content $uvMetadata

  $tectonicArchive = Join-Path $downloadRoot "tectonic-0.15.0-x86_64-pc-windows-msvc.zip"
  Save-PinnedDownload -Uri $tectonicArchiveUrl -Destination $tectonicArchive -Sha256 $tectonicArchiveSha256 -Length $tectonicArchiveBytes
  $tectonicArchiveRoot = Join-Path $downloadRoot "tectonic"
  Expand-Archive -LiteralPath $tectonicArchive -DestinationPath $tectonicArchiveRoot -Force
  $tectonicExeRoot = Join-Path $stageRoot "tectonic/windows-x64"
  [System.IO.Directory]::CreateDirectory($tectonicExeRoot) | Out-Null
  Copy-Item -LiteralPath (Join-Path $tectonicArchiveRoot "tectonic.exe") -Destination (Join-Path $tectonicExeRoot "tectonic.exe") -Force

  $bundlePath = Join-Path $stageRoot "tectonic/bundles/tlextras-2022.0r0.tar"
  Save-PinnedDownload -Uri $tectonicBundleUrl -Destination $bundlePath -Sha256 $tectonicBundleSha256 -Length $tectonicBundleBytes -RangeEnd ($tectonicBundleBytes - 1)

  Expand-Archive -LiteralPath $offlineSeedArchive -DestinationPath $seedExtractRoot -Force
  $offlineSeedSource = Join-Path $seedExtractRoot "src-tauri/resources/tools/tectonic"
  $tectonicStageRoot = Join-Path $stageRoot "tectonic"
  Copy-Item -LiteralPath (Join-Path $offlineSeedSource "cache-seed") -Destination (Join-Path $tectonicStageRoot "cache-seed") -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $offlineSeedSource "pfb") -Destination (Join-Path $tectonicStageRoot "pfb") -Recurse -Force

  Remove-Item -LiteralPath $downloadRoot -Recurse -Force
  Remove-Item -LiteralPath $seedExtractRoot -Recurse -Force
  Assert-BundledTools -Root $stageRoot

  $backupRoot = Join-Path $resourcesRoot ".tools-previous-$PID"
  if (Test-Path -LiteralPath $backupRoot) {
    Remove-Item -LiteralPath $backupRoot -Recurse -Force
  }
  if (Test-Path -LiteralPath $toolsRoot) {
    Move-Item -LiteralPath $toolsRoot -Destination $backupRoot
  }
  try {
    Move-Item -LiteralPath $stageRoot -Destination $toolsRoot
  } catch {
    if (Test-Path -LiteralPath $backupRoot) {
      Move-Item -LiteralPath $backupRoot -Destination $toolsRoot
    }
    throw
  }
  if (Test-Path -LiteralPath $backupRoot) {
    Remove-Item -LiteralPath $backupRoot -Recurse -Force
  }
  Write-Host "[prepare-bundled-tools] pinned Windows x64 resources restored and verified."
} catch {
  if (Test-Path -LiteralPath $stageRoot) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
  }
  throw
}
