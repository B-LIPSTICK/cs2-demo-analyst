# CDP screenshot of the running app page.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/cdp-shot.ps1 <route> <out.png>
param([string]$Route, [string]$OutPng)
$wsUrl = (Invoke-RestMethod "http://127.0.0.1:9222/json" -TimeoutSec 5 | Where-Object { $_.type -eq 'page' } | Select-Object -First 1).webSocketDebuggerUrl
if (!$wsUrl) { Write-Error 'no page target'; exit 1 }
$ws = [System.Net.WebSockets.ClientWebSocket]::new()
[void]$ws.ConnectAsync([uri]$wsUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
$msg = '{"id":1,"method":"Page.captureScreenshot","params":{"format":"png"}}'
[void]$ws.SendAsync([ArraySegment[byte]]::new([Text.Encoding]::UTF8.GetBytes($msg)), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
$sb = New-Object Text.StringBuilder
$buf = New-Object byte[] 1048576
$deadline = (Get-Date).AddSeconds(10)
$done = $false
while ((Get-Date) -lt $deadline) {
  $res = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
  [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $res.Count))
  if ($res.EndOfMessage) { $done = $true; break }
}
$ws.Dispose()
if (!$done) { Write-Error 'capture timeout'; exit 1 }
$json = $sb.ToString() | ConvertFrom-Json
$b64 = $json.result.data
if (!$b64) { Write-Error ("no data: " + $json.ToString()); exit 1 }
$bytes = [Convert]::FromBase64String($b64)
[System.IO.File]::WriteAllBytes($OutPng, $bytes)
Write-Output "saved $OutPng ($($bytes.Length) bytes)"
