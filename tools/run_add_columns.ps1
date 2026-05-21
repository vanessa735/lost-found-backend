<#
PowerShell helper to run the SQL migration `add_user_notification_columns.sql`.
This script assumes `mysql` CLI is installed and available in PATH.

Usage:
  1) Open PowerShell in project root or run from here.
  2) Set environment variables or pass interactively when prompted.
  3) The script will invoke `mysql` which will prompt for the DB password.
#>

$sqlFile = Join-Path $PSScriptRoot 'add_user_notification_columns.sql'
if (-not (Test-Path $sqlFile)) {
    Write-Error "Migration file not found: $sqlFile"
    exit 1
}

Write-Host "This will run the migration against your MySQL database."
$host = Read-Host "DB Host (default: localhost)"; if (!$host) { $host = 'localhost' }
$port = Read-Host "DB Port (default: 3306)"; if (!$port) { $port = '3306' }
$user = Read-Host "DB User (e.g. root)"; if (!$user) { $user = 'root' }
$db   = Read-Host "Database name (e.g. lost_and_found_db)"

if (-not $db) {
    Write-Error "Database name is required. Aborting."
    exit 1
}

$cmd = "mysql -h $host -P $port -u $user -p $db < `"$sqlFile`""

Write-Host "About to run: $cmd"
Write-Host "You will be prompted for the DB password by the mysql client."

try {
    iex $cmd
    Write-Host "Migration executed. Verify your DB and restart backend."
} catch {
    Write-Error "Failed to run migration: $_"
}
