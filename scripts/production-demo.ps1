param(
    [string]$EnvFile = ".env.production-demo",
    [switch]$SkipFrontendBuild,
    [switch]$SkipComposeUp,
    [switch]$SkipHealthCheck
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root

function Get-DotEnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if (-not (Test-Path $Path)) {
        return $null
    }

    $prefix = "$Name="
    foreach ($line in Get-Content $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }
        if ($trimmed.StartsWith($prefix)) {
            return $trimmed.Substring($prefix.Length).Trim().Trim('"').Trim("'")
        }
    }

    return $null
}

function Set-FrontendEnvFromDemoFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    $frontendEnvNames = @(
        "VITE_API_BASE_URL",
        "VITE_WITH_CREDENTIALS",
        "VITE_ENABLE_LEGACY_BUCKET_API_MAPPING"
    )

    foreach ($name in $frontendEnvNames) {
        $value = Get-DotEnvValue -Path $Path -Name $name
        if ($null -ne $value -and $value -ne "") {
            Set-Item -Path "Env:$name" -Value $value
        }
    }

    if (-not $env:VITE_API_BASE_URL) {
        $env:VITE_API_BASE_URL = "/api/v1"
    }
    if (-not $env:VITE_WITH_CREDENTIALS) {
        $env:VITE_WITH_CREDENTIALS = "true"
    }
    if (-not $env:VITE_ENABLE_LEGACY_BUCKET_API_MAPPING) {
        $env:VITE_ENABLE_LEGACY_BUCKET_API_MAPPING = "false"
    }
}

try {
    if (-not (Test-Path $EnvFile)) {
        Copy-Item ".env.production-demo.example" $EnvFile
        Write-Host "Created $EnvFile from .env.production-demo.example. Review secrets before public exposure."
    }

    $demoMode = [string](Get-DotEnvValue -Path $EnvFile -Name "DEMO_MODE")
    if ($demoMode.ToLowerInvariant() -ne "true") {
        throw "Production-demo requires DEMO_MODE=true in $EnvFile."
    }

    $telegramEnabled = [string](Get-DotEnvValue -Path $EnvFile -Name "TELEGRAM_ALERTS_ENABLED")
    $telegramMock = [string](Get-DotEnvValue -Path $EnvFile -Name "TELEGRAM_MOCK_MODE")
    if ($telegramEnabled.ToLowerInvariant() -ne "false" -or $telegramMock.ToLowerInvariant() -ne "true") {
        throw "Production-demo must keep Telegram offline by default: TELEGRAM_ALERTS_ENABLED=false and TELEGRAM_MOCK_MODE=true."
    }

    $publicAppUrl = [string](Get-DotEnvValue -Path $EnvFile -Name "PUBLIC_APP_URL")
    if ($publicAppUrl -match "<your-domain>|localhost") {
        Write-Warning "PUBLIC_APP_URL is still '$publicAppUrl'. Replace it with the deployed Yandex VM domain before public demo."
    }

    if (-not $SkipFrontendBuild) {
        Set-FrontendEnvFromDemoFile -Path $EnvFile
        Push-Location "frontend"
        try {
            npm.cmd run build
        } finally {
            Pop-Location
        }
    }

    $compose = @("--env-file", $EnvFile, "-f", "docker-compose.prod.yml")

    docker compose @compose config | Out-Null

    if (-not $SkipComposeUp) {
        docker compose @compose build app celery_worker celery_beat
        docker compose @compose up -d --wait postgres redis
        docker compose @compose run --rm --no-deps app alembic upgrade head
        docker compose @compose up -d
    }

    if (-not $SkipHealthCheck -and -not $SkipComposeUp) {
        $urls = @(
            "http://localhost:8000/health",
            "http://localhost:8000/subscribers",
            "http://localhost:8000/subscribers/1",
            "http://localhost:8000/network/radius",
            "http://localhost:8000/network/gpon",
            "http://localhost:8000/monitoring/zabbix",
            "http://localhost:8000/noc/incidents",
            "http://localhost:8000/noc/incidents/1",
            "http://localhost:8000/audit"
        )

        foreach ($url in $urls) {
            docker compose @compose exec -T app curl -fsS $url | Out-Null
            Write-Host "OK $url"
        }
    }

    Write-Host "Production-demo bootstrap is ready. Open the deployed host and check the MVP deep links."
} finally {
    Pop-Location
}
