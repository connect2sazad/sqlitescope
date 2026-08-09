$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logsDir = Join-Path $projectRoot 'logs'
$logPath = Join-Path $logsDir 'sqlitescope-startup.log'
$stdoutPath = Join-Path $logsDir 'install-output.tmp.log'
$stderrPath = Join-Path $logsDir 'install-error.tmp.log'
$electronStdoutPath = Join-Path $logsDir 'electron-output.tmp.log'
$electronStderrPath = Join-Path $logsDir 'electron-error.tmp.log'

New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

function Write-Log([string]$message) {
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'
  Add-Content -Path $logPath -Value "[$timestamp] $message" -Encoding UTF8
}

function Show-Error([string]$message) {
  Add-Type -AssemblyName System.Windows.Forms
  $choice = [System.Windows.Forms.MessageBox]::Show(
    "$message`r`n`r`nLog: $logPath`r`n`r`nOpen the log now?",
    'SQLiteScope',
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Error
  )
  if ($choice -eq [System.Windows.Forms.DialogResult]::Yes -and (Test-Path $logPath)) {
    Start-Process notepad.exe -ArgumentList @($logPath)
  }
}

function Install-Dependencies([string]$npmPath) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'SQLiteScope Setup'
  $form.Size = New-Object System.Drawing.Size(520, 190)
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.ControlBox = $false
  $form.TopMost = $true

  $title = New-Object System.Windows.Forms.Label
  $title.Text = 'Preparing SQLiteScope'
  $title.Font = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
  $title.AutoSize = $true
  $title.Location = New-Object System.Drawing.Point(24, 22)
  $form.Controls.Add($title)

  $status = New-Object System.Windows.Forms.Label
  $status.Text = 'Installing application dependencies. This is required only once.'
  $status.Font = New-Object System.Drawing.Font('Segoe UI', 9)
  $status.AutoSize = $true
  $status.Location = New-Object System.Drawing.Point(26, 59)
  $form.Controls.Add($status)

  $progress = New-Object System.Windows.Forms.ProgressBar
  $progress.Location = New-Object System.Drawing.Point(28, 91)
  $progress.Size = New-Object System.Drawing.Size(450, 22)
  $progress.Style = 'Marquee'
  $progress.MarqueeAnimationSpeed = 28
  $form.Controls.Add($progress)

  $detail = New-Object System.Windows.Forms.Label
  $detail.Text = 'Please wait. A detailed log is being recorded.'
  $detail.Font = New-Object System.Drawing.Font('Segoe UI', 8)
  $detail.ForeColor = [System.Drawing.Color]::DimGray
  $detail.AutoSize = $true
  $detail.Location = New-Object System.Drawing.Point(26, 124)
  $form.Controls.Add($detail)

  Remove-Item $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  # User-level npm/environment settings can silently suppress Electron's
  # postinstall binary download while npm still exits successfully. Override
  # those settings for this application installation only.
  $env:ELECTRON_SKIP_BINARY_DOWNLOAD = $null
  $env:ELECTRON_OVERRIDE_DIST_PATH = $null
  $env:ELECTRON_RUN_AS_NODE = $null
  $env:npm_config_ignore_scripts = 'false'
  Write-Log "Starting npm install with $npmPath"
  $process = Start-Process -FilePath $npmPath -ArgumentList @('install', '--include=dev', '--ignore-scripts=false', '--no-audit', '--no-fund', '--loglevel', 'notice') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  [void]$form.Show()

  $started = Get-Date
  while (-not $process.HasExited) {
    $elapsed = [int]((Get-Date) - $started).TotalSeconds
    $detail.Text = "Installing dependencies... ${elapsed}s elapsed. Detailed log is being recorded."
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 150
    $process.Refresh()
  }

  # Start-Process can expose a blank ExitCode until the redirected streams and
  # native process handle have been fully finalized. Explicitly wait, refresh,
  # and copy the value before disposing the UI/process object.
  $process.WaitForExit()
  $process.Refresh()
  $installExitCode = $process.ExitCode
  if ($null -eq $installExitCode) {
    Write-Log 'WARNING: Windows did not expose an npm exit code. Installation artifacts will be verified instead.'
  } else {
    Write-Log "npm install exited with code $installExitCode"
  }
  if (Test-Path $stdoutPath) {
    Add-Content -Path $logPath -Value "`r`n--- npm output ---" -Encoding UTF8
    Get-Content $stdoutPath | Add-Content -Path $logPath -Encoding UTF8
  }
  if (Test-Path $stderrPath) {
    Add-Content -Path $logPath -Value "`r`n--- npm errors and warnings ---" -Encoding UTF8
    Get-Content $stderrPath | Add-Content -Path $logPath -Encoding UTF8
  }
  Remove-Item $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  $installedElectron = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
  $installedPackage = Join-Path $projectRoot 'node_modules\electron\package.json'

  # npm can report success even when a machine-wide setting skipped package
  # scripts. If the JS package exists but the platform binary does not, invoke
  # Electron's official installer directly and capture its real diagnostics.
  if ((Test-Path $installedPackage) -and -not (Test-Path $installedElectron)) {
    $status.Text = 'Downloading the Electron runtime...'
    $detail.Text = 'Repairing an incomplete Electron installation. Detailed log is being recorded.'
    [System.Windows.Forms.Application]::DoEvents()
    Write-Log 'Electron package exists but its Windows runtime is missing. Starting explicit runtime repair.'

    $electronDir = Join-Path $projectRoot 'node_modules\electron'
    Remove-Item (Join-Path $electronDir 'dist'), (Join-Path $electronDir 'path.txt') -Recurse -Force -ErrorAction SilentlyContinue
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    $installScript = Join-Path $electronDir 'install.js'
    $repair = Start-Process -FilePath $nodePath -ArgumentList @($installScript) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    $repairStarted = Get-Date
    while (-not $repair.HasExited) {
      $elapsed = [int]((Get-Date) - $repairStarted).TotalSeconds
      $detail.Text = "Downloading Electron runtime... ${elapsed}s elapsed. Detailed log is being recorded."
      [System.Windows.Forms.Application]::DoEvents()
      Start-Sleep -Milliseconds 150
      $repair.Refresh()
    }
    $repair.WaitForExit()
    $repair.Refresh()
    Write-Log "Explicit Electron runtime repair completed (reported exit code: $($repair.ExitCode))."
    if (Test-Path $stdoutPath) {
      Add-Content -Path $logPath -Value "`r`n--- Electron repair output ---" -Encoding UTF8
      Get-Content $stdoutPath | Add-Content -Path $logPath -Encoding UTF8
    }
    if (Test-Path $stderrPath) {
      Add-Content -Path $logPath -Value "`r`n--- Electron repair errors ---" -Encoding UTF8
      Get-Content $stderrPath | Add-Content -Path $logPath -Encoding UTF8
    }
    Remove-Item $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }

  $form.Close()
  $form.Dispose()
  if (-not (Test-Path $installedElectron) -or -not (Test-Path $installedPackage)) {
    throw 'Electron runtime download failed. The startup log now contains the actual download error. Check internet/proxy settings, then try again.'
  }
  if ($null -ne $installExitCode -and [int]$installExitCode -ne 0) {
    throw "Dependency installation returned exit code $installExitCode even though partial Electron files exist."
  }
  Write-Log 'Electron installation artifacts verified successfully.'
  return 0
}

try {
  Write-Log 'Launcher started.'
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $node -or -not $npm) { throw 'Node.js 22 LTS or newer is required. Install Node.js, then start SQLiteScope again.' }
  $nodeVersion = (& $node.Source -p "process.versions.node").Trim()
  Write-Log "Detected Node.js $nodeVersion at $($node.Source)"
  $major = [int]($nodeVersion.Split('.')[0])
  if ($major -lt 22) { throw "SQLiteScope requires Node.js 22 or newer. Installed version: $nodeVersion." }

  $electron = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
  if (-not (Test-Path $electron)) {
    $exitCode = Install-Dependencies $npm.Source
    if ($exitCode -ne 0) { throw "Dependency installation failed with exit code $exitCode." }
    Write-Log 'Dependency installation completed successfully.'
  }
  if (-not (Test-Path $electron)) { throw 'Electron is still missing after installation. Delete node_modules and start SQLiteScope again.' }

  # A machine-wide ELECTRON_RUN_AS_NODE setting makes electron.exe behave like
  # plain Node.js and causes the app to exit before creating a window.
  $env:ELECTRON_RUN_AS_NODE = $null
  Remove-Item $electronStdoutPath, $electronStderrPath -Force -ErrorAction SilentlyContinue
  Write-Log "Starting Electron from $electron"
  $electronProcess = Start-Process -FilePath $electron -ArgumentList @($projectRoot) -WorkingDirectory $projectRoot -PassThru -RedirectStandardOutput $electronStdoutPath -RedirectStandardError $electronStderrPath
  Write-Log "Electron process created with PID $($electronProcess.Id). Waiting for startup verification."

  $startupDeadline = (Get-Date).AddSeconds(8)
  while ((Get-Date) -lt $startupDeadline -and -not $electronProcess.HasExited) {
    Start-Sleep -Milliseconds 200
    $electronProcess.Refresh()
  }
  if ($electronProcess.HasExited) {
    $electronProcess.WaitForExit()
    if (Test-Path $electronStdoutPath) {
      Add-Content -Path $logPath -Value "`r`n--- Electron output ---" -Encoding UTF8
      Get-Content $electronStdoutPath | Add-Content -Path $logPath -Encoding UTF8
    }
    if (Test-Path $electronStderrPath) {
      Add-Content -Path $logPath -Value "`r`n--- Electron errors ---" -Encoding UTF8
      Get-Content $electronStderrPath | Add-Content -Path $logPath -Encoding UTF8
    }
    throw "SQLiteScope closed during startup. Electron reported exit code $($electronProcess.ExitCode). Review the startup log for the exact error."
  }
  Write-Log 'SQLiteScope remained running after startup verification.'
} catch {
  Write-Log "ERROR: $($_.Exception.ToString())"
  Show-Error $_.Exception.Message
}
