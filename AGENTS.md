# AGENTS.md — 给接手本项目的 AI/开发者

> 本文件是**任何新会话（新 agent）开工前必读**的交接文档，目标：读完后能独立修改、构建、验证、交付。
> 配套资料（越新越优先）：
> 1. 本文件 —— 架构与协作规则（入口）
> 2. `progress.md` —— **逐轮会话日志**（含每轮结论/坑/遗留问题，开工先翻到最上面的最新轮）
> 3. `findings.md` —— 深度研究结论（VConsole/GSI/deadem/VPK 逆向等）
> 4. `docs/DEVELOPMENT.md` —— 架构总览（部分内容偏旧，以本文件为准）

---

## 0. 项目一句话

**CS2 Demo Analyst**：Windows 桌面绿色便携版（Electron + React 19 + TS）CS2 复盘工具 —— 拖入 `.dem` 自动解析（比分/回合/击杀/选手），把 demo 里的**游戏语音转写成可搜索文字**（本地 whisper / 云端 Groq），还能以**普通模式驱动 CS2 内置播放器**播放 demo，并可选通过 **VPK 注入 Panorama UI** 在游戏画面内显示说话者 HUD。开源（MIT），作者自用 + GitHub 公开。

## 1. ⚠️ 协作铁律（违反 = 白干）

1. **测试/真机验证一律由用户操作**（用户明令："测试的任务可以交给我，省 token 还快"）。agent 只写代码、脚本、文档；**不要自动启动 CS2、不要自动跑真机播放/注入**。验证类脚本写好交给用户跑。
2. 真机运行的应用实例由 agent 通过 `Start-Process` 启动/杀进程管理（`Get-Process 'CS2 Demo Analyst' | Stop-Process -Force`）——这是允许的；但 CS2 游戏本体相关测试不要自动做。
3. 改完代码**必须**过 `npm run typecheck`；UI/主进程改动后 `npm run build`；需要交付新包时 `powershell -ExecutionPolicy Bypass -File scripts/make-zip.ps1`（electron-builder 打包，产出 `dist/win-unpacked/` + zip）。**构建在受限沙箱会 EPERM（esbuild），需要 danger-full-access**。
4. git 提交 message 用中文、summary 风格（参考历史：`feat(parser+asr): 手枪局保留、转写链路优化、demo not found 修复`）；修复类把结论写进 `progress.md` 新轮次（放文件顶部），验证脚本入库。
5. 不要动 `node_modules`、`out/`、`dist/`；`.gitignore` 已覆盖。PowerShell 直接读含中文的 UTF-8 文件会乱码（GBK 控制台），分析文本用 read 工具或 Python（`$env:PYTHONIOENCODING='utf-8'`）。

## 2. 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | electron-vite 开发（HMR；主进程改动需重启） |
| `npm run typecheck` | TS 双工程检查（node + web），**改完必跑** |
| `npm run build` | 产出 `out/`（main/renderer/preload） |
| `powershell -ExecutionPolicy Bypass -File scripts/make-zip.ps1` | 离线打包 → `dist/win-unpacked/CS2 Demo Analyst.exe` + `dist/CS2-Demo-Analyst-0.1.0-win64-portable.zip`（~147MB，electron-builder 用本地 node_modules 的 electron，离线可用） |
| `npm run dist` | 等价 dist:zip |
| 启动/重启应用 | `Get-Process 'CS2 Demo Analyst' \| Stop-Process -Force; Start-Process "dist\win-unpacked\CS2 Demo Analyst.exe"` |

开发调试入口（`electron out/main/index.js` 或 exe 加参数）：`--vcon-mock`、`--route=<page>`、`--screenshot`、`--transcribe=<id>`、`--eval-js=<code>`（渲染进程执行 JS）。

## 3. 架构（当前真实形态）

```
src/
├── main/                    # Electron 主进程
│   ├── index.ts             # 窗口 / IPC handler / 开发模式参数
│   └── services/
│       ├── library.ts       # ★资料库：扫描/解析队列/详情缓存/转写编排 IPC 入口
│       ├── parser.ts        # ★demo 解析（deadem 纯 JS）：回合/击杀/选手/聊天/语音存在
│       ├── asr.ts           # ★语音：csgove 提取（WAV 缓存）/VAD/分割/本地+云端转写/语言
│       ├── live.ts          # CS2 启动器（普通模式 +exec cfg / voiceHud 注入模式 steam -applaunch）
│       ├── injector.ts      # gameinfo.gi 注入/恢复 + VPK 部署（HUD 用）
│       ├── vpk.ts           # 纯 JS VPK v2 writer（会话 VPK）
│       ├── voiceIndex.ts    # SVC_VOICE_DATA → {tick, slot} 语音脉冲索引
│       ├── engines.ts       # 侧车下载（csgove/whisper-cli/ggml 模型，镜像回退）
│       ├── ai.ts / settings.ts / download.ts / favorites.ts / vconsole.ts
├── renderer/src/            # React 19 UI（五页面：library/detail、transcript、live、ai、settings）
│   ├── App.tsx              # 页面常驻（display 显隐切换，不卸载！）+ route{demoId}+navSeq 导航
│   ├── pages/*.tsx          # LibraryPage(卡片+详情)/TranscriptPage/AiPage/SettingsPage/LivePage
│   ├── components/ui.tsx    # 设计系统（Btn/Tag/Panel/Avatar/Modal…）
│   ├── theme/hud.css        # 全部样式（近黑玻璃 + iOS 蓝 #0a84ff 强调；金=阵营T 蓝=CT）
│   └── i18n/{zh,en}.ts      # 双语 key（新增文案必须双份都加）
├── shared/types.ts          # ★数据模型 + IPC 契约 + MainEvent（改模型先看这里）
assets/panorama/             # ★游戏内语音 HUD 源（xml/css/js → 编译进 dsh_voice_override.vpk）
huddemocontroller/           # HUD 编译产物（vxml_c/vcss_c/vjs_c，已入库）
scripts/                     # 回归/诊断脚本（verify-*.mjs / dump-*.mjs / build-panorama.mjs / make-zip.ps1）
build/                       # electron-builder 图标（icon-256.png / icon.ico）
```

数据目录（userData，打包版 = `%APPDATA%\CS2 Demo Analyst`）：
- `settings.json` —— 设置（asr/ai/cs2/libraryRoots…，deepMerge 默认值兜底）
- `library/index.json` + `<id>.json` —— 库索引 + 详情缓存（**缓存带 parserVersion，不匹配自动重解析**）
- `voices/<demoId>/` —— csgove 提取的整轨 WAV（**可复用缓存**，别乱删）
- `cache/zips/<id>/` —— zip 容器解出的 demo

## 4. 关键链路与「血泪事实」（改动前必读）

### 4.1 解析 parser.ts
- CS2 事件事实：回合边界 `round_prestart` / `round_officially_ended`；**首回合没有 round_prestart（隐式开始）** —— v4 修复前手枪局整局丢失（`startRound` 首个 prestart 前若隐式回合有击杀需先 closeRound）；`begin_new_match` 很多平台 demo 没有，只有 `round_announce_match_start`。
- 换边（R13）判定用 `rounds.length + 1 > 12`（含隐式首回合），不是 prestart 计数。
- 击杀阵营：`roundTeamByName`（R1 采样+翻转）→ pawn 句柄兜底；首回合（队伍表空）靠 pawn。
- 玩家表权威 = USER_INFO 字符串表（击杀事件 userid 直接对应），实体 _index 有偏移不可靠（5E 平台）。
- `PARSER_VERSION`（library.ts）在解析逻辑变化时 +1 → 旧详情缓存自动失效重解析。**改了解析必须 +1**。
- 已知开放疑点：推导回合 winner（T:14 CT:5）与 CCSTeam 实体比分（6:13）系统性偏差，未查明（击杀记录颜色已确认对）。
- 验证脚本：`scripts/verify-pistol-round.mjs <demo>`、`scripts/dump-round-events.mjs <demo> [秒]`、verify-kill-teams.mjs、check-tick-entity.mjs。

### 4.2 语音 asr.ts
- csgove 输出满幅 **int32 PCM 语音在高 16 位**：`normalizeWav` 取 `>>16`（取低 16 位 = 噪声 = whisper"广播幻觉"）；它只读 44B 头判断格式，勿改回全量读。
- `extractVoice` **有 WAV 缓存复用**（demo mtime 校验），别删 voices 目录逻辑。
- 转写优先复用「语音分割」段（detail.voice 无文字项），无则 detectSpeech VAD；紧凑 WAV **段间插 0.3s 静音**（`COMPACT_PAD_SEC`）防 whisper 段边界错位重复，`mapCompactSegments` 同步计入。
- 语言参数 `settings.asr.language`（auto/zh/en…）：本地 `-l`，云端 multipart `language` 字段（auto 不传）。中文 demo 选 zh 避免繁体。
- UI 转写完成必须 `setLiveSegs([])`（否则与 detail.voice 合并整表翻倍）。

### 4.3 播放 live.ts / HUD 注入
- **+playdemo 作为启动参数会被引擎丢弃**（视角卡死根因）；正确姿势 = 写 `game/csgo/cfg/dsh-play.cfg`（内容 `playdemo "路径"`）+ `cs2.exe +exec dsh-play.cfg`；播放 cfg 含 `cl_demo_predict 0`（关闭 demo 预测，否则导播镜头卡死）+ `demo_ui_mode` 等。
- voiceHud 注入模式 = **Steam 启动**：`steam.exe -applaunch 730 -insecure -novid -consolelog ... +exec dsh-play.cfg`（SwiftDemoUIPro 同款；+exec 必须放最后）；直接 spawn cs2.exe 在注入态会崩。
- Steam 会因 gameinfo.gi/VPK 变动触发"验证本地文件"自愈机制 → 注入/恢复有 waitSteamIdle 门控，别绕。
- HUD 资源改动流程：改 `assets/panorama/{layout,hud|styles,hud|scripts,hud}/` 源文件 → `node scripts/build-panorama.mjs`（调 CS2 自带 resourcecompiler 编译 + 本项目 vpk.ts 逻辑打包）→ 重新 make-zip（VPK 经 extraResources 进 `resources/panorama/`）。**改 HUD 不重新编译 = 白改**。
- huddemocontroller.xml 是覆盖 Valve 原生 DemoUI：原生 Root/Settings/Contents 结构必须原样保留。
- HUD JS（dsh_voice.js）50ms 轮询 `GetDemoControllerState().nTick` 对 pulsesBySlot 二分；玩家经 GameStateAPI；头像 `CSGOAvatarImage.PopulateFromSteamID(xuid)`。
- **开放问题：说话者头像"左边少一竖条"（真实照片头像被裁），待用户游戏内截图确认根因**（怀疑引擎圆形遮罩偏移或说话时 scale3d(1.1) 越界——当前 CSS 有 `transform: scale3d(1.1)`，Swift 参照实现无缩放/圆角）。

### 4.4 详情就绪与报错体验
- 转写/分割/AI 对话入口统一走 `library.waitDetail(id)`（解析中自动等/缓存失效自动重解析），别直接用 detail() 抛 "demo not found"。
- 转写页 demo 下拉**订阅 library:updated 实时刷新**；按钮在 demo 未 ready 时禁用。新增"选到过期 id"场景前端对 'demo not found' 文案做友好化。

### 4.5 UI 约定
- 页面常驻：App 用 display 切页不卸载；跨页跳 demo 用 `navigate(page, demoId)` + **navSeq**（同 demo 重复跳转也生效）；目标页 effect 依赖 `[initialDemoId, navSeq]`。
- 弹窗要视口居中必须 `createPortal` 到 body（`.page` 有 fadeUp 动画 transform 会让 fixed 失效）。
- Avatar：有 `avatar`(url) 显示 img（`object-fit:cover; width/height 100%; display:block`），无则首字母圆标；容器 `.av` grid 内 img 需 `min-width:0` 防被裁。
- 资料库卡片：无 T:CT 比分（已删），日期+语音 Tag 在 date-row（语音 Tag 已从 mid 行移入）；统计行（时长/回合/大小/选手）不动。
- 新增任何界面文案：i18n zh.ts + en.ts 同步加 key。

## 5. 常见任务清单（照着做）

- **改 UI**：改 tsx/css → typecheck → 杀旧实例 → build → Start-Process exe → 让用户验收。
- **改解析**：parser.ts + PARSER_VERSION+1 → 用 verify 脚本对用户 demo 验证 → typecheck/build。
- **改转写**：asr.ts / library.ts / TranscriptPage → typecheck → 真机由用户跑（注意 WAV 缓存命中）。
- **改 HUD**：assets/panorama 源 → build-panorama.mjs → make-zip → 用户开应用播放验证（CS2 内按 `~` 看 Panorama 报错 `[DshVoiceHud] ...`）。
- **发布**：确认 typecheck/build → make-zip → git commit（中文 message）→ push（代理需在线）→ README 版本号/截图可选更新。
- **验证脚本入库**：一次性诊断脚本用后可留（回归工具惯例）或删，参考 scripts/ 现有命名。

## 6. 状态与开放问题（写文档时刻快照）

- 最近交付：`4ac8296 feat(parser+asr): 手枪局保留、转写链路优化、demo not found 修复`（已 push origin/main）。此后工作区新增改动：卡片布局改版/转写页 navSeq 联动/聊天头像（本轮十四补4，**未提交**）+ 本 AGENTS.md。
- 开放问题：① 游戏内 HUD 头像左裁（待截图）；② winner 推导 vs 实体比分偏差；③ README 截图与最新 UI 有出入（apple-* 是老风格）；④ `scripts/hud/dsh_voice.css` 是旧版残留（未引用，可删）。
- 每次开工：读 progress.md 顶部最新几轮 → 核对 git status 未提交内容 → 再动手。
