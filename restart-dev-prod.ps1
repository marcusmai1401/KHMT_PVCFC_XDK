param(
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173,
    [switch]$StopFrontend,
    [switch]$SeparateWindows
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartDevScript = Join-Path $RootDir "start-dev.ps1"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Get-ProcessInfo {
    param([int]$ProcessId)
    try {
        return Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    } catch {
        return $null
    }
}

function Get-RelatedBackendProcessIds {
    param(
        [int]$ListenerProcessId,
        [int]$Port
    )

    $ids = @()
    $currentProcessId = $ListenerProcessId

    for ($hop = 0; $hop -lt 8 -and $currentProcessId; $hop++) {
        $info = Get-ProcessInfo $currentProcessId
        if ($null -eq $info) {
            break
        }

        $commandLine = [string]$info.CommandLine
        $isListener = $currentProcessId -eq $ListenerProcessId
        $isUvicornBackend = (
            $commandLine -match "uvicorn" -or
            $commandLine -match "app\.main:app" -or
            $commandLine -match "--port\s+$Port"
        )

        if ($isListener -or $isUvicornBackend) {
            $ids += $currentProcessId
            $currentProcessId = [int]$info.ParentProcessId
            continue
        }

        break
    }

    return $ids
}

function Stop-ProcessTree {
    param(
        [int]$ProcessId,
        [hashtable]$Seen
    )

    if ($Seen.ContainsKey($ProcessId)) {
        return
    }
    $Seen[$ProcessId] = $true

    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue)
    foreach ($child in $children) {
        Stop-ProcessTree -ProcessId ([int]$child.ProcessId) -Seen $Seen
    }

    $info = Get-ProcessInfo $ProcessId
    if ($null -ne $info) {
        Write-Host ("Stopping PID {0}: {1}" -f $ProcessId, $info.Name)
        Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Stop-ListenersOnPort {
    param(
        [int]$Port,
        [switch]$BackendOnly
    )

    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) {
        Write-Host "No process is listening on port $Port."
        return
    }

    $processIdsToStop = @()
    foreach ($listener in $listeners) {
        $listenerPid = [int]$listener.OwningProcess
        if ($BackendOnly) {
            $processIdsToStop += Get-RelatedBackendProcessIds -ListenerProcessId $listenerPid -Port $Port
        } else {
            $processIdsToStop += $listenerPid
        }
    }

    $processIdsToStop = @($processIdsToStop | Select-Object -Unique)
    [array]::Reverse($processIdsToStop)

    $seen = @{}
    foreach ($processId in $processIdsToStop) {
        Stop-ProcessTree -ProcessId ([int]$processId) -Seen $seen
    }

    $deadline = (Get-Date).AddSeconds(10)
    while (@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count -gt 0) {
        if ((Get-Date) -gt $deadline) {
            throw "Port $Port is still in use after stopping old processes."
        }
        Start-Sleep -Milliseconds 250
    }
}

if (-not (Test-Path $StartDevScript)) {
    throw "Cannot find start-dev.ps1 next to this script."
}

Write-Step "Stopping old backend on port $BackendPort"
Stop-ListenersOnPort -Port $BackendPort -BackendOnly

if ($StopFrontend) {
    Write-Step "Stopping old frontend on port $FrontendPort"
    Stop-ListenersOnPort -Port $FrontendPort
}

Write-Step "Starting dev with production-like data"
$startDevParams = @{
    BackendPort = $BackendPort
    FrontendPort = $FrontendPort
    SkipInstall = $true
    WithProdData = $true
    ResetUserPasswords = $true
    SeparateWindows = $true
}

& $StartDevScript @startDevParams
exit $LASTEXITCODE
