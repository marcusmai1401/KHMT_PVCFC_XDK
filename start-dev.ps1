param(
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173,
    [switch]$SkipInstall,
    [switch]$ResetData,
    [switch]$SeparateWindows,
    [switch]$WithProdData,
    [switch]$ResetUserPasswords
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RootDir "backend"
$FrontendDir = Join-Path $RootDir "frontend"
$BackendVenv = Join-Path $BackendDir ".venv"
$BackendPython = Join-Path $BackendVenv "Scripts\python.exe"
$FrontendUrl = "http://localhost:$FrontendPort"
$StorageDir = Join-Path $RootDir "storage"
$DatabasePath = Join-Path $StorageDir "okr_automation.db"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Quote-PowerShellString {
    param([string]$Value)
    return "'" + ($Value -replace "'", "''") + "'"
}

function Quote-NativeArgument {
    param([string]$Value)
    if ($null -eq $Value) {
        return '""'
    }
    if ($Value -notmatch '[\s"]') {
        return $Value
    }
    return '"' + ($Value -replace '"', '\"') + '"'
}

function Invoke-NativeProcess {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @()
    )
    $quotedArgs = @($Arguments | ForEach-Object { Quote-NativeArgument ([string]$_) })
    $process = Start-Process -FilePath $FilePath -ArgumentList $quotedArgs -NoNewWindow -Wait -PassThru
    return [int]$process.ExitCode
}

function Test-TcpPort {
    param([int]$Port)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(200)) {
            return $false
        }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Wait-ForHttp {
    param(
        [string]$Url,
        [int]$TimeoutSeconds = 90
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return $true
            }
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    return $false
}

function Require-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing command '$Name'. Please install it and rerun this script."
    }
}

function Clear-DirectoryContents {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
    Get-ChildItem -LiteralPath $Path -Force |
        Where-Object { $_.Name -ne ".gitkeep" } |
        Remove-Item -Recurse -Force
    $gitkeep = Join-Path $Path ".gitkeep"
    if (-not (Test-Path $gitkeep)) {
        New-Item -ItemType File -Path $gitkeep | Out-Null
    }
}

function Reset-DevData {
    if (-not (Test-Path $BackendPython)) {
        throw "Backend Python not found. Rerun without -SkipInstall first."
    }
    $resetScript = Join-Path $BackendDir "scripts\reset_demo_data.py"
    if (-not (Test-Path $resetScript)) {
        throw "Reset script not found: $resetScript"
    }
    Push-Location $BackendDir
    try {
        & $BackendPython $resetScript
        if ($LASTEXITCODE -ne 0) {
            throw "Demo data reset failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

function Receive-PrefixedJobOutput {
    param(
        [System.Management.Automation.Job]$Job,
        [string]$Prefix,
        [ConsoleColor]$Color
    )
    $lines = Receive-Job -Job $Job -ErrorAction Continue 2>&1
    foreach ($line in $lines) {
        if ($null -ne $line) {
            Write-Host "[$Prefix] " -NoNewline -ForegroundColor $Color
            Write-Host ($line.ToString())
        }
    }
}

function Receive-AllDevOutput {
    param(
        [System.Management.Automation.Job]$BackendJob,
        [System.Management.Automation.Job]$FrontendJob
    )
    if ($BackendJob) {
        Receive-PrefixedJobOutput -Job $BackendJob -Prefix "backend" -Color DarkCyan
    }
    if ($FrontendJob) {
        Receive-PrefixedJobOutput -Job $FrontendJob -Prefix "frontend" -Color DarkMagenta
    }
}

function Wait-ForDevServers {
    param(
        [System.Management.Automation.Job]$BackendJob,
        [System.Management.Automation.Job]$FrontendJob,
        [int]$TimeoutSeconds = 90
    )
    $backendReady = Test-TcpPort $BackendPort
    $frontendReady = Test-TcpPort $FrontendPort
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline -and (-not $backendReady -or -not $frontendReady)) {
        Receive-AllDevOutput -BackendJob $BackendJob -FrontendJob $FrontendJob
        if (-not $backendReady) {
            $backendReady = Wait-ForHttp "http://127.0.0.1:$BackendPort/health" 1
        }
        if (-not $frontendReady) {
            $frontendReady = Wait-ForHttp $FrontendUrl 1
        }
        Start-Sleep -Milliseconds 500
    }
    Receive-AllDevOutput -BackendJob $BackendJob -FrontendJob $FrontendJob
    return @{
        Backend = $backendReady
        Frontend = $frontendReady
    }
}

Write-Host "OKR Automation dev launcher" -ForegroundColor Green
Write-Host "Project: $RootDir"

if (-not (Test-Path $BackendDir)) {
    throw "Backend directory not found: $BackendDir"
}
if (-not (Test-Path $FrontendDir)) {
    throw "Frontend directory not found: $FrontendDir"
}

if ($ResetData) {
    Write-Step "Resetting development data"
    if (Test-TcpPort $BackendPort) {
        throw "Backend is already running on port $BackendPort. Close the 'OKR Backend' window first, then rerun with -ResetData."
    }
    Reset-DevData
    Write-Host "Cleared demo website data and runtime files. Historical import data T1-T4 is preserved." -ForegroundColor Yellow
}

function Invoke-BackendPython {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [string]$StepLabel,
        [switch]$WarnOnFail
    )
    if ($StepLabel) { Write-Step $StepLabel }
    $env:PYTHONIOENCODING = "utf-8"
    Push-Location $BackendDir
    try {
        $exit = Invoke-NativeProcess -FilePath $BackendPython -Arguments $Arguments
        if ($exit -ne 0) {
            if ($WarnOnFail) {
                Write-Warning "$StepLabel - exit code $exit (kiem tra log o tren)."
            } else {
                throw "$StepLabel failed with exit code $exit"
            }
        }
    } finally {
        Pop-Location
    }
}

function Invoke-AlembicUpgradeHead {
    # Local SQLite DB co the da co schema moi nhat (do bootstrap.py them columns thu cong).
    # Truong hop nay alembic upgrade head bao "duplicate column" -> fallback: stamp head.
    Write-Step "Running Alembic migrations (alembic upgrade head)"
    $env:PYTHONIOENCODING = "utf-8"
    Push-Location $BackendDir
    try {
        $upgradeExit = Invoke-NativeProcess -FilePath $BackendPython -Arguments @("-m", "alembic", "upgrade", "head")
        if ($upgradeExit -ne 0) {
            Write-Warning "alembic upgrade exit $upgradeExit - schema co the da o head do bootstrap.py them column. Stamp head."
            $stampExit = Invoke-NativeProcess -FilePath $BackendPython -Arguments @("-m", "alembic", "stamp", "head")
            if ($stampExit -ne 0) {
                throw "Alembic stamp head failed with exit code $stampExit"
            }
        }
    } finally {
        Pop-Location
    }
}

function Seed-ProdLikeData {
    param([switch]$ResetPasswords)
    if (-not (Test-Path $BackendPython)) {
        throw "Backend Python not found. Rerun without -SkipInstall first."
    }
    if (Test-TcpPort $BackendPort) {
        throw "Backend đang chạy trên port $BackendPort. Dừng backend trước khi seed."
    }
    $historicalDir = Join-Path $RootDir "KHMT_T1_T2_T3_T4"
    $bm01Workbook = Join-Path $RootDir "FI xlsx\BM 01 Dang ky - Danh gia SK _Rev1.xlsx"

    # Mirror exactly the production deploy steps (deploy_prod.py:138-196).
    # Step 1 — Alembic migrations (giong "alembic upgrade head" trong production).
    Invoke-AlembicUpgradeHead

    # Step 2 — Seed 55 production users (giong scripts/seed_users_xuong_dk.py).
    $seedArgs = @("scripts\seed_users_xuong_dk.py")
    if ($ResetPasswords) { $seedArgs += "--reset-passwords" }
    Invoke-BackendPython -Arguments $seedArgs -StepLabel "Seeding 55 production users (pass PVCFC@123)"

    # Step 3 — Import BM01 legacy sheets (giong production: 4 sheets TBCH, TBĐ, TBHTĐK, TC- ĐK).
    if (Test-Path $bm01Workbook) {
        $bm01Sheets = @("TBCH", "TBĐ", "TBHTĐK", "TC- ĐK")
        $sourceLabel = "FI xlsx/BM 01 Dang ky - Danh gia SK _Rev1.xlsx"
        foreach ($sheet in $bm01Sheets) {
            $bm01Args = @(
                "scripts\import_bm01_legacy_sheet.py",
                $bm01Workbook,
                "--sheet", $sheet,
                "--year", "2026",
                "--source-label", $sourceLabel,
                "--imported-by", "local-prod-like-seed"
            )
            Invoke-BackendPython -Arguments $bm01Args -StepLabel "Importing BM01 sheet '$sheet' (sang kien/CTKT)" -WarnOnFail
        }
    } else {
        Write-Warning "Khong tim thay $bm01Workbook — bo qua BM01 import (sang kien/CTKT se trong)."
    }

    # Step 4 — Local-only: import historical OKR T1-T4 (production khong lam vi du lieu da co trong DB qua backup).
    # Local can buoc nay de dashboard hien thi data lich su.
    if (Test-Path $historicalDir) {
        Invoke-BackendPython -Arguments @("scripts\import_historical.py", $historicalDir) -StepLabel "Importing historical OKR T1-T4/2026 (local-only, prod da co)" -WarnOnFail
    } else {
        Write-Warning "Khong tim thay $historicalDir — bo qua import historical OKR."
    }
}

if ($WithProdData) {
    Seed-ProdLikeData -ResetPasswords:$ResetUserPasswords
}

if (-not $SkipInstall) {
    Write-Step "Preparing backend virtual environment"
    if (-not (Test-Path $BackendPython)) {
        if (Get-Command py -ErrorAction SilentlyContinue) {
            & py -3.11 -m venv $BackendVenv
        } elseif (Get-Command python -ErrorAction SilentlyContinue) {
            & python -m venv $BackendVenv
        } else {
            throw "Python is not available. Install Python 3.11, then rerun this script."
        }
    }

    Write-Step "Installing backend dependencies"
    Push-Location $BackendDir
    try {
        & $BackendPython -m pip install --upgrade pip setuptools wheel
        & $BackendPython -m pip install -e ".[dev]"
    } finally {
        Pop-Location
    }

    Write-Step "Preparing frontend dependencies"
    Require-Command "npm"
    if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
        Push-Location $FrontendDir
        try {
            npm install
        } finally {
            Pop-Location
        }
    } else {
        Write-Host "frontend/node_modules exists, skipping npm install."
    }
} else {
    Write-Step "Skipping dependency install"
}

if (-not (Test-Path $BackendPython)) {
    throw "Backend Python not found. Rerun without -SkipInstall first."
}

$npmCommand = "npm"
if (Get-Command npm.cmd -ErrorAction SilentlyContinue) {
    $npmCommand = (Get-Command npm.cmd).Source
}
$nodeCommand = $null
if (Get-Command node.exe -ErrorAction SilentlyContinue) {
    $nodeCommand = (Get-Command node.exe).Source
} else {
    $nodeFromNpm = Join-Path (Split-Path -Parent $npmCommand) "node.exe"
    if (Test-Path $nodeFromNpm) {
        $nodeCommand = $nodeFromNpm
    }
}
if (-not $nodeCommand) {
    throw "Node.js executable not found. Install Node.js, then rerun this script."
}
$viteScript = Join-Path $FrontendDir "node_modules\vite\bin\vite.js"
if (-not (Test-Path $viteScript)) {
    throw "Vite not found at $viteScript. Rerun without -SkipInstall first."
}

if ($SeparateWindows) {
    $BackendRunning = Test-TcpPort $BackendPort
    if ($BackendRunning) {
        Write-Step "Backend already appears to be running on port $BackendPort"
    } else {
        Write-Step "Starting backend on http://127.0.0.1:$BackendPort"
        $backendCmd = @"
`$Host.UI.RawUI.WindowTitle = 'OKR Backend :$BackendPort'
Set-Location -LiteralPath $(Quote-PowerShellString $BackendDir)
& $(Quote-PowerShellString $BackendPython) -m uvicorn app.main:app --reload --host 127.0.0.1 --port $BackendPort
"@
        Start-Process powershell.exe -ArgumentList @(
            "-NoExit",
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-Command", $backendCmd
        )
    }

    $FrontendRunning = Test-TcpPort $FrontendPort
    if ($FrontendRunning) {
        Write-Step "Frontend already appears to be running on port $FrontendPort"
    } else {
        Write-Step "Starting frontend on $FrontendUrl"
        $frontendCmd = @"
`$Host.UI.RawUI.WindowTitle = 'OKR Frontend :$FrontendPort'
Set-Location -LiteralPath $(Quote-PowerShellString $FrontendDir)
& $(Quote-PowerShellString $nodeCommand) $(Quote-PowerShellString $viteScript) --host 0.0.0.0 --port $FrontendPort
"@
        Start-Process powershell.exe -ArgumentList @(
            "-NoExit",
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-Command", $frontendCmd
        )
    }

    Write-Step "Waiting for backend health"
    if (-not (Wait-ForHttp "http://127.0.0.1:$BackendPort/health" 90)) {
        Write-Warning "Backend did not respond in time. Check the 'OKR Backend' window."
    }

    Write-Step "Waiting for frontend"
    if (-not (Wait-ForHttp $FrontendUrl 90)) {
        Write-Warning "Frontend did not respond in time. Check the 'OKR Frontend' window."
    }

    Write-Step "Opening website"
    Start-Process $FrontendUrl

    Write-Host ""
    Write-Host "Website: $FrontendUrl" -ForegroundColor Green
    if ($WithProdData) {
        Write-Host "Login: kiaq (Quan doc) / quyenpt (FI) / minhvq (Doi truong) ... / PVCFC@123" -ForegroundColor Green
    } else {
        Write-Host "Demo login: admin / admin-pass" -ForegroundColor Green
        Write-Host "  De co tai khoan giong production + du lieu OKR that:" -ForegroundColor Yellow
        Write-Host "  Dung backend lai (Ctrl+C), chay: .\seed-prod-like.cmd" -ForegroundColor Yellow
        Write-Host "  Hoac: .\start-dev.cmd -SkipInstall -WithProdData" -ForegroundColor Yellow
    }
    Write-Host "Close the 'OKR Backend' and 'OKR Frontend' windows to stop the servers."
    return
}

$BackendJob = $null
$FrontendJob = $null

try {
    $BackendRunning = Test-TcpPort $BackendPort
    if ($BackendRunning) {
        Write-Step "Backend already appears to be running on port $BackendPort"
    } else {
        Write-Step "Starting backend on http://127.0.0.1:$BackendPort in this terminal"
        $BackendJob = Start-Job -Name "OKR Backend" -ScriptBlock {
            param($WorkingDir, $PythonExe, $Port)
            Set-Location -LiteralPath $WorkingDir
            & $PythonExe -m uvicorn app.main:app --reload --host 127.0.0.1 --port $Port 2>&1
        } -ArgumentList $BackendDir, $BackendPython, $BackendPort
    }

    $FrontendRunning = Test-TcpPort $FrontendPort
    if ($FrontendRunning) {
        Write-Step "Frontend already appears to be running on port $FrontendPort"
    } else {
        Write-Step "Starting frontend on $FrontendUrl in this terminal"
        $FrontendJob = Start-Job -Name "OKR Frontend" -ScriptBlock {
            param($WorkingDir, $NodeExe, $ViteEntry, $Port)
            Set-Location -LiteralPath $WorkingDir
            & $NodeExe $ViteEntry --host 0.0.0.0 --port $Port 2>&1
        } -ArgumentList $FrontendDir, $nodeCommand, $viteScript, $FrontendPort
    }

    Write-Step "Waiting for dev servers"
    $ready = Wait-ForDevServers -BackendJob $BackendJob -FrontendJob $FrontendJob -TimeoutSeconds 90
    if (-not $ready.Backend) {
        Write-Warning "Backend did not respond in time."
    }
    if (-not $ready.Frontend) {
        Write-Warning "Frontend did not respond in time."
    }

    Write-Step "Opening website"
    Start-Process $FrontendUrl

    Write-Host ""
    Write-Host "Website: $FrontendUrl" -ForegroundColor Green
    if ($WithProdData) {
        Write-Host "Login: kiaq (Quan doc) / quyenpt (FI) / minhvq (Doi truong) ... / PVCFC@123" -ForegroundColor Green
    } else {
        Write-Host "Demo login: admin / admin-pass" -ForegroundColor Green
        Write-Host "  De co tai khoan giong production + du lieu OKR that:" -ForegroundColor Yellow
        Write-Host "  Dung backend lai (Ctrl+C), chay: .\seed-prod-like.cmd" -ForegroundColor Yellow
        Write-Host "  Hoac: .\start-dev.cmd -SkipInstall -WithProdData" -ForegroundColor Yellow
    }
    Write-Host "Logs are streaming in this terminal. Press Ctrl+C to stop servers." -ForegroundColor Yellow
    Write-Host ""

    while ($true) {
        Receive-AllDevOutput -BackendJob $BackendJob -FrontendJob $FrontendJob
        $runningJobs = @($BackendJob, $FrontendJob) | Where-Object { $null -ne $_ -and $_.State -eq "Running" }
        if ($runningJobs.Count -eq 0) {
            break
        }
        Start-Sleep -Milliseconds 500
    }

    Receive-AllDevOutput -BackendJob $BackendJob -FrontendJob $FrontendJob
} finally {
    Write-Step "Stopping dev servers"
    foreach ($job in @($BackendJob, $FrontendJob)) {
        if ($null -ne $job) {
            Stop-Job -Job $job -ErrorAction SilentlyContinue
            Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
        }
    }
}
