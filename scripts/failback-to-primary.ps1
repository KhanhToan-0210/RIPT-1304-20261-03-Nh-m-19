# Kich ban Failback (KT3): Dong bo nguoc du lieu tu Standby ve lai Primary
$ErrorActionPreference = "Stop"
$backupDir = Join-Path $PSScriptRoot "..\backups"
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$failbackFile = Join-Path $backupDir "failback_standby_$timestamp.sql"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [FAILBACK KT3] Dong bo nguoc du lieu: Standby -> Primary..." -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

try {
    # 1. Backup tu Standby
    docker exec standby-db mysqldump -u root -prootpassword shoponline > $failbackFile
    Write-Host "[1/2] Da trich xuat du lieu tu standby-db -> $failbackFile" -ForegroundColor Green

    # 2. Nap vao Primary
    Get-Content $failbackFile | docker exec -i primary-db mysql -u root -prootpassword shoponline
    Write-Host "[2/2] Da khoi phuc toan ven ve primary-db!" -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Cyan
} catch {
    Write-Host "[LOI] Failback that bai! Kiem tra container primary-db da duoc bat lai chua." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}

