# Script sao luu du lieu tu primary-db va dong bo sang standby-db
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

# 1. Kiem tra ca 2 container co dang chay khong
$primaryRunning = docker ps --filter "name=primary-db" --filter "status=running" -q
$standbyRunning = docker ps --filter "name=standby-db" --filter "status=running" -q

if (-not $primaryRunning) {
    Write-Host "[THONG BAO] Container 'primary-db' hien KHONG chay (co the web chinh dang sap)!" -ForegroundColor Red
    return
}
if (-not $standbyRunning) {
    Write-Host "[LOI] Container 'standby-db' hien KHONG chay!" -ForegroundColor Red
    return
}

# 2. Backup tu Primary
docker exec primary-db mysqldump -u root -prootpassword shoponline > $backupFile
if ($LASTEXITCODE -ne 0 -or (Get-Item $backupFile).Length -eq 0) {
    Write-Host "[LOI] Sao luu tu primary-db that bai!" -ForegroundColor Red
    if (Test-Path $backupFile) { Remove-Item $backupFile -Force }
    return
}

Copy-Item -Path $backupFile -Destination $latestFile -Force
Write-Host "[1/2] Da backup tu primary-db -> $backupFile" -ForegroundColor Green

# 3. Sync sang Standby
Get-Content $latestFile | docker exec -i standby-db mysql -u root -prootpassword shoponline
if ($LASTEXITCODE -ne 0) {
    Write-Host "[LOI] Nap du lieu sang standby-db that bai!" -ForegroundColor Red
    return
}

Write-Host "[2/2] Da dong bo thanh cong sang standby-db!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan


