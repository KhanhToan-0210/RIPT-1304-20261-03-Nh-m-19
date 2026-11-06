param(
    [Parameter(Mandatory = $true)][string]$BackupFile,
    [Parameter(Mandatory = $true)][string]$DatabaseName,
    [string]$ContainerName = 'standby-db'
)
$ErrorActionPreference = 'Stop'
if ($ContainerName -notmatch '^[a-zA-Z0-9_.-]+$' -or $DatabaseName -notmatch '^[a-zA-Z0-9_]+$') {
    throw 'Invalid container or database name.'
}
$sourcePath = (Resolve-Path -LiteralPath $BackupFile).Path
$sql = [IO.File]::ReadAllText($sourcePath)
if ($sql -match '(?im)^\s*(USE\s|CREATE\s+DATABASE\s|DROP\s+DATABASE\s)' -or $sql -match '(?is)/\*!\d*\s*(USE\s|CREATE\s+DATABASE\s|DROP\s+DATABASE\s)') {
    throw 'The dump changes databases. Use a single-database dump from database/backup.ps1.'
}
$remotePath = '/tmp/restore_' + [guid]::NewGuid().ToString('N') + '.sql'
$createFile = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString('N') + '.sql')
try {
    # CREATE DATABASE fails if the target exists. Never overwrite running data.
    [IO.File]::WriteAllText($createFile, ('CREATE DATABASE `' + $DatabaseName + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;'), [Text.UTF8Encoding]::new($false))
    docker cp $createFile "${ContainerName}:$remotePath"
    if ($LASTEXITCODE -ne 0) { throw 'Copying CREATE DATABASE failed.' }
    $command = 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --user=root --default-character-set=utf8mb4 < ' + $remotePath
    docker exec $ContainerName sh -c $command
    if ($LASTEXITCODE -ne 0) { throw 'Target database must be NEW. Existing databases are never overwritten.' }
    docker cp $sourcePath "${ContainerName}:$remotePath"
    if ($LASTEXITCODE -ne 0) { throw 'Copying the SQL dump failed.' }
    $command = 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --user=root --default-character-set=utf8mb4 ' + $DatabaseName + ' < ' + $remotePath
    docker exec $ContainerName sh -c $command
    if ($LASTEXITCODE -ne 0) { throw 'Restore failed. The new database may contain partial data; inspect it before retrying.' }
    Write-Host "Restored into ${ContainerName}/$DatabaseName"
} finally {
    docker exec $ContainerName rm -f $remotePath | Out-Null
    Remove-Item -LiteralPath $createFile -ErrorAction SilentlyContinue
}
