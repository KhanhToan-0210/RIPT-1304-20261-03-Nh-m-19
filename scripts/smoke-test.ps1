param(
    [ValidatePattern('^shoponline-test(?:-[a-z0-9-]+)?$')]
    [string]$ProjectName = 'shoponline-test',
    [ValidateSet('seed', 'verify', 'api')]
    [string]$Mode = 'api'
)

$ErrorActionPreference = 'Stop'
$composeFile = Join-Path $PSScriptRoot '..\compose.test.yml'

foreach ($service in @('primary-web', 'standby-web')) {
    Write-Output "Checking TEST $ProjectName / $service / $Mode"
    docker compose -f $composeFile -p $ProjectName exec -T `
        -e NODE_PATH=/app/backend/node_modules `
        -e CHECK_DATABASE=shoponline_check_phase_b `
        -e CHECK_API=http://127.0.0.1:3000/api `
        $service node /app/database/verify.cjs $Mode
    if ($LASTEXITCODE -ne 0) {
        throw "TEST $service failed in mode $Mode (exit $LASTEXITCODE)."
    }
}

Write-Output "PASS TEST smoke ($Mode) on both web/DB pairs."
