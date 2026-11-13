# Updates an existing Windows installation from the UNFEAL-OS.zip app package.
[CmdletBinding()]
param(
    [string] $UpdateZip,
    [string] $InstallDir,
    [switch] $Launch,
    [switch] $CheckOnly,
    [int] $WaitForProcessId,
    [switch] $FromApp,
    [switch] $CleanOnlineStage,
    [string] $ExpectedVersion
)
$ErrorActionPreference = 'Stop'
if (-not $UpdateZip) {
    $UpdateZip = Join-Path $PSScriptRoot 'UNFEAL-OS.zip'
}

if (-not $InstallDir) {
    $registration = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\UnfealOS_is1' -ErrorAction SilentlyContinue
    $InstallDir = $registration.InstallLocation
    if (-not $InstallDir) {
        $InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\UNFEAL OS'
    }
}

$InstallDir = (Resolve-Path -LiteralPath $InstallDir).Path
$exe = Join-Path $InstallDir 'UNFEAL OS.exe'
$resources = Join-Path $InstallDir 'resources'
$app = Join-Path $resources 'app'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    throw 'UNFEAL OS.exe wurde nicht gefunden. Gib den Installationsordner mit -InstallDir an.'
}

function Start-App {
    if ($FromApp) {
        Start-Process -FilePath $exe -WorkingDirectory $InstallDir -ArgumentList '--skip-startup-update'
    } else {
        Start-Process -FilePath $exe -WorkingDirectory $InstallDir
    }
}

trap {
    if ($FromApp -and -not (Get-AppProcesses) -and (Test-Path -LiteralPath (Join-Path $app 'package.json'))) {
        $_ | Out-String | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'startup-update-error.log')
        Start-App
    }
    break
}

function Get-AppProcesses {
    Get-Process -Name 'UNFEAL OS' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $exe }
}

function Assert-AppClosed {
    if (Get-AppProcesses) {
        throw 'Diese UNFEAL-OS-Installation läuft noch. Schließe sie vollständig und starte das Update erneut.'
    }
}

function Close-AppForUpdate {
    $running = @(Get-AppProcesses)
    if ($running.Count -eq 0) { return }
    $answer = Read-Host 'UNFEAL OS läuft. Zum Schließen und Aktualisieren J eingeben'
    if ($answer -notmatch '^(j|ja)$') { throw 'Update abgebrochen.' }

    foreach ($process in $running) {
        if (-not $process.HasExited -and $process.MainWindowHandle -ne 0) {
            $null = $process.CloseMainWindow()
        }
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while ((Get-AppProcesses) -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 250
    }
    Assert-AppClosed
}

if ($Launch -and -not (Test-Path -LiteralPath $UpdateZip -PathType Leaf)) {
    Start-App
    return
}

$current = Get-Content -LiteralPath (Join-Path $app 'package.json') -Raw | ConvertFrom-Json
$zip = (Resolve-Path -LiteralPath $UpdateZip).Path
$updateId = [guid]::NewGuid().ToString('N')
$stage = Join-Path $resources "update-$updateId"
$backup = Join-Path $resources "app-backup-$updateId"
$extracted = Join-Path $stage 'package'
$nextApp = Join-Path $stage 'app'
New-Item -ItemType Directory -Path $stage | Out-Null

try {
    Expand-Archive -LiteralPath $zip -DestinationPath $extracted
    $incoming = Get-Content -LiteralPath (Join-Path $extracted 'package.json') -Raw | ConvertFrom-Json
    if ($current.name -ne 'unfeal-os' -or $incoming.name -ne 'unfeal-os' -or
        $incoming.main -ne 'electron/main.cjs') {
        throw 'Das ZIP ist kein gültiges UNFEAL-OS-App-Paket.'
    }
    if ($ExpectedVersion -and $incoming.version -cne $ExpectedVersion) {
        throw 'Das signierte Paket passt nicht zur angekündigten Version.'
    }
    if ([version]$incoming.version -le [version]$current.version) {
        Write-Output "UNFEAL OS $($current.version) ist bereits installiert."
        if ($Launch) { Start-App }
        return
    }
    if ($incoming.devDependencies.electron -ne $current.devDependencies.electron -or
        $incoming.dependencies.'better-sqlite3' -ne $current.dependencies.'better-sqlite3') {
        throw 'Dieses Update benötigt eine neue Electron- oder SQLite-Laufzeit. Verwende dafür das vollständige Setup.'
    }
    foreach ($file in 'electron/main.cjs', 'electron/preload.cjs', 'dist/index.html') {
        if (-not (Test-Path -LiteralPath (Join-Path $extracted $file) -PathType Leaf)) {
            throw "Im Update fehlt $file."
        }
    }

    if ($CheckOnly) {
        Write-Output 'UPDATE_AVAILABLE'
        return
    }
    if ($WaitForProcessId) {
        $parentProcess = Get-Process -Id $WaitForProcessId -ErrorAction SilentlyContinue
        if ($parentProcess -and -not $parentProcess.WaitForExit(20000)) {
            throw 'UNFEAL OS konnte nicht rechtzeitig beendet werden.'
        }
    }
    New-Item -ItemType Directory -Path $nextApp | Out-Null
    foreach ($item in 'package.json', 'electron', 'dist') {
        Copy-Item -LiteralPath (Join-Path $extracted $item) -Destination $nextApp -Recurse
    }
    Copy-Item -LiteralPath (Join-Path $app 'node_modules') -Destination $nextApp -Recurse
    if ($FromApp) {
        $deadline = [DateTime]::UtcNow.AddSeconds(10)
        while ((Get-AppProcesses) -and [DateTime]::UtcNow -lt $deadline) {
            Start-Sleep -Milliseconds 200
        }
        Assert-AppClosed
    } else {
        Close-AppForUpdate
    }
    Move-Item -LiteralPath $app -Destination $backup
    try {
        Move-Item -LiteralPath $nextApp -Destination $app
    } catch {
        Move-Item -LiteralPath $backup -Destination $app
        throw
    }
    Write-Output "UNFEAL OS wurde auf $($incoming.version) aktualisiert."
    Write-Output "Sicherung der vorherigen Programmdateien: $backup"
} finally {
    $resolvedStage = (Resolve-Path -LiteralPath $stage).Path
    if ($resolvedStage -eq [IO.Path]::GetFullPath((Join-Path $resources "update-$updateId"))) {
        Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
}

if ($Launch) { Start-App }

if ($CleanOnlineStage -and (Split-Path -Leaf $PSScriptRoot) -match '^unfeal-update-') {
    Remove-Item -LiteralPath $UpdateZip, $PSCommandPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $PSScriptRoot -ErrorAction SilentlyContinue
}
