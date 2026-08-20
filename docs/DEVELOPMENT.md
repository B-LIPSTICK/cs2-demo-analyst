# 开发文档

## 架构总览（桌面版单形态）

```
src/
├── renderer/            # UI（React 19 + TS + 苹果风设计系统）
│   ├── src/             # 主应用（资料库/详情/转写/实况/设置）
│   ├── overlay.html     # 游戏内悬浮层（独立轻量入口，纯语音 HUD）
│   └── overlay-src/     # 悬浮层逻辑（原生 DOM，无 React）
├── main/                # Electron 主进程
│   ├── index.ts         # 窗口/IPC/生命周期/开发模式（--vcon-mock/--screenshot/--eval-js）
│   ├── overlay.ts       # 悬浮层窗口管理 + demo 演示播放器（按真实时间推进）
│   └── services/
│       ├── parser.ts    # Node 端 demo 解析（deadem）
│       ├── library.ts   # 资料库扫描/缓存/解析队列
│       ├── live.ts      # 实况：CS2 进程检测/VConsole 注入/GSI/三层启动器
│       ├── vconsole.ts  # VConsole2 协议客户端 + Mock 服务端
│       ├── asr.ts       # 语音提取(csgove)/VAD/本地+云端转写编排
│       ├── engines.ts   # 侧车下载管理（csgove/whisper/ggml 模型，含镜像回退）
│       ├── download.ts  # https 下载（重定向/进度/镜像）
│       ├── settings.ts  # 设置持久化
│       └── mock.ts      # 桌面版 mock 数据（开发预览）
└── shared/              # 类型（IPC 契约/数据模型）
```

## 形态与构建

| 形态 | 命令 | 产物 |
| --- | --- | --- |
| 桌面版 | `npm run dev` / `npm run build` | Electron / `out/` |
| 绿色 zip | `npm run dist:zip` | `dist/*.zip`（解压即用，离线打包） |

## 关键协议与适配

### CS2 demo 解析（deadem）
- 事件适配（CS2 1.41 实测）：回合边界用 `round_prestart` / `round_officially_ended`（同 tick）；胜负由炸弹事件 + 回合最后一杀推导；预热回合用 `begin_new_match` / `round_announce_match_start` 过滤。
- 权威比分/队名：`CCSTeam` 实体（`m_iTeamNum` 2=T 3=CT，`m_iScore`，`m_szTeamname`）。
- 阵营：`player_team` 事件（userid → team）。
- 地图名：`svc_ServerInfo.mapName`。
- 语音检测：`SVC_VOICE_DATA` 消息计数（字段 `audio.voiceData` 为 **Uint8Array**，转 base64 存储）。

### 语音提取与转写
- 提取：csgove sidecar（`-mode split-full`，每玩家全时长 WAV，时间轴对齐）。
- **csgove 输出为满幅 int32 PCM（语音在高 16 位）**，`normalizeWav` 取 `v >> 16` 转 16-bit；取低 16 位会得到量化噪声（曾导致 whisper"广播幻觉"）。
- VAD：能量门限切段 + 紧凑 WAV + 时间偏移映射（本地 CPU 提速 5-10 倍）。
- 本地引擎：whisper-cli `-l auto -oj`；云端：OpenAI 兼容 `POST /audio/transcriptions`（Groq verbose_json）。
- 语音解码统一走 csgove+whisper 链路（桌面版）；曾探索的浏览器内 ffmpeg.wasm 方案随 Web 版移除（见 findings.md §12）。

### VConsole2（实况注入）
- 发送：`"CMND"` + `00 D2 00 00` + int16BE(len+13) + `00 00` + cmd + `\0`。
- 接收：4B 类型（PRNT/CHAN/CVAR/…）+ int32BE 版本 + int16BE 长度 + int16BE handle + payload；PRNT 含 channelID + 文本。
- 前提：CS2 以 `-tools` 启动（免费 Workshop Tools DLC）→ 监听 127.0.0.1:29000。
- 注入指令：`demo_gototick N` / `demo_pause` / `demo_resume` / `demo_timescale X` / `spec_next` / `spec_prev` / `spec_goto`。
- `--vcon-mock` 开发模式：内置 mock 服务端模拟控制台（无 CS2 环境验证注入链路）。

### GSI（状态读取）
- 自动写入 `gamestate_integration_demoanalyst.cfg`（官方功能）→ CS2 POST 到 127.0.0.1:30070 → 解析 map/round/score/bomb/存活。

## 开发辅助

| 工具 | 用途 |
| --- | --- |
| `scripts/serve.mjs` | 静态服务（test-data/demos 本地预览） |
| `scripts/parse-test.mjs` | Node 端解析验证 |
| `scripts/dump-*.mjs` | demo 事件/语音消息调试 |
| `--screenshot` / `--route` / `--transcribe` / `--overlay-demo` / `--fullpanel-demo` | 主进程开发模式 |
| `--eval-js=<code>` | 截图前在渲染进程执行 JS（自动化交互回归） |
| `--vcon-mock` | 模拟 VConsole 控制台，无 CS2 环境验证注入链路 |

## 发布

1. `npm run dist:zip` → 发布 `dist/CS2-Demo-Analyst-<ver>-win64-portable.zip`（绿色便携，解压即用）。
   - 离线打包：`electron-builder.yml` 已配 `electronDist: node_modules/electron/dist` + `electronLanguages: [en-US, zh-CN]`，不依赖 GitHub 下载。
   - 运行时依赖只保留 main 进程所需（deadem/chokidar/adm-zip），构建期依赖全部在 devDependencies，包体显著更小。
2. 更新 README 截图与版本号；侧车（csgove/whisper/模型）按需运行时下载，不入包。

## 已知问题与路线

- 悬浮层/全屏面板需 CS2 使用「无边框窗口模式」才能叠加显示（独占全屏下 Windows 不渲染任何置顶窗）。
- 实机 VConsole 握手与 GSI 在 demo 播放期间的推送行为待真实 -tools 环境验证。
- MM demo 无语音、CS2 更新可能破坏解析适配。
