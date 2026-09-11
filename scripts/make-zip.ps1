# Portable zip packaging: electron-builder --dir (copy + asar only, no installer)
# Output: dist/win-unpacked/ -> single zip, extract & run, no installation needed.
$ErrorActionPreference = 'Stop'

$stageBuild = Join-Path $PWD 'dist\.build-stage'
if (Test-Path $stageBuild) { Remove-Item $stageBuild -Recurse -Force }

Write-Host '[zip] electron-builder --dir ...' -ForegroundColor Cyan
# electronDist 已在 electron-builder.yml 指向本地 node_modules（离线打包，不下载）
# 使用独立输出目录避免用户正在运行 win-unpacked 时因 dll 锁定导致打包失败
npx electron-builder --dir --config.directories.output="dist/.build-stage"
if ($LASTEXITCODE -ne 0) { throw "electron-builder --dir failed" }

$unpacked = Join-Path $stageBuild 'win-unpacked'
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

# 同步回 dist\win-unpacked（若当前未被运行占用）
$finalUnpacked = Join-Path $PWD 'dist\win-unpacked'
try {
  if (Test-Path $finalUnpacked) {
    Copy-Item "$unpacked\*" $finalUnpacked -Recurse -Force -ErrorAction Stop
  } else {
    Copy-Item $unpacked $finalUnpacked -Recurse -Force -ErrorAction Stop
  }
} catch {
  Write-Host '[zip] win-unpacked 正在被运行中的程序占用，已保留便携 zip' -ForegroundColor Yellow
}
Remove-Item $stageBuild -Recurse -Force

$sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host "[zip] DONE -> $zipPath ($sizeMB MB)" -ForegroundColor Green
