$ErrorActionPreference = 'Stop'
$folder = Join-Path $PSScriptRoot '../../src-tauri/target/release/bundle/nsis'
$installers = @(Get-ChildItem -LiteralPath $folder -Filter '*.exe' -File)
if ($installers.Count -ne 1) { throw 'Expected exactly one disposable NSIS preview' }
$installer = $installers[0]
$checksumFile = Join-Path $folder 'SHA256SUMS.txt'
$expected = (Get-Content -LiteralPath $checksumFile -Raw).Trim()
$actualHash = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
if ($expected -ne "$actualHash  $($installer.Name)") { throw 'NSIS preview checksum mismatch' }

# A unique runner-only path avoids touching any pre-existing application install.
$installPath = Join-Path $env:RUNNER_TEMP ("nodedesk-nsis-smoke-" + [guid]::NewGuid().ToString('N'))
$install = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$installPath") -Wait -PassThru -WindowStyle Hidden
if ($install.ExitCode -ne 0) { throw "NSIS preview install failed: $($install.ExitCode)" }
$binary = Join-Path $installPath 'nodedesk.exe'
$uninstaller = Join-Path $installPath 'uninstall.exe'
if (!(Test-Path -LiteralPath $binary -PathType Leaf)) { throw 'Installed NodeDesk executable is missing' }
if (!(Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw 'NSIS uninstaller is missing' }

$uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
if ($uninstall.ExitCode -ne 0) { throw "NSIS preview uninstall failed: $($uninstall.ExitCode)" }
if (Test-Path -LiteralPath $binary) { throw 'Uninstall left the NodeDesk executable behind' }
