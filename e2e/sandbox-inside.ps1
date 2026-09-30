# Runs inside Windows Sandbox (see sandbox.mjs): records whether the sandbox can reach the
# internet and whether a WebView2 runtime is present, installs the app silently for the current
# user from the installer in this folder, starts it, and writes what it saw to out\result.json.
# It never throws before the result is written — a result file with a failure in it tells the
# host more than a sandbox that never answers.
#
# -Target installs somewhere else and -Cleanup stops the app and uninstalls it afterwards, so the
# script can be tried on a host (where the sandbox is thrown away instead). -WithoutWebView2
# removes the WebView2 runtime first, so the installer meets a computer that does not have it —
# only inside the sandbox, whose account is WDAGUtilityAccount.

param([string]$Target = (Join-Path $env:LOCALAPPDATA 'openquote-care-sandbox'), [switch]$Cleanup, [switch]$WithoutWebView2)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $here 'out'
New-Item -ItemType Directory -Force $out | Out-Null
$result = [ordered]@{ started = (Get-Date).ToString('o'); steps = @() }

function Step($name, [scriptblock]$body) {
  try {
    $value = & $body
    $result.steps += [ordered]@{ name = $name; ok = $true; value = $value }
  } catch {
    $result.steps += [ordered]@{ name = $name; ok = $false; error = $_.Exception.Message }
  }
}

# The WebView2 runtime registers its version under EdgeUpdate, per machine or per user.
function WebView2Version {
  $id = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  foreach ($key in @(
      "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$id",
      "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$id",
      "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$id")) {
    $pv = (Get-ItemProperty -Path $key -Name pv -ErrorAction SilentlyContinue).pv
    if ($pv -and $pv -ne '0.0.0.0') { return "$pv ($key)" }
  }
  return $null
}

Step 'network' {
  try {
    Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -Method Head -TimeoutSec 10 -UseBasicParsing | Out-Null
    'online'
  } catch { 'offline' }
}
if ($WithoutWebView2) {
  Step 'remove webview2' {
    if ($env:USERNAME -ne 'WDAGUtilityAccount') { throw 'refusing to remove WebView2 outside Windows Sandbox' }
    $entry = Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft EdgeWebView' -ErrorAction SilentlyContinue
    if (-not $entry) { return 'not installed' }
    # The runtime marks itself as not removable; its own setup removes it when forced.
    if ($entry.UninstallString -notmatch '^"([^"]+)"\s*(.*)$') { throw "unexpected uninstall command: $($entry.UninstallString)" }
    $p = Start-Process -FilePath $Matches[1] -ArgumentList "$($Matches[2]) --force-uninstall" -Wait -PassThru
    $left = WebView2Version
    if ($left) { throw "still registered after the uninstaller exited with $($p.ExitCode): $left" }
    "removed (the uninstaller exited with $($p.ExitCode))"
  }
}
Step 'webview2 before' { WebView2Version }

$installer = Get-ChildItem $here -Filter '*-setup.exe' | Select-Object -First 1
$target = $Target
Step 'installer' { $installer.Name }
Step 'install' {
  # NSIS: /S is silent, /D= must come last and unquoted.
  $p = Start-Process -FilePath $installer.FullName -ArgumentList '/S', "/D=$target" -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "the installer exited with $($p.ExitCode)" }
  (Get-ChildItem $target -Name) -join ', '
}
Step 'webview2 after' { WebView2Version }
Step 'start' {
  $script:app = Start-Process -FilePath (Join-Path $target 'openquote-care.exe') -PassThru
  Start-Sleep -Seconds 20
  if ($script:app.HasExited) { throw "the app exited with $($script:app.ExitCode)" }
  # Only the web view the app started counts — other apps may run their own.
  $webview = Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe' AND ParentProcessId = $($script:app.Id)"
  if (-not $webview) { throw 'the app is running but has started no WebView2 process' }
  "the app is running with its web view ($(@($webview)[0].ExecutablePath))"
}
# The app starts its engine only when a vault is opened, so the bundled engine is started here
# the way the app starts it: a token and a device name in the environment, the port on the first
# line, then an empty vault loaded over loopback.
Step 'engine' {
  $start = New-Object System.Diagnostics.ProcessStartInfo (Join-Path $target 'sidecar\openquote-care-sidecar.exe')
  $start.UseShellExecute = $false
  $start.RedirectStandardOutput = $true
  $token = [guid]::NewGuid().ToString('n')
  $start.EnvironmentVariables['OPENQUOTE_SIDECAR_TOKEN'] = $token
  $start.EnvironmentVariables['OPENQUOTE_DEVICE'] = 'sandbox'
  $engine = [System.Diagnostics.Process]::Start($start)
  try {
    $line = $engine.StandardOutput.ReadLineAsync()
    if (-not $line.Wait(30000)) { throw 'the engine printed no readiness line within 30 s' }
    if ($line.Result -notmatch 'ready port=(\d+)') { throw "unexpected readiness line: $($line.Result)" }
    $body = '{"files":[],"undecryptable":[]}'
    $summary = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($Matches[1])/vault/load" -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body
    "ready on loopback, empty vault loaded ($(($summary | ConvertTo-Json -Compress -Depth 3).Length) bytes of summary)"
  } finally {
    if (-not $engine.HasExited) { $engine.Kill() }
  }
}

if ($Cleanup) {
  Step 'uninstall' {
    if ($script:app -and -not $script:app.HasExited) { Stop-Process -Id $script:app.Id -Force }
    $p = Start-Process -FilePath (Join-Path $target 'uninstall.exe') -ArgumentList '/S' -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "the uninstaller exited with $($p.ExitCode)" }
    'removed'
  }
}

$result.finished = (Get-Date).ToString('o')
$result.ok = -not ($result.steps | Where-Object { -not $_.ok })
$result | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $out 'result.json')
