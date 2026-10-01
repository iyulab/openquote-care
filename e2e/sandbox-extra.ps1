# The app's own step in the Windows Sandbox check (`npm run test:sandbox`), dot-sourced by the
# check's inside script after the app has started, with `Step` and `$target` in reach.
#
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
