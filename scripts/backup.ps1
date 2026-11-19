# Script sao luu tu dong CSDL MySQL tu primary-db
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

# 1. Kiem tra Docker daemon va container primary-db co dang chay khong
$containerRunning = docker ps --filter "name=primary-db" --filter "status=running" -q
if (-not $containerRunning) {
    Write-Host "[LOI] Container 'primary-db' hien KHONG chay!" -ForegroundColor Red
    Write-Host "-> Hay bat Docker Desktop va chay: docker-compose up -d" -ForegroundColor Yellow
    exit 1
}

# 2. Thuc hien mysqldump
docker exec primary-db mysqldump -u root -prootpassword shoponline > $backupFile

# 3. Kiem tra ket qua sau khi dump
if ($LASTEXITCODE -ne 0 -or (Get-Item $backupFile).Length -eq 0) {
    Write-Host "[LOI] Sao luu that bai hoac file khong co du lieu!" -ForegroundColor Red
    if (Test-Path $backupFile) { Remove-Item $backupFile -Force }
    exit 1
}

Copy-Item -Path $backupFile -Destination $latestFile -Force
Write-Host "[THANH CONG] Du lieu da duoc sao luu tai: $backupFile" -ForegroundColor Green
Write-Host "[THANH CONG] Da cap nhat ban moi nhat: $latestFile" -ForegroundColor Green

