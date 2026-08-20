# Portable zip packaging: electron-builder --dir (copy + asar only, no installer)
# Output: dist/win-unpacked/ -> single zip, extract & run, no installation needed.
$ErrorActionPreference = 'Stop'

Write-Host '[zip] electron-builder --dir ...' -ForegroundColor Cyan
npx electron-builder --dir
if ($LASTEXITCODE -ne 0) { throw "electron-builder --dir failed" }

$unpacked = Join-Path $PWD 'dist\win-unpacked'
if (-not (Test-Path $unpacked)) { throw "win-unpacked not found: $unpacked" }

$version = (node -p "require('./package.json').version").Trim()
$zipPath = Join-Path $PWD "dist\CS2-Demo-Analyst-$version-win64-portable.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Write-Host '[zip] compressing (fastest level) ...' -ForegroundColor Cyan
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
$level = [System.IO.Compression.CompressionLevel]::Fastest
$files = Get-ChildItem $unpacked -Recurse -File
$total = $files.Count
$i = 0
foreach ($file in $files) {
    $i++
    if ($i % 300 -eq 0) { Write-Host "  $i / $total" }
    $rel = $file.FullName.Substring($unpacked.Length + 1).Replace('\', '/')
    $entry = $zip.CreateEntry("CS2-Demo-Analyst/$rel", $level)
    $in = $file.OpenRead()
    $out = $entry.Open()
    $in.CopyTo($out)
    $out.Dispose()
    $in.Dispose()
}
$zip.Dispose()

$sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host "[zip] DONE -> $zipPath ($sizeMB MB)" -ForegroundColor Green
