# 开发文档

## 架构总览（一套代码，三种形态）

```
src/
├── renderer/            # UI（React 19 + TS + HUD 设计系统）
│   ├── src/             # 主应用（资料库/详情/转写/实况/设置）
│   ├── overlay.html     # 游戏内悬浮层（独立轻量入口）
│   └── overlay-src/     # 悬浮层逻辑（原生 DOM，无 React）
├── web/                 # Web 版环境无关逻辑
│   ├── parseDemo.ts     # 浏览器端 demo 解析（deadem + Web Streams）
│   └── decodeVoice.ts   # 浏览器端语音解码（WASM opus）
├── main/                # Electron 主进程
│   ├── index.ts         # 窗口/IPC/生命周期
│   ├── overlay.ts       # 悬浮层窗口管理 + demo 演示播放器
│   └── services/
│       ├── parser.ts    # Node 端 demo 解析（deadem）
│       ├── library.ts   # 资料库扫描/缓存/解析队列
│       ├── live.ts      # 实况：CS2 进程检测/VConsole 注入/GSI/启动器
│       ├── vconsole.ts  # VConsole2 协议客户端 + Mock 服务端
│       ├── asr.ts       # 语音提取(csgove)/VAD/本地+云端转写编排
│       ├── engines.ts   # 侧车下载管理（csgove/whisper/ggml 模型，含镜像回退）
│       ├── download.ts  # https 下载（重定向/进度/镜像）
│       ├── settings.ts  # 设置持久化
│       └── mock.ts      # 桌面版 mock 数据（开发预览）
└── shared/              # 三端共享类型（IPC 契约/数据模型）
```

## 形态与构建

| 形态 | 命令 | 产物 |
| --- | --- | --- |
| Web 版 | `npm run web:dev` / `npm run web:build` | 浏览器 / `web-dist/` |
| 桌面版 | `npm run dev` / `npm run build` | Electron / `out/` |
| 绿色 zip | `npm run dist:zip` | `dist/*.zip`（解压即用） |

Web 版与桌面版共享 renderer；`installWebApiIfNeeded()`（renderer/src/webmock.ts）在无 Electron 时注入 mock api，使 UI 可在纯浏览器开发（HMR 秒级）。

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
- 浏览器解码（Web 版，实验）：vendored `wasm-audio-decoders`（decodeFrames）——**已知问题：输出接近静音**，待换 @mohayonao/opus-decoder 或 Ogg 容器方案（见 findings.md §12）。

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
| `scripts/web-preview-main.js` | Electron 壳加载 Web 版并截图/执行测试（`--url` 须为最后一个参数） |
| `scripts/serve.mjs` | 静态服务（web-dist + test-data/demos） |
| `scripts/parse-test.mjs` | Node 端解析验证 |
| `scripts/dump-*.mjs` | demo 事件/语音消息调试 |
| `--screenshot` / `--route` / `--transcribe` / `--overlay-demo` | 主进程开发模式 |

## 发布

1. `npm run web:build` → 部署 `web-dist/` 到 GitHub Pages / 任意静态托管。
2. `npm run dist:zip` → 发布 `dist/CS2-Demo-Analyst-<ver>-win64-portable.zip`（绿色便携，秒级打包）。
3. 更新 README 截图与版本号；侧车（csgove/whisper/模型）按需运行时下载，不入包。

## 已知问题与路线

- Web 版浏览器内语音解码输出异常（见 findings.md §12）。
- Web 版实况注入依赖本地桥（live.ts 抽为 HTTP/WS 服务，Phase B）。
- Overlay 悬浮层在 Web 版以 HUD 预览替代，真实 Overlay 在桌面版。
- MM demo 无语音、CS2 更新可能破坏解析适配。
