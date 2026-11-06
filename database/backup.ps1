param(
    [string]$ContainerName = 'primary-db',
    [string]$DatabaseName = 'shoponline',
    [string]$BackupDirectory = (Join-Path $PSScriptRoot '..\backups')
)
$ErrorActionPreference = 'Stop'
if ($ContainerName -notmatch '^[a-zA-Z0-9_.-]+$' -or $DatabaseName -notmatch '^[a-zA-Z0-9_]+$') {
    throw 'Invalid container or database name.'
}
New-Item -ItemType Directory -Force -Path $BackupDirectory | Out-Null
$backupPath = Join-Path (Resolve-Path $BackupDirectory).Path ("{0}_{1}_{2}.sql" -f $DatabaseName, (Get-Date -Format 'yyyyMMdd_HHmmss'), ([guid]::NewGuid().ToString('N').Substring(0,8)))
$remotePath = '/tmp/backup_' + [guid]::NewGuid().ToString('N') + '.sql'
try {
    # Copy raw SQL bytes; avoid Windows PowerShell UTF-16 redirection.
    $command = 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysqldump --user=root --default-character-set=utf8mb4 --single-transaction --routines --triggers --no-tablespaces --result-file=' + $remotePath + ' ' + $DatabaseName
    docker exec $ContainerName sh -c $command
    if ($LASTEXITCODE -ne 0) { throw 'mysqldump failed; no successful backup was recorded.' }
    docker cp "${ContainerName}:$remotePath" $backupPath
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $backupPath) -or (Get-Item $backupPath).Length -eq 0) {
        throw 'Copying the SQL backup failed.'
    }
    Write-Host "Backup saved: $backupPath"
    Write-Output $backupPath
} finally {
    docker exec $ContainerName rm -f $remotePath | Out-Null
}
