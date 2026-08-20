# task_plan.md — CS2 Demo Analyst 构建计划

## 目标

从零构建「CS2 Demo 分析师」Windows 桌面应用（灵感来自 Swift DemoUI Pro，差异化: 挂接注入而非自带播放器、语音转写、原生观战 HUD 风格 UI）。零原生模块，Electron + React + 纯 JS 解析。

## 阶段

### Phase 0 — 脚手架 + 设计系统 ✅
- [x] 0.1 npm 工程 + electron-builder + 目录结构
- [x] 0.2 HUD 设计系统（斜切角/发丝线/噪点/Chakra Petch + 系统 CJK）
- [x] 0.3 无边框窗口 + 标题栏 + 导航 + i18n(zh/en)
- [x] 0.4 五个页面 + mock 数据 + 截图验证（视觉验收通过）

### Phase 1 — Demo 库与真实解析 ✅
- [x] 1.1 库服务: 目录扫描（chokidar）+ index.json 缓存 + 解析队列 + 进度事件
- [x] 1.2 deadem 解析（真实 demo 验证）: 地图/比分(CCSTeam 权威值)/21 回合/击杀/聊天/语音检测(2133s)/伪 MVP
- [x] 1.3 关键事件适配: CS2 1.41 无 round_start/round_end → round_prestart/round_officially_ended; 胜负 = 炸弹事件+回合最后一杀; 预热回合过滤
- [x] 1.4 真实数据渲染验证（DE_ANCIENT 8:13 · VOICE 标签 · 击杀流 · 选手表）
- 备注: 踩坑记录见 progress.md（BOM/userData 路径/构建静默失败）

### Phase 2 — 语音提取与转写 ✅
- [x] 2.1 下载服务（https + 镜像回退 + 进度）; sidecar 管理（csgove 2.9MB / whisper-cli 7.8MB / ggml 模型按需）
- [x] 2.2 提取: csgove split-full → 每玩家全时长 WAV（时间轴对齐）
- [x] 2.3 转写引擎: 本地 whisper-cli（-l auto -oj）+ 云端 OpenAI 兼容（Groq verbose_json）
- [x] 2.4 流水线: WAV → segments → tick/回合映射 → transcript.json 增量持久化; 进度/分段事件
- [x] 2.5 转写工作台接通真实数据（分段流式显示、筛选、导出、点击跳转）
- 验收: 测试 demo（含 2133s 语音）提取+转写成功, 时间戳与回合对齐（rio demo 249 段）

### Phase 3 — 挂接与注入 ✅（本会话补齐 IPC/UI 出口）
- [x] 3.1 cs2 进程检测（tasklist 轮询）+ CS2 安装定位（Steam 注册表/steamapps）→ `live:locateInstall`
- [x] 3.2 VConsole2 TS 客户端（CMND/PRNT/CHAN）+ mock server（--vcon-mock）
- [x] 3.3 注入指令集: demo_gototick/pause/resume/timescale/spec_goto/spec_next/spec_prev
- [x] 3.4 GSI: cfg 生成 + 本地 HTTP server → `live:installGsi` + 设置页一键写入
- [x] 3.5 启动器: Mode A 挂接 + Mode B 外部启动（steam://run/730//-tools / +playdemo）→ `live:launch`
- [x] 3.6 实况页接通 + 详情/转写页点击跳转打通；GSI → 悬浮层实况模式（overlay.updateLiveGsi）
- 验收: --vcon-mock 端到端通过（VCON 连接、demo_info 回显、LIVE 状态，截图 shot-live-vcon.png）

### Phase 4 — Overlay + 打包 + 文档 ✅
- [x] 4.1 Overlay 透明置顶窗口（纯语音 HUD：说话者+字幕；无地图/比分/回合；demo sim + GSI 实况模式）
- [x] 4.2 打磨: UI v4 苹果风重设计（SF 系统字体/毛玻璃/iOS 蓝/macOS 红绿灯/iOS 开关分段）；黑屏 bug 修复 + ErrorBoundary
- [x] 4.3 打包: portable zip 离线可用（electronDist 指向本地 node_modules）；158.3MB；NSIS 未配置为目标（分发以 zip 为主）
- [x] 4.4 文档: README/DEVELOPMENT/GUIDE/findings 随功能同步
- [x] 4.5 端到端自测: smoke + 打包 exe 冒烟 + 全页面截图（apple-*.png）+ `--eval-js` 黑屏回归（切语言/改设置）

## 错误记录
| 错误 | 尝试 | 解决 |
|------|------|------|
| npm ERESOLVE (vite 8 vs electron-vite 5) | — | 锁 vite@7 + plugin-react@5 |
| Electron 二进制下载 fetch failed | 重试 | ELECTRON_MIRROR=npmmirror |
| deadem 打包后 proto.json 找不到 | external | main 保持 external（node 原生解析） |
| TS7 兼容风险 | — | 锁 typescript@5.9 |
| 回合事件丢失 | 调试 dump | round_officially_ended 与 prestart 同 tick; 始终 close+push |
| 预热回合混入 | dump 时间线 | begin_new_match/announce_match_start tick 过滤 + 短回合剔除 |
| main 构建静默失败导致跑旧包 | 查 bundle | 修 scan try 未闭合; 以 bundle 内容核对 |
| 设置读不到 roots | 排查 | UTF-8 BOM 破坏 JSON.parse（读时剥离）; userData 路径 = productName 目录（app.setName 固定） |
| `electron out/main/index.js` app.name=Electron | app.setName | userData 固定 %APPDATA%\CS2 Demo Analyst |
| 切语言/改设置后页面全黑 | 查事件契约 | settings:changed 主进程发裸对象，renderer 读 e.settings=undefined → setSettings(undefined) → return null；改发 `{settings}` 包装 + ErrorBoundary 兜底 |
| 批量截图部分页面不是目标页 | 查 argv | PowerShell 把带空格参数当单参数（--route=live --vcon-mock 整体失效）；逐参数传递 |
| 截图时 electron 秒退无输出 | 查进程 | 残留实例占单实例锁（app.quit）；跑截图前清理 CS2 Demo Analyst 进程 |

## 决策记录
- Electron（无 MSVC/Rust 环境, 纯 JS 栈最稳）; deadem 纯 JS 解析; SVC_VOICE_DATA 计数做语音检测; 转写 = csgove 提取 + whisper.cpp/Groq; 注入 = VConsole2(-tools) + GSI; 不抄 Swift DemoUI Pro 代码。
