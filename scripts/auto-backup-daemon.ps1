<#
.SYNOPSIS
    Script tự động sao lưu định kỳ theo chu kỳ phút (để phục vụ đo RPO trong bài tập lớn).
.PARAMETER IntervalMinutes
    Chu kỳ thời gian chạy backup tự động (mặc định 1 phút để dễ demo).
#>
param(
    [int]$IntervalMinutes = 1
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [AUTO BACKUP DAEMON] Bắt đầu tiến trình tự động sao lưu định kỳ" -ForegroundColor Yellow
Write-Host " Chu kỳ: Mỗi $IntervalMinutes phút" -ForegroundColor Yellow
Write-Host " Nhấn Ctrl + C để dừng tiến trình." -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

$backupScript = Join-Path $PSScriptRoot "backup.ps1"

while ($true) {
    Write-Host "`n[$(Get-Date -Format 'HH:mm:ss')] Đang kích hoạt sao lưu tự động..." -ForegroundColor Cyan
    & $backupScript
    Write-Host "Chờ $IntervalMinutes phút cho lần sao lưu tiếp theo..." -ForegroundColor Gray
    Start-Sleep -Seconds ($IntervalMinutes * 60)
}

