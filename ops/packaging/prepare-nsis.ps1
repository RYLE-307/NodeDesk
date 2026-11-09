param([string] $TempRoot = $env:RUNNER_TEMP)
$ErrorActionPreference = 'Stop'

# Tauri bundler 2.x pins these exact upstream files and SHA-1 values.
# The GitHub release asset API works when the public browser download endpoint
# intermittently returns 504. Do not use an unverified mirror or cached DLL.
function Get-VerifiedAsset {
  param(
    [string] $Repository,
    [string] $Tag,
    [string] $Name,
    [string] $ExpectedSha1,
    [string] $Output
  )
  # Authenticate public release-asset API reads to avoid shared-runner rate limits.
  # GH_TOKEN is an ephemeral read-only Actions token, never an embedded secret.
  $headers = @{ 'User-Agent' = 'NodeDesk-package-preview'; Accept = 'application/vnd.github+json' }
  if ($env:GH_TOKEN) { $headers.Authorization = "Bearer $env:GH_TOKEN" }
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases/tags/$Tag" -Headers $headers
  $asset = @($release.assets | Where-Object { $_.name -eq $Name })
  if ($asset.Count -ne 1) { throw "Expected one upstream asset: $Name" }
  $headers.Accept = 'application/octet-stream'
  Invoke-WebRequest -Uri "https://api.github.com/repos/$Repository/releases/assets/$($asset[0].id)" `
    -Headers $headers -OutFile $Output
  $hash = (Get-FileHash -LiteralPath $Output -Algorithm SHA1).Hash
  if ($hash -ne $ExpectedSha1) { throw "Upstream asset checksum mismatch: $Name" }
}

$tools = Join-Path $PWD 'src-tauri/target/.tauri'
$nsis = Join-Path $tools 'NSIS'
if (-not $TempRoot) { throw 'Temporary directory unavailable' }
$workspace = [IO.Path]::GetFullPath((Get-Location).Path).TrimEnd([IO.Path]::DirectorySeparatorChar)
$expected = [IO.Path]::GetFullPath((Join-Path $workspace 'src-tauri/target/.tauri/NSIS'))
if ([IO.Path]::GetFullPath($nsis) -ne $expected -or
    -not $expected.StartsWith($workspace + [IO.Path]::DirectorySeparatorChar,
      [StringComparison]::OrdinalIgnoreCase)) { throw 'NSIS tool path escaped workspace' }
# Tauri's unbundled build can populate this cache before the preview step.
# Remove only this checked workspace path and fetch checksum-verified tools again.
if (Test-Path -LiteralPath $expected) { Remove-Item -LiteralPath $expected -Recurse -Force }
New-Item -ItemType Directory -Force -Path $tools | Out-Null
$zip = Join-Path $TempRoot 'nsis-3.13.zip'
$dll = Join-Path $TempRoot 'nsis_tauri_utils.dll'
Get-VerifiedAsset -Repository 'tauri-apps/binary-releases' -Tag 'nsis-3.13' `
  -Name 'nsis-3.13.zip' -ExpectedSha1 'DB14F8AF2EA346B786C6AE19343F61AAF5E09B8E' -Output $zip
Get-VerifiedAsset -Repository 'tauri-apps/nsis-tauri-utils' -Tag 'nsis_tauri_utils-v0.5.3' `
  -Name 'nsis_tauri_utils.dll' -ExpectedSha1 '75197FEE3C6A814FE035788D1C34EAD39349B860' -Output $dll
Expand-Archive -LiteralPath $zip -DestinationPath $tools
Move-Item -LiteralPath (Join-Path $tools 'nsis-3.13') -Destination $nsis
$plugins = Join-Path $nsis 'Plugins/x86-unicode/additional'
New-Item -ItemType Directory -Force -Path $plugins | Out-Null
Copy-Item -LiteralPath $dll -Destination (Join-Path $plugins 'nsis_tauri_utils.dll')
Write-Host 'Verified NSIS tools prepared for Tauri bundling.'
