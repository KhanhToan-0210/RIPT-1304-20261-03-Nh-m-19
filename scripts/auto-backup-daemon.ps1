<#
.SYNOPSIS
    Script tự động sao lưu định kỳ và đồng bộ trực tiếp sang web dự phòng (standby-db).
.PARAMETER Seconds
    Chu kỳ thời gian chạy đồng bộ tự động theo giây (mặc định 30 giây để demo nhanh).
#>
param(
    [int]$Seconds = 30
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [AUTO SYNC DAEMON] Tiến trình tự động đồng bộ sang Standby" -ForegroundColor Yellow
Write-Host " Chu kỳ: Mỗi $Seconds giây" -ForegroundColor Yellow
Write-Host " Nhấn Ctrl + C để dừng tiến trình." -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

$syncScript = Join-Path $PSScriptRoot "sync-primary-to-standby.ps1"

while ($true) {
    Write-Host "`n[$(Get-Date -Format 'HH:mm:ss')] Đang kích hoạt đồng bộ tự động sang Standby..." -ForegroundColor Cyan
    & $syncScript
    Write-Host "Đang chờ $Seconds giây cho lần đồng bộ tiếp theo..." -ForegroundColor Gray
    Start-Sleep -Seconds $Seconds
}


