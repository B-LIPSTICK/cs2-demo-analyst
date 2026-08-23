# findings.md — 研究与技术结论

> 本文件记录所有研究结论、外部接口事实与设计决策。实现时以本文件为准。

## 1. 参考项目 Swift DemoUI Pro（仅作灵感，不抄代码）

- 仓库: nicedayzhu/SwiftDemoUIPro（C++, MIT, 34 stars），官网 https://nicedayzhu.github.io/SwiftDemoUIPro/
- 定位: "Voice controls for CS2 demo playback" — Windows 启动器打开 .dem/.zip/.dem.zst，带 `-insecure` 启动 CS2，临时注入 Panorama DemoUI VPK（修改 gameinfo.gi + 会话 VPK），面板提供录制语音控制（64 槽位/单玩家/全队）、说话玩家头像 HUD、POV 切换、回合跳转。
- **其痛点（我们要差异化）**: 工具自己"拿到 demo 再播放"（启动器主导）；需临时改游戏文件；无文字转写；无分析（只有播放控制）。
- **我们的差异化**（用户明确要求）:
  1. 用户给本地 demo 路径 / 工具检测运行中的 cs2.exe → 挂接（attach）而非替换播放器；"外部启动"模式参考 CS Demo Manager（akiver/cs-demo-manager）。
  2. 自动分析本地文件"有没有语音" → 库卡片语音徽标。
  3. 语音提取 + 快速转写（本地 Whisper / 云端 API 一键配置）→ 带时间戳文字转写，点击跳转。
  4. 注入 console 指令: demo_gototick 跳转回合/击杀/语音时刻、暂停/倍速、POV 切换。
  5. 原生 CS2 观战 HUD 风格的高级 UI + Overlay 模式。

## 2. 技术栈决策（用户诉求: 好打包、包小、好用、不易出问题、不卡死）

- **Electron + electron-builder（NSIS + portable）**。理由: 本机无 MSVC/VS（Rust/Tauri 需编译链），Node 24 可直接跑；解析全用纯 JS 库（零原生模块、零 node-gyp），构建与用户安装都不需要 C++ 工具链 → 最不易出问题。
- 解析: **@deademx/cs2 + @deademx/engine**（纯 JS, protobufjs + snappyjs, 浏览器/Node 均可用）。备选 demoparser2 WASM（后续增强）。deadem 性能: 30min demo 全解析 ~1.6-4.8s。
- 语音提取: **csgove（akiver/csgo-voice-extractor）v3.1.6 sidecar**，win32-x64.zip 仅 2.9MB（GitHub Releases 下载，可按需下载缓存）。
- 转写: **whisper.cpp whisper-cli.exe**（v1.9.2, CPU 版 7.8MB; 可选 cublas GPU 版）+ ggml 模型按需下载（HuggingFace）; 云端走 OpenAI 兼容 /v1/audio/transcriptions（默认 Groq whisper-large-v3-turbo，免费、秒级）→ 一键配置（填 Key / 自定义 baseURL）。
- 前端: React 18 + TS + Vite; 字体 @fontsource（Chakra Petch + Noto Sans SC 本地打包，无运行时联网）; 零 UI 库，自研 HUD 设计系统。
- 注意: CS2 demo tickrate = 64/s; 时间→tick: round(t*64)。

## 3. 语音检测（纯 JS）

- deadem MessagePacketType 枚举含 `SVC_VOICE_INIT`(46) / `SVC_VOICE_DATA`(47)。
- 检测方案: 用 Parser + messagePacketTypes 过滤器只留 SVC_VOICE_DATA（+必要启动包），统计消息数 → hasVoice。
- 事实（csgove README 警告）: **Valve 天梯（MM）demo 不含语音数据**；FACEIT/第三方 demo 通常含语音。UI 需如实提示。

## 4. VConsole2 协议（自研 TS 客户端，接口事实）

- 前提: CS2 需以 `-tools` 启动（免费 Workshop Tools DLC）→ VConsole 监听 127.0.0.1:29000（CS2RemoteConsole 同款机制）。
- 发送命令帧: `"CMND"` + `00 D2 00 00`(版本) + int16 BE `(len(cmd)+13)` + `00 00`(handle) + cmd 字节 + `00`(结尾)。
- 接收帧: 4 字节类型（ASCII: PRNT/CHAN/CVAR/AINF/ADON/CFGV）+ int32 BE 版本 + int16 BE 长度 + int16 BE handle + payload。
- PRNT payload: int32 BE channelID + 24 字节未知 + 消息文本（控制台输出行）; CHAN 定义 id→名称/RGBA 映射，需先缓存再解析 PRNT。
- 用法: 发 `demo_gototick N`/`demo_pause`/`demo_resume`/`demo_togglepause`/`demo_timescale X`/`spec_goto <userid>`/`spec_next`/`spec_prev`/`spec_mode N`/`demo_info`/`status`; 读 PRNT 输出。
- 需验证: 连接后是否需要握手/是否立即收包（python 版直连即收; 实现时兼容观察）。
- CS2 支持 `demo_gototick`（csgo-nade.com 已确认语法 `demo_gototick [Tick]`，支持 `20min` 形式）。

## 5. GSI（读取当前播放状态）

- CS2 官方 Game State Integration: 在 `<cs2>/game/csgo/cfg/` 放 `gamestate_integration_demoanalyst.cfg`（我方自写 cfg，指向 127.0.0.1:30070），游戏内状态变更即 POST JSON 到该端口。
- 本工具 main 进程起本地 HTTP server 接收 → 解析 map/round/phase/score/player/bomb。
- 限制: GSI 不给 demo tick; 以"当前回合"对齐; 若 GSI 在 demo 播放时不可用，退化为 VConsole 输出解析（status/demo_info）+ 手动同步。
- cfg 在游戏启动时加载: 若已运行需重启 CS2 才生效 → 启动器模式自动处理。

## 6. 启动/注入双模式

- **Mode A 挂接（attach）**: 检测到 cs2.exe 已运行 → 尝试连 VConsole 29000 → 成功即 LIVE（可注入+读控制台）。未以 -tools 启动则提示一键重启。
- **Mode B 外部启动**: 检测 CS2 安装（Steam 注册表 + steamapps 扫描）→ `steam://run/730//-tools` 或直接启动 cs2.exe 带 `-tools +playdemo "<path>"`（工具已知 demo 路径, 即用户诉求"给本地路径外部启动"）→ 连 VConsole。
- 一键以分析师模式重启: 关掉现有 cs2 → 以 -tools 重新启动（一次性; 之后每次都可挂接）。
- 进程检测: `tasklist /FI "IMAGENAME eq cs2.exe"` 轮询（无需原生模块）。

## 7. 转写流水线

1. 库卡片 → 「提取语音」: csgove `-mode split-full -output <cache>`（每玩家一轨、保留静音位 → 时间轴对齐 demo 时钟）; `-steam-ids` 可只提取指定玩家。
2. ASR（可选手动/队列）: 本地 whisper-cli `-m model -f wav -l auto/zh -oj -of json` → segments[{start,end,text}]; 云端 POST file → 同结构。
3. tick = round(segment_time * 64); 关联到回合（由 round_start tick 表反查）与玩家（按轨道）。
4. 转写存储: userData/library/<demohash>/transcript.json（增量保存, 原子写）。
5. 文字聊天（deadem 105 例: ALL/CT/T/DEAD/SPEC）也入库，转写面板同屏展示（更有"分析师"感）。

## 8. 数据/存储

- 用户数据目录: app.getPath('userData') 下: settings.json、library/index.json、library/<demohash>/{meta.json, events.json, transcript.json}。
- demohash: 文件路径+size+mtime 的 hash 作缓存键; 文件变更自动重解析。
- 库扫描: chokidar 监视用户添加的目录（默认提示 CS2 官方 demo 目录: `<Steam>\userdata\<id>\730\remote\csgo\demos` 及其它库）。
- 全部 JSON 原子写（tmp+rename）; 大事件表按需懒加载。

## 9. 打包

- electron-builder: win x64, NSIS（installer）+ portable 单文件; asar; 图标自绘（resources/icon.ico 生成）; 不签名（README 注明 SmartScreen）。
- sidecar 不内置大件: csgove（2.9MB）与 whisper 模型按需下载（首次使用提示 + 进度条），whisper-cli.exe 7.8MB 可选内置或按需。→ 安装包目标 < 120MB（Electron 运行时为主），后续可上 electron-updater。

## 10. 已知风险/待验证

- [ ] VConsole 连接后是否需要握手（首次实现时用真实 CS2 验证; 本机无 CS2 → 提供 mock 模式便于开发验证）。
- [ ] GSI 在 demo 播放期间是否持续推送（若否 → 退化为控制台解析 + 手动同步）。
- [ ] demo_gototick 在最新 CS2 的行为（社区确认可用; 实现时留倍速/暂停降级路径）。
- [ ] csgove Windows 是否依赖额外 DLL（README 提到默认期望 dll 同目录; win32-x64.zip 2.9MB 应已含）。
- [ ] deadem 对 `-tools` 无关, 纯文件解析, 无风险。
- [ ] whisper.cpp 中文准确率: 默认推荐 small/medium 多语言模型; 云端 Groq 兜底。

## 12. Web 版语音解码（浏览器内）

- **已闭环（Electron/Node 侧）**: csgove 提取 → normalizeWav 取 int32 高 16 位（根因：csgove 写满幅 int32 PCM，语音在高 16 位；取低 16 位得到量化噪声）→ VAD 裁剪 → whisper 转写。实测 55 段清晰中文。
- **浏览器内方案（ffmpeg.wasm 为主，已落地）**:
  - parseDemoWeb 收集 SVC_VOICE_DATA → voiceData 为 **Uint8Array**（protobuf bytes，非 base64 字符串；已转 base64 存储）→ 分组/切段 → 帧序列 → Ogg Opus muxer → ffmpeg.wasm 解码出 WAV。
  - ffmpeg core 从 `/ffmpeg/ffmpeg-core.js|wasm` 静态加载（renderer public 目录，web-dist 同步拷贝）；页面配 COOP/COEP 头（SharedArrayBuffer 需要）。
  - **Electron 壳内 ffmpeg.wasm 虚拟 FS 受限**（FS error）→ 桌面版语音走 csgove+whisper 链路，不走 ffmpeg。
  - 回退路径：wasm-audio-decoders（早期 decodeFrames 输出接近静音的方案保留为兜底）。
  - 待验证：GitHub Pages 等真实部署环境（Chrome）下的 ffmpeg.wasm 加载与 COOP/COEP。

## 13. 架构演进（最终：桌面版单形态）

- ~~Web 版~~：已按用户要求整体移除（src/web、webmock、ffmpeg.wasm、web 脚本、web-dist），代码库只保留 Electron 桌面形态；renderer 包 1.86MB → 674KB，zip 146.8MB。
- Electron 版：主形态（绿色 zip 分发），Overlay/注入/桌面能力。
- 主题：苹果风 v4（SF 系统字体/毛玻璃/iOS 蓝/macOS 红绿灯）+ 深色/浅色双主题（CSS 变量 `:root[data-theme='light']` 覆盖）+ Mineradio 式氛围光斑。
- 全屏面板性能：去 backdrop-filter blur（全屏模糊 GPU 开销是卡死主因）；tickSim 改按真实时间推进（Date.now delta），帧率 60→20fps；窗口 focusable:false 不抢焦点。

## 14. 语音转写引擎选择（用户要求快+免费+一键配置）

- 默认推荐云端 Groq whisper-large-v3-turbo（免费档，秒级，设置页一键引导 Key）。
- 本地 whisper.cpp（base/small/medium）作为离线备选，已接 VAD 静音裁剪提速。
- csgove 侧车 DLL 需从引擎目录 cwd 运行（已处理）。

## 16. 普通模式 +playdemo 启动参数（2026-08-26 真机验证 + 逆向参考项目）

- **真机结论（本机 CS2）**: `cs2.exe -novid +playdemo dsh-vfy.dem`（裸文件名、无 -insecure）→ **停在主菜单**，进程存活（启动成功但命令没生效）；`+con_logfile dsh_vfy.log` 同时被忽略（全盘无日志文件、convars 无痕迹）→ 该 CS2 版本命令行 `+命令` 不可靠（与此前 tools 模式观察一致，当时因此改走 VConsole 注入）。
- **cs-demo-manager 源码逆向**（start-counter-strike.ts）: 真实参数 = `-insecure -novid +playdemo "<完整路径>"`（exec shell 形式，路径带引号）。**-insecure 是疑似关键**（secure 模式限制非白名单文件访问）；完整路径 + 引号可规避引擎对命令字符串的空格重解析。
- **CS2 普通模式无任何官方远程控制通道**: VDM 文件不支持；-netconport/VConsole 仅 -tools（cs-dm 文档确认，这也是他们改用插件的原因）。GSI 只读不写。
- **cs-demo-manager 的 CS2 控制方案（参考，不采用）**: 自研 DLL 插件 —— 复制 server.dll 到 game\csgo\csdm\bin + gameinfo.gi SearchPaths 加 `Game csgo/csdm` + 启动带 `-insecure`；插件连 WebSocket 服务器，读 demo 旁的 `<name>.dem.json` action 文件（`{tick, cmd}`，如 demo_gototick 123）执行；退出/崩溃时恢复 gameinfo.gi 并删二进制。SwiftDemoUIPro 同类（VPK 注入）。
- **播放前提**: demo 路径必须全 Basic Latin 字符（cs-dm issue #992；中文路径会失败 → 需先复制到拉丁路径，如 game/csgo/）。
- **待验证**: 变体矩阵 v1..v5（见 progress.md 本轮八）确定本机 CS2 可接受的启动参数形式。★v1..v5 全部失败（停在主菜单，+con_logfile 始终未生成）→ 该 CS2 版本无 -console 时命令行 +命令不执行。

## 17. 5E 对战平台播放链路逆向（2026-08-26，决定性）

- **来源**: 5E 客户端（Electron）D:\61-5EClient\resources\app.asar; 混淆模块用 Node VM 执行 + 解码器调用解出全部字符串（scripts/asar-decrypt.mjs）。
- **5E 真实播放参数**（forcePlayDemo，playDemo 模块）:
  ```
  spawn(cs2.exe, ["-console", "+demoui", "+playdemo", "<demo完整路径>", "-insecure", <用户附加参数>], {detached:true})
  ```
  - demo 路径 = `D:\5EDemocache\<name>.dem`（drive root 无空格; 路径须全 Basic Latin 无空格）;
  - 启动前检查 CS2 未运行（单实例）; getLauncherType() 拒绝类型 0;
  - 渲染进程拼串 → IPC `send_cs2_command`（csgoAddon 业务模块）→ 主进程 v2/module/cs2/index.js `run(args)` spawn;
  - v2/module/steam/index.js 另有 `steam.run(args)=spawn(steam.exe, args)`（-applaunch 730 备用路径）。
- **待测（v6）**: 5E 原样 `-console +demoui +playdemo <无空格路径> -insecure` 在本机是否成功; 若成功 → 本应用普通模式播放参数即定为此形式（demo 先复制到无空格 Latin 路径，如 D:\5EDemocache）。
- **★v6/v7 真机验证成功（2026-08-26）**: 该参数形式秒播、无闪退（cs2.exe 直启与 steam.exe -applaunch 730 均可）。**本应用已实施**: 普通模式 = `cs2.exe -console +demoui +playdemo <盘根\dsh-demo\暂存路径> -insecure`（暂存目录用盘根无空格路径，见 live.ts stageDemoForPlayNoSpace）; 详情页/设置页改普通模式默认，overlay 入口已移除（主进程代码保留）。
- 播放结束退主菜单时 CS2 可能弹「解析消息失败」（demo 消息兼容性提示，不影响播放）。

## 18. 完美平台播放机制与「视角卡死」根因（2026-08-26，决定性）

- **抓真实命令行**（scripts/capture-cs2-cmdline.mjs）: 完美平台启动 CS2 的参数 =
  `cs2.exe +exec pwa.cfg +exec pwa_userconfig<steamid>.cfg -pwa -condebug +tv_listen_voice_indices -1 +cl_demo_predict 0 -consolelog pwa_<steamid>_<date>.log -consolelog_append -worldwide -exec autoexec`
  —— **没有 +playdemo！**
- **pwa.cfg 内容**（game/csgo/cfg/pwa.cfg，每次播放覆盖写）: `playdemo "D:\csgodemocache\<demo>.dem"`（demo 放盘根无空格目录）。
- **★根因**: `+playdemo` 作为**启动参数**在引擎早期被静默丢弃（demo 系统未就绪）→ 播放器半初始化 → **时间在走但导播镜头不动（视角卡死）**；`+exec <cfg>` 在引擎就绪后执行 cfg 内命令 → playdemo 正常。5E 的 `-console +demoui +playdemo` 形式能播放但同样有视角问题（真机确认）。
- **★★视角卡死真正根因（2026-08-23 单变量验证）**: CS2 demo 播放预测 **cl_demo_predict（默认 1）干扰导播镜头** → 时间走但镜头不动；**`+cl_demo_predict 0`** 关闭预测后导播正常。同一 demo 完美平台正常（其参数含 `+cl_demo_predict 0`）、我们卡死（缺该参数）。**+playdemo 早期丢弃只是"能播但半初始化"的一层问题，cl_demo_predict 才是镜头问题主因。**
- **★最终方案（应用已实施）**: 普通模式 = 写 `game/csgo/cfg/dsh-play.cfg`（`playdemo "<盘根 dsh-demo 暂存路径>"`）→ `spawn(cs2.exe, ['+exec','dsh-play.cfg','+cl_demo_predict','0','-novid',...])`; CS2 退出后删 cfg。不需要 -console/+demoui/-insecure。
- **附带**: CS2 控制台日志参数 = `-consolelog <file>`（写到 game/csgo/），`con_logfile` cvar 在 CS2 无效; 完美平台每个 steamid/天一个 pwa_*.log 保留在 game/csgo/。

## 15. 打包（离线可行，包体压缩）

- **网络依赖**：electron-builder 默认要下载 electron zip（GitHub 直连在无代理环境 ETIMEDOUT）。解法：`electron-builder.yml` 配 `electronDist: node_modules/electron/dist`（本地 npm 安装的 dist 直接复用），winCodeSign/signtool 用本地缓存 → 离线可打包。
- **包体**：运行时只需 main 进程依赖 → React/ReactDOM/ffmpeg/字体/@eshaz 全部移到 devDependencies（Vite 构建期打包进 out/renderer），asar 只留 @deademx/chokidar/adm-zip(+传递依赖)；`electronLanguages: [en-US, zh-CN]` 裁语言包。实测 portable zip 200MB → 159MB。
- **PS5.1 坑**：`Add-Type System.IO.Compression.FileSystem` 在 Windows PowerShell 5.1 下加载失败 → make-zip.ps1 改用 `Compress-Archive`（复制到临时目录保证 zip 根为 `CS2-Demo-Analyst/`）。
- NSIS 安装器未配置为目标（分发以绿色 zip 为主，目标 <120MB 仍需继续裁：可考虑关 ffmpeg 桌面端依赖、换 small 字体子集）。
