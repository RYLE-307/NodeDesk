$ErrorActionPreference = 'Stop'
# CI-only disposable peer, no services, developer identities or trust-store changes.
$fixture = Join-Path $env:RUNNER_TEMP ('nodedesk-native-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $fixture | Out-Null
$python = (Get-Command python).Source
$script = Join-Path $PSScriptRoot 'windows-sftp-fixture.py'
$peer = Start-Process -FilePath $python -ArgumentList @('"' + $script + '"', '"' + $fixture + '"') -PassThru -WindowStyle Hidden
try {
    for ($attempt = 0; $attempt -lt 100; $attempt++) {
        if (Test-Path -LiteralPath (Join-Path $fixture 'ready')) { break }
        if ($peer.HasExited) { throw 'Isolated SSH peer exited before readiness' }
        Start-Sleep -Milliseconds 100
    }
    if (!(Test-Path -LiteralPath (Join-Path $fixture 'ready'))) { throw 'SSH peer readiness timeout' }
    $env:NODEDESK_SSH_FIXTURE = $fixture
    cargo test --locked --manifest-path src-tauri/Cargo.toml native_auth::tests::real_native_password_pam_trust_binary_and_cancel -- --exact --nocapture
    if ($LASTEXITCODE -ne 0) { throw 'Windows native SSH/SFTP integration failed' }
} finally {
    Remove-Item Env:NODEDESK_SSH_FIXTURE -ErrorAction SilentlyContinue
    if (!$peer.HasExited) { Stop-Process -Id $peer.Id -Force }
    $resolvedFixture = [IO.Path]::GetFullPath($fixture)
    $resolvedTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
    if ($resolvedFixture.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($resolvedFixture).StartsWith('nodedesk-native-')) {
        Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
    } else { throw 'Refusing fixture cleanup outside runner temporary directory' }
}
