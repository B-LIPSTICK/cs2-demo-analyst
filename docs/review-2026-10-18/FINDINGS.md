# 问题详单（Findings）

> 级别按实际后果判断：P1 = 核心任务/数据一致性/支持范围内严重受阻；P2 = 非核心错误或明显体验/维护风险；P3 = 局部细节。
> 置信度：confirmed = 代码/截图/交互已确认；probable = 静态证据强但未在真实环境复现。

---

## F-01 HUD 覆盖 XML 与当前 CS2 Demo UI 脚本不匹配

- **定位**：`assets/panorama/layout/hud/huddemocontroller.xml`；`assets/panorama/scripts/hud/dsh_voice.js`；`src/main/services/injector.ts`
- **级别/置信度**：P1 / probable（静态不匹配 confirmed）
- **前提**：CS2 构建 25966348（2026-10-16 更新）；使用 voiceHud 注入模式
- **证据**：
  - 项目 XML 最后修改 2026-08-24。
  - 当前 `pak01_dir.vpk` 中 `panorama/scripts/hud/huddemocontroller.vts_c` 引用 `PlayerList` 22 次、`RoundMenu` 16 次、`Camera` 10 次、`Death` 4 次、`message_arrow` 1 次。
  - 项目 XML 中这些 ID 全部缺失；`Camera`/`Speed` 仅作为图片路径或 `SpeedControls` 出现。
  - 当前 Valve 还有独立的 `huddemoplayback.vxml_c`，项目未覆盖。
- **实际**：静态结构已漂移；游戏内可能出现 Panorama 报错、原生 Demo UI 控件缺失或 HUD 不显示。
- **预期**：覆盖 XML 应保留当前 Valve 脚本引用的全部面板 ID，只追加本项目节点。
- **影响**：HUD 是项目差异化核心功能；一旦失效，用户会认为“更新后 HUD 坏了”。
- **修复方向**：从当前 `huddemocontroller.vxml_c` 重建 XML；加启动自检（缺失 ID 写日志）；真机验证。
- **复验**：CS2 控制台无 `[DshVoiceHud]` 错误；原生播放/暂停/回合/相机控件可用；语音 HUD 正常出现。

---

## F-02 `cleanAll` 删除范围过大，且暂存 demo 无限增长

- **定位**：`src/main/services/injector.ts:181-193`；`src/main/services/live.ts:313-340,450,527`；`live.ts:237-280`
- **级别/置信度**：P1 / confirmed（控制流）
- **证据**：
  - `cleanAll` 对整个 `game/csgo/overrides` 执行 `fs.rm(..., { recursive: true, force: true })`。
  - 有备份时直接用 `gameinfo.gi.dsh_inject.bak` 覆盖当前文件；CS2 更新后备份可能是旧版本。
  - 删除 `game/_toolsettings`、`tools_thumbnail_cache.sqlite3`、`steam_appid.txt`。
  - `scheduleSessionCleanup` 在 CS2 退出后自动调用 `cleanAll`；原生启动前也调用。
  - 实测 `D:\dsh-demo` 120 个文件、12.29 GB（2026-09-14 至 2026-10-18）；`game/csgo/dsh-612e77189f.dem` 87,767,556 字节。
- **实际**：可能删除其他 HUD/工具的 override；可能把官方 gameinfo 回滚到旧版；暂存 demo 从不清理。
- **预期**：只清理本项目创建的文件；不覆盖官方文件；暂存文件可追踪、可回收。
- **影响**：数据丢失/游戏文件异常/磁盘占用持续增长。
- **修复方向**：只删 `dsh_voice_override.vpk`、`dsh_voice_session.vpk`；gameinfo 只移除自己的两行；不碰工具缓存；暂存 demo 用清单 + 启动/退出清理。
- **复验**：放入一个第三方 `.vpk` 到 `overrides`，执行还原后它仍存在；`D:\dsh-demo` 清理后为空或只保留最近 N 个；gameinfo 只少本项目两行。

---

## F-03 索引损坏/根目录离线会误删资料库条目与转写缓存

- **定位**：`src/main/services/library.ts:637-695,662-668`
- **级别/置信度**：P1 / confirmed（控制流）
- **证据**：
  - `index.json` 读取失败 → `store.index = {}`。
  - 随后孤儿清理遍历 `library/*.json`，`store.index[cid]` 不存在就 `fs.unlink`。
  - 每个 index 条目 `fs.stat(meta.path)` 失败 → `delete store.index[id]`。
  - 下一次启动，孤儿清理会删除这些条目的 detail JSON（含转写）。
- **实际**：索引损坏或外部盘/网络盘暂时离线时，条目和转写结果会被删除。
- **预期**：不可达的 demo 应标记 `missing`，而不是删除；索引损坏应进入恢复模式。
- **影响**：用户丢失资料库列表和已完成的语音转写（demo 文件本身还在）。
- **修复方向**：索引加载成功标志；失败时不孤儿清理；根目录不可达只标记；删除前备份；提供恢复入口。
- **复验**：手动破坏 `index.json` 后启动，detail JSON 仍在；拔掉外部盘后启动，条目显示 missing；恢复盘后重新扫描可恢复。

---

## F-04 设置页每次按键写盘，主进程无写队列

- **定位**：`src/renderer/src/pages/SettingsPage.tsx:464-474,931-938,1008-1014,1040-1046`；`src/main/services/settings.ts:53-60`；`src/main/index.ts:81-95`
- **级别/置信度**：P1 / confirmed（控制流）
- **证据**：
  - `set()` 同步 `save(patch)`，不 await/catch。
  - API Key、安装路径、启动参数等文本 `onChange` 直接触发。
  - `updateSettings` 读 cache → merge → 写同一个 `.tmp` → rename，没有 mutex。
  - 每个 patch 都广播 `settings:changed`。
- **实际**：快速输入可能产生乱序写入；旧响应可能覆盖新 draft；写入失败无提示；`.tmp` 可能互相覆盖。
- **预期**：文本输入防抖/失焦保存；主进程串行写；失败可见。
- **影响**：API Key、库目录、CS2 路径等设置可能丢失或回退。
- **修复方向**：设置页本地 draft + 300ms 防抖；主进程 promise 队列；错误 toast；只广播最终状态。
- **复验**：连续输入 50 个字符只产生一次最终写入；模拟写失败有 toast；外部改主题后设置页同步。

---

## F-05 最小窗口宽度下工具栏溢出、语音文本竖排

- **定位**：`src/renderer/src/theme/hud.css:3378-3383,3393-3422,3424-3435`；`src/main/index.ts:32`
- **级别/置信度**：P1 / confirmed（截图 + computed style）
- **证据**：
  - `minWidth: 1080`。
  - `.demo-bottom-grid` 只在 800px 堆叠；`.page-head` 只在 820px 换行。
  - 1082px 时 `.tline` computed `grid-template-columns: 78px 124px 13px 32px 32px`，文本列 13px。
  - `library-narrow.png` 工具栏右侧“选择”被裁切，出现横向滚动条。
- **实际**：语音文本逐字竖排；工具栏不可完整操作。
- **预期**：支持的最小宽度下仍可读、可操作。
- **影响**：核心阅读/筛选任务受阻。
- **修复方向**：断点提高到 1200–1280；`minmax(0,1fr)`；窄宽度语音行改两行；工具栏换行。
- **复验**：1080/1200/1440 三档无横向滚动；语音文本每行至少 8 个中文字符。

---

## F-06 槽位缺失时回退列表下标，可能静音错人

- **定位**：`src/main/services/parser.ts:1286-1291`；`src/renderer/src/pages/DemoDetailPage.tsx:43-52`
- **级别/置信度**：P2 / confirmed（代码）
- **证据**：最终 slot 回退链包含 `(s.userid >= 1 && s.userid <= 64 ? s.userid - 1 : idx)`；`idx` 是排序后的玩家下标（0–9），不是实体槽位。`computeVoiceMask` 只要 `typeof p.slot === 'number'` 就会用它。
- **实际**：槽位未知时可能静音错误的底层 slot。
- **预期**：槽位未知应保持 undefined，禁用/警告，不发送掩码。
- **影响**：用户以为静音了 A，实际静音了 B。
- **修复方向**：去掉 idx 回退；UI 对无 slot 的选手显示“槽位未知，无法自动闭麦”；可用语音索引/实体采样补全。
- **复验**：构造缺 slot 的选手，闭麦按钮不发送错误掩码；日志/提示明确。

---

## F-07 pending demo 的 AI/转写会空等 180 秒

- **定位**：`src/main/services/library.ts:821-832`
- **级别/置信度**：P2 / confirmed（代码）
- **证据**：`waitDetail` 只在 `meta.status === 'ready'` 且 detail 缺失时调用 `parse`；`pending` 不会入队，只轮询。
- **实际**：新扫描但未解析的 demo，从 AI/转写入口触发时会等 180 秒后返回 null。
- **预期**：pending 应自动触发一次解析，或立即返回“请先解析”。
- **影响**：用户以为卡死；AI/转写核心入口不可用。
- **修复方向**：pending 时 `await this.parse(id)`；加进度提示；超时缩短/可取消。
- **复验**：新加入 demo 直接点转写，进度从解析开始，而不是空等。

---

## F-08 AI 会话切换/流式事件串台；IPC 异常会卡住

- **定位**：`src/renderer/src/pages/AiPage.tsx:190-246,292-324`
- **级别/置信度**：P2 / confirmed（代码）
- **证据**：
  - 事件只按 `demoId` 过滤，不带 chatId。
  - `finish` 使用当前闭包的 `currentId`；切换会话后 effect 重新订阅，旧流可能写进新会话。
  - 切换会话不会同步 `selectedId`/`detail`，R# 跳转可能映射到旧 demo。
  - `ask` 没有 try/catch；IPC reject 时 `asking` 保持 true。
- **实际**：中途切换会话可能把答案写错；R# 跳转错位；按钮卡在“停止”。
- **预期**：每个请求绑定 sessionId/requestId；切换会话同步 demo；异常 finally 复位。
- **影响**：AI 分析结果错乱，用户难以恢复。
- **修复方向**：事件载荷加 `sessionId`；`ask` try/catch/finally；切换会话时按 session.demoId 拉详情。
- **复验**：A 会话流式中切到 B，答案仍留在 A；IPC 异常后按钮恢复；切换会话 R# 跳转正确。

---

## F-09 mock/旧缓存缺少 UID 时所有击杀显示“自杀”

- **定位**：`src/renderer/src/pages/DemoDetailPage.tsx:1473`；`src/main/services/mock.ts:208-221`
- **级别/置信度**：P2 / confirmed（截图 + 代码）
- **证据**：`isSuicide = kill.attackerUid === kill.victimUid || kill.attackerUid === 65535`；mock kill 不设置两个 UID，`undefined === undefined` 为 true。
- **实际**：截图 `detail-scroll.png` 中所有击杀显示“自杀”，攻击者列为空。
- **预期**：缺少 UID 时不应判定自杀；世界击杀应显示“环境”。
- **影响**：mock/旧缓存/不完整数据下击杀流完全不可读；真实解析通常有 UID，但仍应防御。
- **修复方向**：要求两个 UID 都 defined 且相等；`attackerUid === 65535` 显示“环境”；补 mock UID。
- **复验**：mock 击杀流显示攻击者/受害者；世界击杀显示“环境”。

---

## F-10 转写页“选择 Demo”无法清空

- **定位**：`src/renderer/src/pages/TranscriptPage.tsx:63-76,338-361`
- **级别/置信度**：P2 / confirmed（交互）
- **证据**：下拉包含 `{value:'', label:selectDemo}`；onChange 对空值只 `setDemoId(undefined)`，不通知 App；effect 用 `initialDemoId || demoId` 并把 demoId 设回 `initialDemoId`。
- **实际**：选择“选择 Demo”后自动弹回上一个 demo（CDP 实测 mirage）。
- **预期**：清空选择并回到空态。
- **影响**：用户无法清除过期/不想看的 demo。
- **修复方向**：空值也调用 `onOpenDemo('')` 或让 App route 清空；effect 区分“外部导航”和“用户清空”。
- **复验**：选择空项后显示空态，刷新/切页不弹回。

---

## F-11 转写单个玩家失败被吞掉，可能“假完成”

- **定位**：`src/main/services/asr.ts:797-800`；`src/main/services/library.ts:1060-1062`
- **级别/置信度**：P2 / confirmed（代码）
- **证据**：`catch (err) { console.error(...); continue }`；最终仍 emit `asr:done`，segments 可能为 0。
- **实际**：API Key 错误/引擎失败时，UI 可能显示“转写完成”但没有任何文本。
- **预期**：统计失败数；全部失败抛错；部分失败提示“X 个玩家失败”。
- **影响**：用户误以为成功，重复操作/浪费 token。
- **修复方向**：失败计数；`if (segments.length === 0) throw`；事件带 `failed` 字段；UI 显示。
- **复验**：无效 Key 转写显示明确错误；部分失败有警告。

---

## F-12 CS2 加时被误判为 MR15

- **定位**：`src/renderer/src/pages/DemoDetailPage.tsx:1310`
- **级别/置信度**：P2 / confirmed（代码）
- **证据**：`const halfRound = rounds.length > 26 ? 15 : 12`；CS2 加时（例如 30 回合）会走 15，导致半场线/颜色错位。解析器自身在 `parser.ts:564` 用 12 回合半场。
- **实际**：加时 demo 的 MatchTimelineBar 半场分隔错误。
- **预期**：CS2 固定 12 回合半场；MR15 仅用于旧 CS:GO。
- **影响**：加时比赛时间轴误导。
- **修复方向**：CS2 固定 12；如需兼容 CS:GO，用 demo 版本/元数据判断；加时单独标识。
- **复验**：30 回合样本 HT 在第 12 回合后；加时标识正确。

---

## F-13 回合结束后的击杀可能翻转胜负；tickrate 硬编码 64

- **定位**：`src/main/services/parser.ts:442-460,57`
- **级别/置信度**：P2 / confirmed（代码）
- **证据**：`closeRound` 用 `r.kills[r.kills.length - 1]` 推导胜负，未过滤 `tick <= endTick`；`TICK_RATE = 64` 固定，`timeSec`/`voiceSec` 都按 64。
- **实际**：post-round 击杀可能改变 winner；128-tick demo 的时间/语音秒数偏差。
- **预期**：只用回合结束前的击杀；tickrate 从 demo header/ServerInfo 读取。
- **影响**：回合胜负/统计/跳转时间错误。
- **修复方向**：过滤 endTick；解析 header tickrate；voiceSec 用实际 tickrate；加回归样本。
- **复验**：构造 endTick 后有击杀的样本，winner 不变；128-tick 时间正确。

---

## F-14 可访问性与对比度

- **定位**：`src/renderer/src/theme/hud.css:25,2934-2960`；`NavRail.tsx:25-29`；`LibraryPage.tsx:740-751`；`Timeline.tsx:38-61`；`ui.tsx` CustomSelect
- **级别/置信度**：P2 / confirmed（计算 + 代码）
- **证据**：
  - `--text-2: #63636b` 在 `#0a0a0c` 上 3.32:1，在 `#1e1e21` 上 2.79:1；浅色 `#8e8e93` 在 `#f2f2f7` 上 2.92:1。
  - 大量 10.5–11.5px 标签使用 `--text-2`。
  - 导航项、资料库卡片、时间轴色块/圆点、CustomSelect 选项、转写筛选标签均为 `div`/`span`/SVG `onClick`，无 tabIndex/role/键盘处理。
  - `.tline .jump`/`.voice-play` 默认 `opacity: 0`，仅 hover 显示。
- **实际**：低视力用户难读；键盘用户无法完成主要操作；触控/无 hover 设备难发现播放/跳转。
- **预期**：正文对比度 >= 4.5:1；所有交互可 Tab/Enter/Space；focus 可见。
- **影响**：可访问性不达标；部分用户无法使用核心功能。
- **修复方向**：调整 token；语义化按钮；focus-visible；hover/focus 都显示操作；`aria-current`/`aria-pressed`。
- **复验**：axe/手工键盘走查；对比度脚本达标。

---

## F-15 设置页 draft 与外部设置不同步；Key 状态不刷新

- **定位**：`SettingsPage.tsx:399`；`AiPage.tsx:168`；`TranscriptPage.tsx:79-86`
- **级别/置信度**：P2 / confirmed（代码）
- **证据**：`useState(settings)` 只在首次渲染使用；标题栏切主题、详情页静音等会改变 App settings，但设置页 draft 不变。AI/转写页只在挂载时读 Key，不监听 `settings:changed` 更新 `hasKey`/`hasCloudKey`。
- **实际**：设置页显示旧主题/旧静音列表；填完 Key 后 AI/转写页仍提示“未配置”。
- **预期**：draft 与 props 同步（或明确“未保存”状态）；Key 状态实时更新。
- **影响**：用户困惑，可能覆盖外部修改。
- **修复方向**：`useEffect` 同步 props（注意不要覆盖正在编辑的字段）；事件里更新 hasKey。
- **复验**：标题栏切主题后设置页同步；填 Key 后 AI 页提示消失。

---

## F-16 从转写/AI 启动 CS2 未传语音掩码

- **定位**：`TranscriptPage.tsx:278-282`；`AiPage.tsx:279-283`；对比 `DemoDetailPage.tsx:374-379`
- **级别/置信度**：P2 / confirmed（代码）
- **证据**：详情页 launch 传 `tvVoiceIndices`；转写/AI 只传 `playDemoPath`、`voiceHud`、`startTick`。
- **实际**：从转写/AI 跳转启动时，静音名单不生效。
- **预期**：所有启动入口使用同一套语音掩码。
- **影响**：用户以为静音了，游戏内仍有声音。
- **修复方向**：抽出 `launchDemoWithSettings`，统一计算 `computeVoiceMask` 并传参。
- **复验**：从三个入口启动，控制台掩码一致。

---

## F-17 外链 `target="_blank"` 会在 Electron 内开新窗口

- **定位**：`SettingsPage.tsx:808-815`；`src/main/index.ts` 无 `setWindowOpenHandler`
- **级别/置信度**：P2 / confirmed（代码）
- **证据**：Groq Key 链接是 `<a target="_blank">`；主进程没有 window open handler。
- **实际**：点击可能打开一个新的 Electron 窗口，而不是系统浏览器。
- **预期**：外链走 `window.api.app.openUrl` 或 `shell.openExternal`。
- **影响**：用户体验不一致；新窗口缺少导航/安全策略。
- **修复方向**：改成 Btn + `app.openUrl`；或加 `setWindowOpenHandler` 统一拦截。
- **复验**：点击后系统浏览器打开，应用内不新增窗口。

---

## F-18 全局单个转写 AbortController

- **定位**：`library.ts:79-83,1033,1071-1074`
- **级别/置信度**：P2 / confirmed（代码）
- **证据**：`transcribeSignal` 是单例；`transcribe` 每次覆盖；`splitVoice` 也使用它。
- **实际**：两个 demo 同时转写时，取消/完成会互相影响。
- **预期**：每个 job 独立 controller，按 demoId/jobId 取消。
- **影响**：取消错任务/无法取消。
- **修复方向**：`Map<demoId, AbortController>`；取消接口带 id。
- **复验**：两个转写并行，取消 A 不影响 B。

---

## F-19 开发模式版本号显示 Electron 版本

- **定位**：`App.tsx:74-80`；`index.ts:287`
- **级别/置信度**：P2 / confirmed（截图）
- **证据**：截图标题栏 `v43.4.1`；`app.getVersion()` 在未打包 Electron 中返回 Electron 版本。
- **实际**：开发/截图环境显示错误版本。
- **预期**：显示 package.json 的 1.0.0。
- **影响**：开发/验收混淆；打包后正常。
- **修复方向**：主进程读取 package.json 版本或 `app.getVersion()` 加 fallback。
- **复验**：`npm run dev` 标题栏显示 1.0.0。

---

## F-20 Overlay 只定位主显示器；HUD 依赖层级风险

- **定位**：`src/main/overlay.ts:67`；`assets/panorama/scripts/hud/dsh_voice.js:29-37`
- **级别/置信度**：P2 / probable
- **证据**：`screen.getPrimaryDisplay()` 固定主屏；HUD 从 `DshVoiceList` 向上最多 6 层找 `GetDemoControllerState`。
- **实际**：多显示器用户在副屏游戏时 overlay 出现在主屏；CS2 若调整 Demo UI 层级，HUD 找不到 controller。
- **预期**：按游戏窗口所在显示器定位；HUD 用更稳的接口/根节点。
- **影响**：overlay 不可见/HUD 不显示。
- **修复方向**：用 `screen.getDisplayNearestPoint`/游戏窗口 bounds；HUD 直接从根 `CSGOHudDemoController` 取。
- **复验**：副屏启动 overlay 在副屏；HUD 正常。

---

## F-21 新 Rush 模式不符合 5v5/MR12 假设

- **定位**：`parser.ts`（10 人/12 回合半场/1、13 手枪局）；`DemoDetailPage.tsx:1271-1288`（5 格存活条）；`MatchTimelineBar`
- **级别/置信度**：P2 / probable（无 Rush 样本）
- **证据**：2026-09-23 CS2 新增 Rush 3v3 模式（小竞技场、占塔、随机场景）。项目没有模式检测；UI/解析假设 5v5、10 人、MR12。
- **实际**：Rush demo 可能出现选手数、回合结构、存活条、半场线错误。
- **预期**：检测模式并提示“暂不支持”，或适配 3v3/回合规则。
- **影响**：未来用户拖入 Rush demo 会看到错误统计。
- **修复方向**：从 ServerInfo/GameRules 读模式；不支持时明确提示；后续适配。
- **复验**：Rush demo 不崩溃且有明确提示；普通 MR12 不受影响。

---

## F-22 i18n 硬编码中文

- **定位**：`DemoDetailPage.tsx`（大量 toast/标题/表头）、`TranscriptPage.tsx`（stage/筛选/空态）、`SettingsPage.tsx`（说明/按钮）、`LibraryPage.tsx:532`
- **级别/置信度**：P2 / confirmed（源码 + 截图）
- **证据**：`t()` 只覆盖部分 key；大量字符串直接写在 JSX/ toast 中。
- **实际**：EN 模式会中英混排。
- **预期**：所有用户可见文案走 zh/en 字典。
- **影响**：英文用户可用性差；与 README 宣称的双语不一致。
- **修复方向**：补 key；加脚本扫描硬编码中文；截图回归 EN。
- **复验**：EN 模式除用户数据/地图名外无中文。

---

## F-23 其余 P3 细节

- **地图名格式**：卡片/详情直接显示 `mapName`（可能是 `de_dust2`）或 mock 的小写 `mirage`；建议格式化为 `Dust II`/`Mirage`。
- **悬停才显示操作**：`.tline .voice-play/.jump` 默认 opacity 0；键盘 focus 也不显示（F-14 的一部分）。
- **导出 URL 立即 revoke**：`TranscriptPage.tsx:309-315` 在 `a.click()` 后立即 `revokeObjectURL`，部分环境可能取消下载；建议 setTimeout。
- **`window.confirm`**：`AiPage.tsx:334-349` 删除会话使用原生 confirm，样式与应用不一致；建议自定义 Modal。
- **聊天头像 team=NONE**：`TranscriptPage.tsx:600` ChatRow 固定 `team="NONE"`，与详情页聊天不一致；应按 channel/玩家表着色。
- **设置页宽度**：`SettingsPage.tsx:619` `maxWidth: 860` 左对齐，1440 下右侧大片空白；建议居中或加宽。
- **ErrorBoundary**：`App.tsx:37-42` “重试”只清 error，不重挂载 children；`revealInFolder('')` 无意义；建议加 key 重挂载/刷新。
- **最大化状态**：`App.tsx:82` 调 `isMaximized()` 但忽略；未订阅 `window:maximized`，图标不随窗口状态变化。
- **LibraryPage 未处理 Promise**：`toggleFav` 的 remove 分支无 catch；`onParse`/`onReparse` 不 await/catch；`voiceTag` detect 无 catch（`LibraryPage.tsx:199-232,560-567,727-731`）。
- **`confirmRemove` 假成功**：`LibraryPage.tsx:219-232` 每个删除失败都吞掉，最后仍 toast “已移除”。
- **`formatRootLabel` 死分支**：`LibraryPage.tsx:29` 在已把 `\` 替换为 `/` 后还检查 `wmpvp\\demo`；不影响结果，但应清理。
- **`normalizeWav` 声道假设**：`asr.ts:390-410` 按 32-bit 样本逐个转 16-bit，保留声道数；`detectSpeech` 却按单声道帧计算。若 csgove 输出立体声，VAD 时间会偏。建议显式断言 mono 或按 blockAlign 处理。
- **`engines.ts` async filter**：`engines.ts:170` 用 `async` 谓词给 `filter`，实际不过滤；虽然目录仍会被遍历，但代码意图错误，建议改 `for` 循环。
- **`download.ts` abort listener 泄漏**：`get()` 成功后不移除 abort listener；同一 signal 多次下载会累积。建议 `finally` 移除。
- **`persistChats` 无写队列**：`ai.ts:132-138` 与设置类似，多个 `saveChat` 并发可能丢更新。
- **`library` persist tmp 冲突**：`persistIndex`/`persistDetail` 共用 `.tmp` 命名，扫描/解析并发时可能互相覆盖。
