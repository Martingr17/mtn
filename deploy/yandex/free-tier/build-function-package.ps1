param(
    [string]$Destination = "$PSScriptRoot\\function-package"
)

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..\\..")).Path
$backendDir = Join-Path $projectRoot "app"

if (Test-Path -LiteralPath $Destination) {
    Remove-Item -LiteralPath $Destination -Recurse -Force
}

New-Item -ItemType Directory -Path $Destination | Out-Null

Copy-Item -LiteralPath (Join-Path $projectRoot "serverless_handler.py") -Destination $Destination
Copy-Item -LiteralPath (Join-Path $projectRoot "requirements.txt") -Destination $Destination
Copy-Item -LiteralPath $backendDir -Destination (Join-Path $Destination "app") -Recurse

if (Test-Path -LiteralPath (Join-Path $Destination "app\\static\\spa")) {
    Remove-Item -LiteralPath (Join-Path $Destination "app\\static\\spa") -Recurse -Force
}

if (Test-Path -LiteralPath (Join-Path $Destination "app\\alembic\\script.py.mako.py")) {
    Remove-Item -LiteralPath (Join-Path $Destination "app\\alembic\\script.py.mako.py") -Force
}

Get-ChildItem -Path $Destination -Directory -Recurse -Filter "__pycache__" | Remove-Item -Recurse -Force
Get-ChildItem -Path $Destination -File -Recurse -Include "*.pyc", "*.pyo" | Remove-Item -Force

Write-Host "Cloud Function package prepared at $Destination"
