# Run in PowerShell from inside the github-site folder:  powershell -ExecutionPolicy Bypass -File download-images.ps1
$ErrorActionPreference = "Continue"
$items = Get-Content -Raw -Encoding UTF8 "image-manifest.json" | ConvertFrom-Json
$i = 0; $ok = 0
foreach ($it in $items) {
  $i++
  $dir = Split-Path -Parent $it.path
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  if (Test-Path -LiteralPath $it.path) { $ok++; continue }
  try { Invoke-WebRequest -Uri $it.url -OutFile $it.path -UserAgent "Mozilla/5.0" -UseBasicParsing; $ok++; Write-Host "[$i/$($items.Count)] OK  $($it.path)" }
  catch { Write-Host "[$i/$($items.Count)] FAIL $($it.url)" -ForegroundColor Red }
}
Write-Host "Done: $ok of $($items.Count) images saved."