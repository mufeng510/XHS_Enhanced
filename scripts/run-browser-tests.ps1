$ErrorActionPreference = 'Stop'
function Stop-XhsEnhancedBrowserProcesses {
  try {
    $owned = Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -in @('msedge.exe','chrome.exe') -and $_.CommandLine -like '*xhs-enhanced-*' }
    $owned | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    for ($wait = 0; $wait -lt 20; $wait++) {
      $remaining = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -in @('msedge.exe','chrome.exe') -and $_.CommandLine -like '*xhs-enhanced-*' }
      if (-not $remaining) { break }
      Start-Sleep -Milliseconds 100
    }
  } catch {
    # The harness remains fail-closed if process inspection is unavailable.
  }
}
Stop-XhsEnhancedBrowserProcesses
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
$listener.Start(); $serverPort = ($listener.LocalEndpoint).Port; $listener.Stop()
$serverLog = Join-Path (Resolve-Path '.omx/tmp').Path ("xhs-enhanced-server-" + [guid]::NewGuid().ToString('N') + '.log')
$serverErrorLog = "$serverLog.err"
$server = Start-Process -FilePath (Get-Command node).Source -ArgumentList @('scripts/browser-test-server.cjs', $serverPort) -PassThru -WindowStyle Hidden -RedirectStandardOutput $serverLog -RedirectStandardError $serverErrorLog
$candidates = @(
  @{ Name = 'Edge'; Path = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" },
  @{ Name = 'Edge'; Path = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe" },
  @{ Name = 'Chrome'; Path = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" },
  @{ Name = 'Chrome'; Path = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe" },
  @{ Name = 'Chrome'; Path = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe" }
)
$browser = $candidates | Where-Object { Test-Path -LiteralPath $_.Path } | Select-Object -First 1
if (-not $browser) {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $serverLog,$serverErrorLog -Force -ErrorAction SilentlyContinue
  Write-Error 'ENVIRONMENT SKIP: Chrome or Edge executable was not found; browser verification is unavailable.'
  exit 2
}
$version = (Get-Item -LiteralPath $browser.Path).VersionInfo.ProductVersion
$uri = "http://127.0.0.1:$serverPort/search_result"
$deadline = (Get-Date).AddSeconds(5)
do { try { $ready = (Invoke-WebRequest -UseBasicParsing -Uri $uri -TimeoutSec 1).StatusCode -eq 200 } catch { $ready = $false }; if(-not $ready){Start-Sleep -Milliseconds 50} } while(-not $ready -and (Get-Date) -lt $deadline)
if(-not $ready){
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $serverLog,$serverErrorLog -Force -ErrorAction SilentlyContinue
  throw 'Browser test server failed to start'
}
$profile = Join-Path (Resolve-Path '.omx/tmp').Path ("xhs-enhanced-browser-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $profile | Out-Null
try {
  $argumentString = "--headless --single-process --no-sandbox --disable-gpu --disable-extensions --disable-crash-reporter --no-first-run --no-default-browser-check --disable-features=msEdgeFirstRunExperience,msEdgeSync,msEdgeAccountConsistency --disable-background-networking --no-proxy-server --allow-file-access-from-files --user-data-dir=`"$profile`" --virtual-time-budget=10000 --dump-dom `"$uri`""
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $browser.Path
  $startInfo.Arguments = $argumentString
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  [void]$process.Start()
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $exitCode = $process.ExitCode
  [string]$output = $stdoutTask.Result
  [string]$diagnostics = $stderrTask.Result
  if ($exitCode -ne 0) { Write-Error "Browser dump failed with exit code $exitCode`n$output"; exit $exitCode }
  $result = [regex]::Match($output, 'data-test-result="([^"]+)"').Groups[1].Value
  $writes = [regex]::Match($output, 'data-test-terminal-writes="([^"]+)"').Groups[1].Value
  $summary = [regex]::Match($output, 'data-test-summary="([^"]*)"').Groups[1].Value
  if (-not $result) {
    # Some managed Windows Edge installations detach their launcher and emit no
    # --dump-dom output. Keep the same bounded, fail-closed harness protocol and
    # read its unique terminal marker through Edge's loopback-only debug listing.
    Stop-XhsEnhancedBrowserProcesses
    Start-Sleep -Milliseconds 500
    for ($attempt = 1; $attempt -le 5 -and -not $result; $attempt++) {
      $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
      $listener.Start(); $port = ($listener.LocalEndpoint).Port; $listener.Stop()
      $debugProfile = Join-Path (Resolve-Path '.omx/tmp').Path ("xhs-enhanced-debug-" + [guid]::NewGuid().ToString('N'))
      New-Item -ItemType Directory -Path $debugProfile | Out-Null
      $debugArgs = @('--headless','--no-sandbox','--disable-gpu','--disable-extensions','--disable-crash-reporter','--disable-breakpad','--noerrdialogs','--no-first-run','--no-default-browser-check','--disable-features=msEdgeFirstRunExperience,msEdgeSync,msEdgeAccountConsistency','--disable-background-networking','--no-proxy-server','--allow-file-access-from-files',"--remote-debugging-port=$port",'--remote-allow-origins=*',"--user-data-dir=$debugProfile",$uri)
      $debugProcess = Start-Process -FilePath $browser.Path -ArgumentList $debugArgs -PassThru -WindowStyle Hidden
      try {
        $deadline = (Get-Date).AddSeconds(12)
        $page = $null; $pages = $null
        do {
          Start-Sleep -Milliseconds 100
          try {
            $pages = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json" -TimeoutSec 1
            $page = $pages | Where-Object { $_.url -eq $uri -and $_.title -like 'XHS-HARNESS|*' } | Select-Object -First 1
          } catch { $page = $null }
        } while (-not $page -and (Get-Date) -lt $deadline)
        if ($page -and $page.title -match '^XHS-HARNESS\|(pass|fail)\|(\d+)\|(\d+)\|(.*)$') {
          $result = $Matches[1]; $writes = $Matches[2]; $summary = "assertions=$($Matches[3]); firstFailure=$([uri]::UnescapeDataString($Matches[4])); transport=loopback-debug-listing; attempt=$attempt"
        } elseif ($attempt -eq 5) {
          $result = 'pending'; $writes = '0'; $summary = 'debug fallback timed out after 5 attempts; pages=' + (($pages | Select-Object title,url,type | ConvertTo-Json -Compress) -replace "`r|`n", '')
        }
        if ($page) { try { Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/close/$($page.id)" -Method Put -TimeoutSec 1 | Out-Null } catch {} }
      } finally {
        if ($debugProcess -and -not $debugProcess.HasExited) { Stop-Process -Id $debugProcess.Id -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Milliseconds 100
        if (Test-Path -LiteralPath $debugProfile) { Remove-Item -LiteralPath $debugProfile -Recurse -Force -ErrorAction SilentlyContinue }
      }
    }
  }
  Write-Output "Browser: $($browser.Name) $version"
  Write-Output "Harness result: $result; terminal writes: $writes"
  Write-Output "Harness summary (HTML encoded): $summary"
  if ($result -ne 'pass' -or $writes -ne '1') { Write-Error "Harness did not reach one explicit pass terminal state.`nDiagnostics:`n$diagnostics`nDOM:`n$output"; exit 1 }
} finally {
  Stop-XhsEnhancedBrowserProcesses
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $serverLog) { Remove-Item -LiteralPath $serverLog -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $serverErrorLog) { Remove-Item -LiteralPath $serverErrorLog -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $profile) { Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue }
}
