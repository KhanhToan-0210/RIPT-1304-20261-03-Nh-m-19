# Script sao luu tu dong CSDL MySQL tu primary-db
$ErrorActionPreference = "Stop"
$backupDir = Join-Path $PSScriptRoot "..\backups"
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = Join-Path $backupDir "backup_$timestamp.sql"
$latestFile = Join-Path $backupDir "latest_backup.sql"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [AUTO BACKUP] Dang sao luu CSDL tu primary-db..." -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

try {
    docker exec primary-db mysqldump -u root -prootpassword shoponline > $backupFile
    Copy-Item -Path $backupFile -Destination $latestFile -Force

    Write-Host "[THANH CONG] Du lieu da duoc sao luu tai: $backupFile" -ForegroundColor Green
    Write-Host "[THANH CONG] Da cap nhat ban moi nhat: $latestFile" -ForegroundColor Green
} catch {
    Write-Host "[LOI] Khong the sao luu CSDL. Kiem tra container primary-db da chay chua!" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}
