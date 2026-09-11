# Portable zip packaging: electron-builder --dir (copy + asar only, no installer)
# Output: dist/win-unpacked/ -> single zip, extract & run, no installation needed.
$ErrorActionPreference = 'Stop'

Write-Host '[zip] electron-builder --dir ...' -ForegroundColor Cyan
# electronDist 已在 electron-builder.yml 指向本地 node_modules（离线打包，不下载）
npx electron-builder --dir
if ($LASTEXITCODE -ne 0) { throw "electron-builder --dir failed" }

$unpacked = Join-Path $PWD 'dist\win-unpacked'
if (-not (Test-Path $unpacked)) { throw "win-unpacked not found: $unpacked" }

$version = (node -p "require('./package.json').version").Trim()
$zipPath = Join-Path $PWD "dist\CS2-Demo-Analyst-$version-win64-portable.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

# 解压后目录名统一为 CS2-Demo-Analyst/：先复制到临时目录再整体压缩
$stage = Join-Path $PWD "dist\.zip-stage\CS2-Demo-Analyst"
if (Test-Path (Split-Path $stage -Parent)) { Remove-Item (Split-Path $stage -Parent) -Recurse -Force }
Copy-Item $unpacked $stage -Recurse

Write-Host '[zip] compressing (Compress-Archive) ...' -ForegroundColor Cyan
Compress-Archive -Path $stage -DestinationPath $zipPath -CompressionLevel Fastest
Remove-Item (Split-Path $stage -Parent) -Recurse -Force

$sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host "[zip] DONE -> $zipPath ($sizeMB MB)" -ForegroundColor Green
