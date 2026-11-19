# Kich ban Failback (KT3): Dong bo nguoc du lieu tu Standby ve lai Primary
$backupDir = Join-Path $PSScriptRoot "..\backups"
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$failbackFile = Join-Path $backupDir "failback_standby_$timestamp.sql"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [FAILBACK KT3] Dong bo nguoc du lieu: Standby -> Primary..." -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Kiem tra ca 2 container co dang chay khong
$standbyRunning = docker ps --filter "name=standby-db" --filter "status=running" -q
$primaryRunning = docker ps --filter "name=primary-db" --filter "status=running" -q

if (-not $standbyRunning) {
    Write-Host "[LOI] Container 'standby-db' hien KHONG chay!" -ForegroundColor Red
    exit 1
}
if (-not $primaryRunning) {
    Write-Host "[LOI] Container 'primary-db' hien KHONG chay! Hay bat lai truoc khi failback." -ForegroundColor Red
    Write-Host "-> Goi: docker start primary-db primary-web" -ForegroundColor Yellow
    exit 1
}

# 2. Backup tu Standby
docker exec standby-db mysqldump -u root -prootpassword shoponline > $failbackFile
if ($LASTEXITCODE -ne 0 -or (Get-Item $failbackFile).Length -eq 0) {
    Write-Host "[LOI] Sao luu tu standby-db that bai!" -ForegroundColor Red
    if (Test-Path $failbackFile) { Remove-Item $failbackFile -Force }
    exit 1
}
Write-Host "[1/2] Da trich xuat du lieu tu standby-db -> $failbackFile" -ForegroundColor Green

# 3. Nap vao Primary
Get-Content $failbackFile | docker exec -i primary-db mysql -u root -prootpassword shoponline
if ($LASTEXITCODE -ne 0) {
    Write-Host "[LOI] Nap du lieu sang primary-db that bai!" -ForegroundColor Red
    exit 1
}

Write-Host "[2/2] Da khoi phuc toan ven ve primary-db!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan


