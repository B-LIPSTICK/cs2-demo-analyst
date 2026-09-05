# CDP probe: watch whether demo-card DOM nodes get rebuilt periodically.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/cdp-probe.ps1 [seconds]
param([int]$WatchSec = 14)
$wsUrl = (Invoke-RestMethod "http://127.0.0.1:9222/json" -TimeoutSec 5 | Where-Object { $_.type -eq 'page' } | Select-Object -First 1).webSocketDebuggerUrl
if (!$wsUrl) { Write-Error 'no page target'; exit 1 }

function Invoke-CdpEval([string]$expression) {
    $ws = [System.Net.WebSockets.ClientWebSocket]::new()
    [void]$ws.ConnectAsync([uri]$wsUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    $msg = '{"id":1,"method":"Runtime.evaluate","params":{"expression":' +
        ($expression | ConvertTo-Json -Compress) + ',"returnByValue":true}}'
    $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
    $seg = [ArraySegment[byte]]::new($bytes)
    [void]$ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    $sb = New-Object Text.StringBuilder
    $buf = New-Object byte[] 65536
    do {
        $res = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $res.Count))
    } while (-not $res.EndOfMessage)
    $ws.Dispose()
    return $sb.ToString()
}

$install = @'
(function(){
  try { if (window.__probe && window.__probe.obs) window.__probe.obs.disconnect(); } catch(e){}
  var out = { t0: Date.now(), adds:0, removes:0, gridAdds:0, gridRemoves:0, events: [], grids: 0, pages: 0 };
  function onChild(muts){
    for (var i=0;i<muts.length;i++){
      var m=muts[i];
      if (m.type!=='childList') continue;
      out.adds += m.addedNodes.length; out.removes += m.removedNodes.length;
      var isGrid = m.target && m.target.className && String(m.target.className).indexOf('card-grid')>=0;
      if (isGrid){ out.gridAdds += m.addedNodes.length; out.gridRemoves += m.removedNodes.length; }
      if (Date.now()-out.t0 < 20000 && (m.addedNodes.length||m.removedNodes.length)){
        out.events.push({t: Math.round(Date.now()-out.t0), add:m.addedNodes.length, rem:m.removedNodes.length, grid:!!isGrid, cls: String(m.target.className||'').slice(0,40)});
      }
    }
  }
  var obs = new MutationObserver(onChild);
  obs.observe(document.body, {childList:true, subtree:true});
  out.obs = obs;
  out.grids = document.querySelectorAll('.card-grid').length;
  out.pages = document.querySelectorAll('.page').length;
  // deeper signature watcher: log removed .page detail
  var det = [];
  function onDetail(muts){
    for (var i=0;i<muts.length;i++){
      var m = muts[i];
      if (m.type!=='childList') continue;
      if (!m.target || m.target.nodeType!==1) continue;
      var tcls = String(m.target.className||'');
      if (tcls.indexOf('page')<0) continue;
      var pages = document.querySelectorAll('.page');
      var idx = -1;
      for (var p=0;p<pages.length;p++){ if (pages[p]===m.target) idx=p; }
      var rm = [];
      for (var j=0;j<m.removedNodes.length;j++){ var n=m.removedNodes[j]; if (n.nodeType===1) rm.push(String(n.className||n.tagName).slice(0,60)); }
      var ad = [];
      for (var k=0;k<m.addedNodes.length;k++){ var a=m.addedNodes[k]; if (a.nodeType===1) ad.push(String(a.className||a.tagName).slice(0,60)); }
      if (Date.now()-out.t0<16000 && (rm.length||ad.length)) det.push({t: Math.round(Date.now()-out.t0), idx: idx, rm: rm, ad: ad});
    }
  }
  var obs2 = new MutationObserver(onDetail);
  obs2.observe(document.body, {childList:true, subtree:true});
  out.det = det;
  out.obs2 = obs2;
  out.ready = 1;
  window.__probe = out;
  return 'installed grids='+out.grids;
})();
'@

$r1 = Invoke-CdpEval $install
Write-Output "install: $r1"
Start-Sleep -Seconds $WatchSec
$read = 'JSON.stringify(window.__probe)'
$raw = Invoke-CdpEval $read
$json = $raw | ConvertFrom-Json
$v = $json.result.result.value
Write-Output "probe: $v"
