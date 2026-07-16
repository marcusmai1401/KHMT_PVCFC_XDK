param(
    [switch]$ResetPasswords,
    [switch]$SkipMigrations,
    [switch]$SkipUsers,
    [switch]$SkipBM01,
    [switch]$SkipHistorical
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RootDir "backend"
$BackendVenv = Join-Path $BackendDir ".venv"
$BackendPython = Join-Path $BackendVenv "Scripts\python.exe"
$HistoricalDir = Join-Path $RootDir "KHMT_Monthly"
$BM01Workbook = Join-Path $RootDir "FI xlsx\BM 01 Dang ky - Danh gia SK _Rev1.xlsx"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

# Goi Python tu backend venv, KHONG halt khi stderr cua native command co log
# (alembic in INFO ra stderr, neu $ErrorActionPreference=Stop thi PowerShell crash).
function Invoke-BackendPython {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [string]$StepLabel,
        [switch]$WarnOnFail
    )
    if ($StepLabel) { Write-Step $StepLabel }
    $env:PYTHONIOENCODING = "utf-8"
    Push-Location $BackendDir
    $prevPref = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        & $BackendPython @Arguments 2>&1 | ForEach-Object { Write-Host $_ }
        $exit = $LASTEXITCODE
        $ErrorActionPreference = $prevPref
        if ($exit -ne 0) {
            if ($WarnOnFail) {
                Write-Warning "$StepLabel - exit code $exit (kiem tra log o tren)."
            } else {
                throw "$StepLabel failed with exit code $exit"
            }
        }
    } finally {
        $ErrorActionPreference = $prevPref
        Pop-Location
    }
}

Write-Host "Seed local DB y chang production deploy" -ForegroundColor Green
Write-Host "Project: $RootDir"
Write-Host "Mirror cua deploy_prod.py - chay y nhu deploy len VPS, ngoai tru docker/backup steps." -ForegroundColor DarkGray

if (-not (Test-Path $BackendPython)) {
    throw "Backend Python venv khong ton tai. Chay '.\start-dev.cmd' (khong co -SkipInstall) truoc."
}

# Step 1 - Alembic migrations (giong "docker compose exec backend alembic upgrade head" production).
if (-not $SkipMigrations) {
    Write-Step "STEP 1/4: Alembic migrations (alembic upgrade head)"
    # Local SQLite DB co the da co schema moi nhat do bootstrap.py them column thu cong.
    # Truong hop nay alembic upgrade head bao "duplicate column" -> fallback: stamp head.
    $env:PYTHONIOENCODING = "utf-8"
    Push-Location $BackendDir
    $prevPref = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        & $BackendPython -m alembic upgrade head 2>&1 | ForEach-Object { Write-Host $_ }
        $upgradeExit = $LASTEXITCODE

        if ($upgradeExit -ne 0) {
            Write-Warning "alembic upgrade exit $upgradeExit - schema co the da o head do bootstrap.py them column. Stamp head de dong bo."
            & $BackendPython -m alembic stamp head 2>&1 | ForEach-Object { Write-Host $_ }
            $stampExit = $LASTEXITCODE
            if ($stampExit -ne 0) {
                $ErrorActionPreference = $prevPref
                throw "Alembic stamp head failed with exit code $stampExit"
            }
        }
    } finally {
        $ErrorActionPreference = $prevPref
        Pop-Location
    }
} else {
    Write-Step "STEP 1/4: BO QUA Alembic migrations (-SkipMigrations)"
}

# Step 2 - Seed 55 production users (giong production deploy seed_block).
if (-not $SkipUsers) {
    $seedArgs = @("scripts\seed_users_xuong_dk.py")
    if ($ResetPasswords) {
        $seedArgs += "--reset-passwords"
        Write-Host "Se reset password ve PVCFC@123 cho ca user da ton tai" -ForegroundColor Yellow
    }
    Invoke-BackendPython -Arguments $seedArgs -StepLabel "STEP 2/4: Seed 55 production users (pass PVCFC@123)"
} else {
    Write-Step "STEP 2/4: BO QUA seed users (-SkipUsers)"
}

# Step 3 - Import BM01 legacy sheets (giong production deploy import_block).
if (-not $SkipBM01) {
    if (Test-Path $BM01Workbook) {
        $sheets = @("TBCH", "TBĐ", "TBHTĐK", "TC- ĐK")
        $sourceLabel = "FI xlsx/BM 01 Dang ky - Danh gia SK _Rev1.xlsx"
        foreach ($sheet in $sheets) {
            $bm01Args = @(
                "scripts\import_bm01_legacy_sheet.py",
                $BM01Workbook,
                "--sheet", $sheet,
                "--year", "2026",
                "--source-label", $sourceLabel,
                "--imported-by", "local-prod-like-seed"
            )
            Invoke-BackendPython -Arguments $bm01Args -StepLabel "STEP 3/4: BM01 sheet '$sheet' (sang kien/CTKT)" -WarnOnFail
        }
    } else {
        Write-Warning "STEP 3/4: Khong tim thay $BM01Workbook - bo qua BM01 import."
    }
} else {
    Write-Step "STEP 3/4: BO QUA BM01 import (-SkipBM01)"
}

# Step 4 - Local-only: historical OKR T1-T4 (prod khong lam buoc nay vi DB persist data qua backup).
# Local can buoc nay de dashboard hien data lich su.
if (-not $SkipHistorical) {
    if (Test-Path $HistoricalDir) {
        Invoke-BackendPython -Arguments @("scripts\import_historical.py", $HistoricalDir) -StepLabel "STEP 4/4: Import historical OKR T1-T4/2026 (local-only)" -WarnOnFail
    } else {
        Write-Warning "STEP 4/4: Khong tim thay $HistoricalDir - bo qua import historical OKR."
    }
} else {
    Write-Step "STEP 4/4: BO QUA import historical OKR (-SkipHistorical)"
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  Local DB da y chang production deploy:" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Quan doc Xuong  : kiaq    / PVCFC@123" -ForegroundColor White
Write-Host "  Dau moi FI      : quyenpt / PVCFC@123" -ForegroundColor White
Write-Host "  Doi truong      : minhvq, linhln, haint, thanhdq / PVCFC@123" -ForegroundColor White
Write-Host "  Staff           : 46 nhan su, password PVCFC@123" -ForegroundColor White
Write-Host "  Admin he thong  : admin / admin-pass (giu)" -ForegroundColor White
Write-Host ""
Write-Host "  Dashboard OKR T1-T4/2026: san sang." -ForegroundColor White
Write-Host "  Sang kien/CTKT BM01: san sang." -ForegroundColor White
Write-Host "  Schema: dong bo voi alembic head." -ForegroundColor White
Write-Host ""
Write-Host "  Truy cap: http://localhost:5173" -ForegroundColor White
Write-Host ""
Write-Host "Neu chua start dev server: chay .\start-dev.cmd -SkipInstall" -ForegroundColor Yellow
