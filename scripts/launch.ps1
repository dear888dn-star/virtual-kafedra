# Virtual Kafedra ishga tushirgich: server yoqilmagan bo'lsa yoqadi, so'ng brauzerda ochadi.
param([string]$Page = "")
$root = Split-Path -Parent $PSScriptRoot
$port = 3100
if ($env:PORT) { $port = [int]$env:PORT }
$url = "http://localhost:$port"

function Test-Port {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $port); return $true } catch { return $false } finally { $c.Close() }
}

if (-not (Test-Port)) {
  $log = Join-Path $root 'server.log'
  Start-Process -FilePath 'node' -ArgumentList '--import', 'tsx', 'src/server/index.ts' `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput $log -RedirectStandardError (Join-Path $root 'server-error.log')
  for ($i = 0; $i -lt 40 -and -not (Test-Port); $i++) { Start-Sleep -Milliseconds 500 }
}

Start-Process ($url + $Page)
