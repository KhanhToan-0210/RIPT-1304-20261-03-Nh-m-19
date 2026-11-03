# Script dong bo du lieu sao luu sang standby-db
$ErrorActionPreference = "Stop"
$latestFile = Join-Path $PSScriptRoot "..\backups\latest_backup.sql"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [SYNC TO STANDBY] Dang nap du lieu sang standby-db..." -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

if (-not (Test-Path $latestFile)) {
    Write-Host "[LOI] Khong tim thay file backups\latest_backup.sql! Hay chay backup.ps1 truoc." -ForegroundColor Red
    exit 1
}

try {
    Get-Content $latestFile | docker exec -i standby-db mysql -u root -prootpassword shoponline
    Write-Host "[THANH CONG] Du lieu da duoc dong bo sang moi truong du phong (standby-db)!" -ForegroundColor Green
} catch {
    Write-Host "[LOI] Khong the nap du lieu sang standby-db. Kiem tra container standby-db da chay chua!" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}
