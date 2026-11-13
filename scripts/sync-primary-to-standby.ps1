# Script sao luu du lieu tu primary-db va dong bo sang standby-db
$ErrorActionPreference = "Stop"
$backupDir = Join-Path $PSScriptRoot "..\backups"
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = Join-Path $backupDir "backup_$timestamp.sql"
$latestFile = Join-Path $backupDir "latest_backup.sql"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [SYNC PRIMARY -> STANDBY] Dang sao luu va dong bo du lieu..." -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

try {
    # 1. Backup tu Primary
    docker exec primary-db mysqldump -u root -prootpassword shoponline > $backupFile
    Copy-Item -Path $backupFile -Destination $latestFile -Force
    Write-Host "[1/2] Da backup tu primary-db -> $backupFile" -ForegroundColor Green

    # 2. Sync sang Standby
    Get-Content $latestFile | docker exec -i standby-db mysql -u root -prootpassword shoponline
    Write-Host "[2/2] Da dong bo thanh cong sang standby-db!" -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Cyan
} catch {
    Write-Host "[LOI] Qua trinh dong bo that bai!" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}

