# progress.md — 会话日志

## 2026 首轮（研究 + 决策 + Phase 0）
- 研究 Swift DemoUI Pro / cs2-demoparser / deadem / csgove / VConsole2 / GSI / whisper.cpp（结论入 findings.md）。
- 环境: Node 24 / Python 3.11 / git; 无 rust/msvc。用户决策: 好打包不易出问题 → Electron 纯 JS 栈; 转写快+免费+一键配置 → 本地 Whisper + Groq 双引擎; 注入可接受外部启动（参考 CS Demo Manager）。
- Phase 0 完成: 脚手架、HUD 设计系统（斜切角/噪点/Chakra Petch）、五页面、i18n、截图验收。
- 踩坑: npm ERESOLVE → vite@7; electron 下载失败 → npmmirror; TS7 → 锁 5.9。

## Phase 1（真实解析 + 资料库）✅
- 解析器（deadem）经真实职业 demo 验证: 21 回合/138 击杀/8:13 权威比分/语音 2133s/伪 MVP; 2.3s 解析 197MB。
- CS2 1.41 事件适配: 无 round_start/round_end → round_prestart/round_officially_ended（同 tick）; 胜负 = 炸弹事件+回合最后一杀; 预热过滤（begin_new_match / announce_match_start）; mapName 字段; CCSTeam 实体（类名 CCSTeam 非 CSTeam）; player_team 事件定阵营。
- 库服务: 扫描(chokidar)/index.json 缓存/顺序解析队列/进度事件/详情持久化; 实测渲染正常。
- 踩坑: main 构建静默失败→跑旧包（查 bundle 内容核对）; settings.json UTF-8 BOM 破坏解析（读时剥离）; userData = productName 目录（app.setName 固定）; `electron out/main/index.js` 与 `electron .` 的 app.name 差异。
- 测试 fixture: deadem CDN 下载 IEM Rio 2024 职业 demo（197MB, 不入库, gitignore）。

## Phase 2（语音提取与转写）✅
- sidecar: csgove v3.1.6（2.9MB）+ whisper.cpp v1.9.2 CPU（7.8MB）+ ggml 模型按需（HF/hf-mirror）。
- 下载服务: https 重定向/进度/镜像回退（ghfast.top/gh-proxy/mirror.ghproxy）。
- 提取: csgove split-full（全时长对齐时间轴）; 踩坑: DLL 需从引擎目录 cwd 运行; GitHub URL 拼接不能用 path.join。
- 转写: 本地 whisper-cli（-l auto -oj）+ 云端 OpenAI 兼容（Groq verbose_json）。
- 流水线: WAV → segments → tick/回合映射 → transcript.json 持久化; asr:progress/asr:segment 事件; 取消支持（AbortController）。
- 设置页: 引擎/模型状态 + 一键下载 + 进度条。
- Web 语音解码闭环: ffmpeg.wasm + Ogg Opus muxer（真实 demo 验证）; Electron 壳内 FS error → 桌面走 csgove; COOP/COEP 头。

## 中轮（Web 优先 + UI v2 + 语音 HUD）
- 架构演进: Web 版（浏览器解析 1.3s/76MB + 语音 WASM 解码 + GitHub Pages 可发布）+ Electron 保留 + 本地桥规划。
- UI v2 重设计: 去 AI 模板味（去斜切角/噪点/发光），改 CS2 原生观战语言（近黑蓝底/米白/金蓝阵营色/Rajdhani/1px 细线）。
- 游戏内语音显示: 左下角 CS2 原生语音 HUD（头像+阵营色名字+声波，无字幕）; Steam 头像从 SERVER_AVATAR_OVERRIDES 解析（完美平台 demo 10/11 命中）; 字幕移到大屏底部居中可选。
- 环境: 代理 127.0.0.1:7897 关闭时 GitHub 直连 ETIMEDOUT（curl schannel SEC_E_NO_CREDENTIALS）→ 推送/发布需代理在线。

## 本轮（Phase 3 补齐 + Phase 4 打包）✅
- Phase 3 缺口补齐: `live:launch`（steam://run/730//-tools / +playdemo，shell.openExternal）、`live:installGsi`、`live:locateInstall`、`spec_goto` 指令; preload/types/webmock 同步。
- UI: 设置页「自动检测 / 安装 GSI 配置 / 启动 CS2（-tools）」一键三件套; 实况页「启动 CS2」按钮 + 观战选手 ID 输入; 详情页「CS2 中播放」（Mode B 外部启动 +playdemo）。
- Overlay 实况模式: GSI → overlay.updateLiveGsi（demo sim 优先）; 悬浮层显示地图/比分/回合。
- 验收: typecheck ✅; web:build ✅; `--vcon-mock` 端到端 ✅（VCON 连上 mock、demo_info 回显、LIVE 状态，截图 shot-live-vcon.png）; smoke ✅; 打包 exe 冒烟 ✅。
- 打包: electron-builder 下载 electron 失败 → electronDist 指向本地 node_modules（离线可用）; 依赖瘦身（React/ffmpeg/字体 → devDependencies）+ electronLanguages [en-US, zh-CN]; zip 200MB → 159MB; PS5.1 Add-Type 失败 → Compress-Archive。
- 修复: SettingsPage 两处乱码（'涓浗'→中文、'鉁?'→移除按钮文案）。

## 下一步
- 发布: 推送 4+ 提交到 origin（需代理在线）→ GitHub Pages 部署（web-dist, base './' 已配）→ README 截图刷新。
- 后续: Web 版本地桥（Phase B）; 实机 CS2 验证 VConsole 握手/GSI 推送; NSIS 安装器（可选）; 包体继续压缩（<120MB 目标）。
