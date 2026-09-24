$envPath = 'C:\Applications\lark-dispatch-backend\.env'
$lines = [System.Collections.Generic.List[string]]::new()
if (Test-Path -LiteralPath $envPath) {
  foreach ($line in Get-Content -LiteralPath $envPath) { [void]$lines.Add($line) }
}
$updates = [ordered]@{
  TRACKER_REPORT_EMAIL_ENABLED = 'true'
  TRACKER_MILEAGE_SYNC_ENABLED = 'true'
  TRACKER_MILEAGE_SYNC_STATE_PATH = './data/tracker-mileage-sync.json'
}
foreach ($key in $updates.Keys) {
  $found = $false
  for ($index = 0; $index -lt $lines.Count; $index += 1) {
    if ($lines[$index] -match "^$([regex]::Escape($key))=") {
      $lines[$index] = "$key=$($updates[$key])"
      $found = $true
      break
    }
  }
  if (-not $found) { [void]$lines.Add("$key=$($updates[$key])") }
}
[System.IO.File]::WriteAllLines($envPath, $lines, [System.Text.UTF8Encoding]::new($false))
Write-Output 'Tracker mileage sync configuration updated'
