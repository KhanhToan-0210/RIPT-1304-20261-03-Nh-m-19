param(
    [ValidateRange(1,1440)][int]$IntervalMinutes = 5,
    [string]$ContainerName = 'primary-db',
    [string]$DatabaseName = 'shoponline',
    [string]$BackupDirectory = (Join-Path $PSScriptRoot '..\backups')
)
$ErrorActionPreference = 'Stop'
Write-Host "Backup every $IntervalMinutes minute(s); Ctrl+C to stop."
while ($true) {
    try {
        & (Join-Path $PSScriptRoot 'backup.ps1') -ContainerName $ContainerName -DatabaseName $DatabaseName -BackupDirectory $BackupDirectory
    } catch {
        Write-Warning "Backup failed: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds ($IntervalMinutes * 60)
}
