param(
  [string]$Bucket = "mtn",
  [string]$WebsiteUrl = "https://mtn.website.yandexcloud.net/",
  [string]$OAuthToken = $env:YANDEX_OAUTH_TOKEN,
  [string]$IamToken = $env:YC_IAM_TOKEN
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Resolve-Path (Join-Path $ScriptDir "..\..\..")
$FrontendDir = Join-Path $AppRoot "frontend"
$DistDir = Join-Path $FrontendDir "dist"

Push-Location $FrontendDir
try {
  & "C:\Program Files\nodejs\npm.cmd" run build:object-storage
} finally {
  Pop-Location
}

$uploadArgs = @(
  ".\upload_static_site.py",
  "--bucket", $Bucket,
  "--source", $DistDir,
  "--website-url", $WebsiteUrl
)

if ($IamToken) {
  $uploadArgs += @("--iam-token", $IamToken)
} elseif ($OAuthToken) {
  $uploadArgs += @("--oauth-token", $OAuthToken)
} else {
  throw "Set YANDEX_OAUTH_TOKEN or YC_IAM_TOKEN before running this script."
}

Push-Location $ScriptDir
try {
  python @uploadArgs
} finally {
  Pop-Location
}
