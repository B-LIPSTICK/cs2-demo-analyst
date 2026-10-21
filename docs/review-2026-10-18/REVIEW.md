# CS2 Demo Analyst — 全量界面与工程审查报告

- 审查日期：2026-10-18
- 仓库：`D:\00-projects\Github\cs2-demo-analyst`
- 基线：`main` / `c3e5359`，工作区干净
- 审查方式：源码静态审查 + 真实构建/冒烟 + Electron 离屏截图 + 真实 demo 解析/语音索引验证 + CS2 更新公告与依赖版本核对
- 审查范围：资料库、Demo 详情、语音转写、AI 分析、设置、标题栏/导航、共享组件、主进程关键链路、Panorama HUD、CS2 启动/注入
- 未执行：CS2 游戏内启动、真机播放、HUD 注入、VAC 官匹验证（按项目约定由用户执行）

---

## 0. 结论摘要

**总体可用，但存在一组必须先处理的安全/数据一致性风险，以及一组在最小窗口宽度下会直接破坏阅读的响应式问题。**

已确认通过：

- `npm run typecheck`：通过
- `npm run build`：通过
- `npm run smoke`：退出码 0
- 用当前 `@deademx/cs2@3.4.1` 解析 2026-10-18 的真实 demo：成功，`de_inferno`，14 回合、112 击杀、10 名选手、约 5 秒完成
- 同一 demo 的语音索引：78,116 个语音包、9 个槽位、0 个 malformed
- 深色/浅色主题、资料库/详情/转写/AI/设置页均能渲染

最需要优先处理的问题：

1. **游戏内 HUD 覆盖层已与当前 CS2 的 Demo UI 脚本发生静态漂移**：当前 Valve `huddemocontroller.vts_c` 引用 `PlayerList`、`RoundMenu`、`Camera`、`Death`、`message_arrow` 等面板，而本项目的 `huddemocontroller.xml` 全部缺失。结论是“静态不匹配已确认，游戏内表现需要真机验证”，但这是本次 CS2 更新影响里风险最高的一项。
2. **`cleanAll` 的清理范围过大**：会整目录删除 `game/csgo/overrides`、用旧备份覆盖 `gameinfo.gi`、删除 `_toolsettings` 与 `tools_thumbnail_cache.sqlite3`。这可能删掉其他 HUD/工具的文件，或在 CS2 更新后把官方文件回滚到旧版本。
3. **暂存 demo 从未清理**：`D:\dsh-demo` 已有 **120 个文件、12.29 GB**（2026-09-14 至 2026-10-18），`game/csgo` 还有 1 个 87 MB 的暂存 demo。
4. **资料库索引/转写缓存存在误删路径**：`index.json` 损坏或某个根目录暂时离线时，启动逻辑会把对应条目从索引删除；随后孤儿清理会删除对应的 detail JSON（含转写结果）。
5. **设置页每次按键都写盘，且主进程没有写队列**：快速输入 API Key/路径时可能出现写入乱序、旧响应覆盖新值、设置文件损坏。
6. **最小窗口宽度下布局失效**：1082px 时资料库工具栏横向溢出、出现横向滚动条；详情页语音行文本列只有 13px，中文变成逐字竖排。

未发现已确认的 P0（重大数据暴露/不可恢复损毁）。下面按 P1/P2/P3 给出证据、影响和修复方向。

---

## 1. 基线与证据

### 1.1 构建/检查

| 检查 | 命令 | 结果 |
|---|---|---|
| TypeScript 双工程 | `npm run typecheck` | 通过，0 报错 |
| 生产构建 | `npm run build` | 通过 |
| 冒烟 | `npm run smoke` | 退出码 0 |
| 依赖版本 | `npm ls @deademx/cs2 @deademx/engine --depth=0` | 3.4.1 / 3.4.1 |

### 1.2 真实 demo 解析

样本：`C:\Users\LIPSTICK\AppData\Roaming\CS2 Demo Analyst\Cache\zips\27a1ac4262471075\9210744306839323020_0.dem`（2026-10-18）

结果：

- 地图 `de_inferno`
- 比分 13:1
- 14 回合、112 击杀、2 条聊天、10 名选手
- `hasVoice=true`，`voiceSec=557`
- 解析耗时约 5.0 秒
- 选手槽位 3–12，和语音索引的 9 个说话槽位一致

语音索引：

- 78,116 个 `SVC_VOICE_DATA`
- 9 个槽位有脉冲
- 0 个 malformed
- 耗时约 0.9 秒

这说明 **当前 CS2 更新没有让 3.4.1 的解析/语音索引整体失效**；不能把“CS2 更新”直接等同于“解析必坏”。真正高风险的是 HUD 覆盖层和清理逻辑。

### 1.3 截图证据

截图目录：`docs/review-2026-10-18/shots/`

| 文件 | 内容 |
|---|---|
| `library.png` | 资料库空态（目录筛选） |
| `library-cards.png` | 资料库卡片（深色） |
| `library-light.png` | 资料库（浅色） |
| `detail.png` | Demo 详情（深色，顶部） |
| `detail-scroll.png` | Demo 详情（深色，击杀/语音） |
| `detail-light.png` | Demo 详情（浅色，顶部） |
| `detail-light-scroll.png` | Demo 详情（浅色，击杀/语音） |
| `transcript.png` | 语音转写页 |
| `ai.png` | AI 分析页 |
| `settings.png` | 设置页（通用/目录/转写） |
| `settings-cs2.png` | 设置页（AI/CS2 播放） |
| `library-narrow.png` | 资料库 1082px：工具栏溢出 |
| `narrow.png` | 详情 1082px：语音文本竖排 |
| `ai-narrow.png` | AI 分析 1082px |
| `settings-narrow.png` | 设置 1082px |

---

## 2. 页面/组件覆盖

| 页面/区域 | 覆盖内容 | 状态 |
|---|---|---|
| 资料库 | 空态、卡片、目录筛选、搜索、排序、选择模式、删除弹窗、收藏、语音扫描入口 | 已审查；主要问题见 F-05/F-09/F-29 |
| Demo 详情 | 头部、比分、时间轴、选手表、麦克风、回合条、击杀流、语音/聊天、选手弹窗 | 已审查；F-05/F-06/F-09/F-12/F-13/F-17 |
| 语音转写 | demo 下拉、玩家筛选、回合筛选、搜索、语音/聊天 tab、导出、分割/转写按钮、进度 | 已审查；F-10/F-11/F-17 |
| AI 分析 | 会话下拉、新建/删除、demo 下拉、提示卡、输入/发送/停止、流式消息 | 已审查；F-08/F-15 |
| 设置 | 主题/语言、目录、转写引擎/Key/语言、AI 服务商/Key/模型、CS2 路径/模式/HUD/还原、引擎下载、离线说明 | 已审查；F-02/F-04/F-15/F-18/F-20 |
| 标题栏/导航 | 版本、游戏状态灯、GitHub、主题、窗口控制、导航项 | 已审查；F-14/F-20/F-28 |
| 共享组件 | Btn/Tag/Avatar/Empty/Ring/Toggle/CustomSelect/Toast/VoicePlayButton/Modal | 已审查；F-05/F-14 |
| 主进程 | settings/library/parser/asr/ai/live/injector/engines/download | 已审查；F-02/F-03/F-04/F-07/F-11/F-13/F-19 |
| HUD/Overlay | `huddemocontroller.xml`、`dsh_voice.js`、overlay 窗口 | 静态审查；F-01/F-20；游戏内未执行 |

---

## 3. 问题总表

| ID | 级别 | 置信度 | 区域 | 一句话影响 | 证据 |
|---|---|---|---|---|---|
| F-01 | P1 | probable（静态不匹配已确认） | HUD | 覆盖层缺少当前 Valve 脚本引用的面板，游戏内可能报错/原生控件缺失 | 当前 VPK 脚本 vs 项目 XML |
| F-02 | P1 | confirmed（控制流） | 清理/注入 | 可能删除其他 HUD 文件、回滚官方 gameinfo、清掉工具缓存 | `injector.ts:181-193`、`live.ts:313-340` |
| F-03 | P1 | confirmed（控制流） | 资料库 | 索引损坏/根目录离线会误删条目，随后误删转写缓存 | `library.ts:637-695` |
| F-04 | P1 | confirmed（控制流） | 设置 | 每次按键写盘且无队列，可能乱序/损坏设置 | `SettingsPage.tsx:464-474`、`settings.ts:53-60` |
| F-05 | P1 | confirmed（截图/计算） | 响应式 | 1082px 时工具栏溢出，语音文本 13px 逐字竖排 | `library-narrow.png`、`narrow.png`、computed grid |
| F-06 | P2 | confirmed（代码） | 语音掩码 | 槽位缺失时回退到列表下标，可能静音错人 | `parser.ts:1286-1291`、`DemoDetailPage.tsx:43-52` |
| F-07 | P2 | confirmed（代码） | 资料库 | pending demo 的 AI/转写会空等 180 秒，不会自动解析 | `library.ts:821-832` |
| F-08 | P2 | confirmed（代码） | AI | 切换会话时流式事件只按 demoId 匹配，可能写进错误会话；IPC 异常会让“停止”卡住 | `AiPage.tsx:190-246,292-324` |
| F-09 | P2 | confirmed（截图/代码） | 击杀流 | mock/旧缓存缺少 UID 时 `undefined === undefined`，所有击杀显示“自杀” | `DemoDetailPage.tsx:1473`、`mock.ts:208-221` |
| F-10 | P2 | confirmed（交互） | 转写 | “选择 Demo”无法清空，自动弹回上一个 demo | `TranscriptPage.tsx:63-76,338-361` |
| F-11 | P2 | confirmed（代码） | 转写 | 单个玩家失败被吞掉，全部失败仍可能提示“完成” | `asr.ts:797-800`、`library.ts:1060-1062` |
| F-12 | P2 | confirmed（代码） | 时间轴 | CS2 加时（>26 回合）被误判为 MR15，半场线错位 | `DemoDetailPage.tsx:1310` |
| F-13 | P2 | confirmed（代码） | 解析 | 回合结束后的击杀可能翻转胜负；tickrate 硬编码 64 | `parser.ts:442-460,57` |
| F-14 | P2 | confirmed（计算/代码） | 可访问性 | 次级文字对比度 2.79–3.32:1；大量 div/article 点击无键盘支持 | `hud.css:25`、`NavRail.tsx:25`、`LibraryPage.tsx:740` |
| F-15 | P2 | confirmed（代码） | 设置/AI | 设置页 draft 不随外部设置同步；AI/转写 Key 状态不随设置事件更新 | `SettingsPage.tsx:399`、`AiPage.tsx:168`、`TranscriptPage.tsx:79-86` |
| F-16 | P2 | confirmed（代码） | 启动 | 从转写/AI 启动 CS2 时未传 `tvVoiceIndices`，静音设置不生效 | `TranscriptPage.tsx:278-282`、`AiPage.tsx:279-283` |
| F-17 | P2 | confirmed（代码） | 外链 | `<a target="_blank">` 未配置 `setWindowOpenHandler`，会在 Electron 内开新窗口 | `SettingsPage.tsx:808-815`、`index.ts` 无 handler |
| F-18 | P2 | confirmed（代码） | 转写并发 | 全局单个 AbortController，两个转写任务会互相覆盖取消信号 | `library.ts:79-83,1033` |
| F-19 | P2 | confirmed（截图/代码） | 版本 | 开发模式标题栏显示 `v43.4.1`（Electron 版本），不是 1.0.0 | `App.tsx:74-80`、`index.ts:287` |
| F-20 | P2 | probable | HUD/Overlay | overlay 只定位主显示器；HUD 依赖的 GameStateAPI/DemoController 层级可能随更新变化 | `overlay.ts:67`、`dsh_voice.js:29-37` |
| F-21 | P2 | probable | CS2 Rush | 新 3v3 Rush 模式不符合 5v5/MR12/10 人假设，可能显示异常 | Steam 2026-09-23 |
| F-22 | P2 | confirmed（代码/截图） | i18n | 大量详情/转写/设置文案硬编码中文，EN 模式会中英混排 | 多个 tsx 文件 |
| F-23 | P3 | confirmed | UI 细节 | 地图名小写/`de_` 前缀、悬停才显示播放/跳转、导出 URL 立即 revoke、`window.confirm` 等 | 见 FINDINGS.md |

---

## 4. 重点问题说明

### F-01 HUD 覆盖层与当前 CS2 Demo UI 漂移（P1，需真机确认）

项目通过 `gameinfo.gi` 的 SearchPath 注入 `huddemocontroller.xml` 覆盖 Valve 原生 Demo UI。该 XML 最后修改于 2026-08-24，而当前 CS2 构建为 `25966348`（2026-10-16 更新），`gameinfo.gi` 也在 2026-10-15 19:59 被 Valve 更新。

从当前 `pak01_dir.vpk` 提取的 `panorama/scripts/hud/huddemocontroller.vts_c` 中：

- `PlayerList` 出现 22 次
- `RoundMenu` 出现 16 次
- `Camera` 出现 10 次
- `Death` 出现 4 次
- `message_arrow` 出现 1 次

而项目 `assets/panorama/layout/hud/huddemocontroller.xml` 中这些 ID 全部不存在（`Camera`/`Speed` 只作为图片路径/`SpeedControls` 出现）。当前 Valve 还提供了独立的 `huddemoplayback.vxml_c`，项目未覆盖它。

这意味着：**原生脚本按当前版本找面板时，可能找不到本项目覆盖 XML 里的对应节点**。结果可能是 HUD 不显示、原生播放控件缺失、Panorama 控制台报错，或某些交互静默失效。静态不匹配是确定的；具体游戏内表现必须由用户跑一次 HUD 模式确认。

建议：以当前 `huddemocontroller.vxml_c` 为基准重新生成覆盖 XML，保留 Valve 新增的 `PlayerList`/`RoundMenu`/`Camera`/`Death`/`message_arrow` 结构，只追加 `DshVoice*` 节点；同时加启动自检日志，输出缺失 ID。

### F-02 清理范围过大 + 暂存 demo 泄漏（P1）

`src/main/services/injector.ts:181-193` 的 `cleanAll`：

- `fs.rm(overrides, { recursive: true, force: true })` 删除整个 `game/csgo/overrides`，不只是本项目的两个 VPK；
- 如果存在 `gameinfo.gi.dsh_inject.bak`，直接用备份覆盖当前 `gameinfo.gi`。CS2 更新后备份可能是旧版本，会把 Valve 新增行回滚掉；
- 删除 `game/_toolsettings`、`tools_thumbnail_cache.sqlite3`、`steam_appid.txt`，这些不一定都是本项目创建的。

`live.ts:313-340` 在 CS2 退出后自动调用 `cleanAll`，`live.ts:450/527` 在每次原生启动前也会调用。也就是说，用户只要用本应用启动一次 CS2，就可能触发上述清理。

另外，`stageDemoForPlayNoSpace` 把 demo 复制到 `盘根:\dsh-demo`，`stageDemoForPlay` 复制到 `game/csgo`，但 `cleanAll` 不删除 `dsh-*.dem`。当前实测：

- `D:\dsh-demo`：120 个 `dsh-*.dem`，合计 **12.29 GB**，最早 2026-09-14，最新 2026-10-18；
- `game/csgo/dsh-612e77189f.dem`：87,767,556 字节，2026-09-08。

建议：只删除本项目的两个 VPK；`gameinfo.gi` 只移除自己的 SearchPath 行，不覆盖备份；`_toolsettings`/缓存不碰；暂存 demo 用应用缓存目录 + 清单跟踪，启动/退出时按清单清理，或至少按 `dsh-*.dem` 前缀 + 年龄清理。

### F-03 资料库索引/转写缓存误删（P1）

`library.ts` 启动流程：

1. 读 `index.json`，失败时 `store.index = {}`（637-649）；
2. 扫描 `library` 目录，删除所有“index 里不存在”的 detail JSON（662-668）；
3. 对每个 index 条目 `fs.stat(meta.path)`，失败就 `delete store.index[id]`（679-695）；
4. 下一次启动时，这些条目的 detail JSON 又会被孤儿清理删除。

因此：

- `index.json` 损坏/半写 → 所有转写缓存被当成孤儿删除；
- 外部盘/网络盘/平台目录暂时离线 → 对应 demo 条目被删除，转写结果在后续启动被清理。

建议：索引读取失败时进入“只读/恢复”模式，不执行孤儿清理；根目录不可达时标记 `missing` 而不是删除；删除前备份 index/detail；提供“重新扫描并恢复”入口。

### F-04 设置写入竞态（P1）

`SettingsPage.tsx`：

- `set()` 每次调用都 `save(patch)`，不 await、不 catch（470-474）；
- API Key、路径、启动参数等文本输入 `onChange` 直接触发 `set`（931-938、1008-1014、1040-1046）；
- `save()` 用返回的 `next` 覆盖 `draft`（464-468）。

`settings.ts` 的 `updateSettings` 没有串行队列：读 cache → merge → 写同一个 `.tmp` → rename。快速输入时多个请求交错，可能出现旧响应覆盖新值、`.tmp` 互相覆盖、最终设置丢失。主进程还会对每个 patch 发一次 `settings:changed`（`index.ts:81-95`）。

建议：设置页文本输入改为本地 draft + 300ms 防抖/失焦保存；主进程用单一写队列（promise chain/mutex）；保存失败要 toast 并保留 draft；`settings:changed` 只广播最终状态。

### F-05 最小窗口宽度布局失效（P1，默认 1440 正常）

`main/index.ts:32` 的 `minWidth: 1080` 是用户可达的最小宽度。`hud.css`：

- `.demo-bottom-grid` 只在 `max-width: 800px` 时堆叠（3378-3383）；
- `.page-head` 只在 `max-width: 820px` 时换行（3424-3435）；
- `.tline` 在 1080 断点仍是 `72px 110px 1fr 28px 28px`（3412-3416），但 1082px 时媒体查询未命中，默认列是 `78px 124px 1fr 32px 32px`。

实测 1082px：

- 详情页右栏宽 398px，`.tline` 计算列 `78px 124px 13px 32px 32px`，文本列只有 **13px**，中文逐字竖排；
- 资料库工具栏不换行，右侧“选择”按钮被裁切，页面出现横向滚动条。

建议：把底部双栏/工具栏的断点提高到 1200–1280px；所有 grid 的弹性列用 `minmax(0, 1fr)`；窄宽度下把语音行改成两行布局（时间/玩家一行，文本一行，操作按钮固定右侧）；`page-head .actions` 在 1080 就允许 `flex-wrap`。

---

## 5. CS2 更新影响

详见 `CS2-UPDATE-IMPACT.md`。结论先行：

- **解析/语音索引**：3.4.1 对 2026-10-18 的真实 demo 仍可用；没有观察到 CS2 更新导致解析崩溃。
- **HUD**：最大风险。当前 Valve Demo UI 脚本引用的面板与项目覆盖 XML 不一致，需优先同步并真机验证。
- **Rush 模式**：2026-09-23 新增 3v3 模式，项目的 5v5/MR12/10 人假设不适用；未来遇到 Rush demo 会显示异常，需要模式检测或明确不支持。
- **deadem 升级**：最新 4.0.2，项目 3.4.1；4.0.0 有 breaking changes（移除多线程、exports 限制）。当前 3.4.1 还能用，建议在分支上升级并跑回归，不要直接替换。
- **VAC/`-insecure`**：10-15 更新公告没有提到 VAC 规则变化；但本项目的 `cleanAll` 破坏性清理比 VAC 本身更值得先修。

---

## 6. 优化方案（建议顺序）

### 阶段 A：安全与数据一致性（先做，不引入新功能）

| 任务 | 内容 | 验收 |
|---|---|---|
| A1 | 收窄 `cleanAll`：只删本项目 VPK；gameinfo 只删自己的行；不碰 `_toolsettings`/缓存；保留备份但校验版本 | 其他 override 文件仍在；gameinfo 只少两行；CS2 更新后不会回滚官方内容 |
| A2 | 暂存 demo 清单化：记录 staged 文件，启动/退出清理；清理现有 `D:\dsh-demo` 与 `game/csgo/dsh-*.dem` | 清理后目录为空/仅保留最近 N 个；不再无限增长 |
| A3 | 资料库容错：索引损坏/根目录离线不删条目；`missing` 状态；孤儿清理只在索引成功加载后执行 | 模拟损坏/离线后条目和转写仍在；恢复目录后可重新扫描 |
| A4 | 设置写队列 + 防抖 + 错误提示；draft 与 props 同步 | 连续输入只产生一次最终写入；失败有 toast；外部改主题后设置页同步 |
| A5 | 响应式修复：1200/1280 断点；`minmax(0,1fr)`；工具栏换行；语音行两行布局 | 1080/1200/1440 三档无横向滚动；语音文本每行 >= 8 个中文字符 |

### 阶段 B：正确性

| 任务 | 内容 | 验收 |
|---|---|---|
| B1 | 槽位缺失不猜：`slot` 允许 undefined；缺失时禁用/警告闭麦，不发送错误掩码 | 缺 slot 的选手不会误静音；UI 有明确提示 |
| B2 | `waitDetail` 对 pending 自动 `parse`；转写/分割用 per-job AbortController | 新扫描 demo 的 AI/转写能自动开始；取消只影响当前任务 |
| B3 | AI 会话绑定：事件带 chatId/requestId；切换会话不串流；`ask` 用 try/finally | 中途切会话答案留在原会话；IPC 异常不会卡“停止” |
| B4 | 转写页“选择 Demo”可清空；从转写/AI 启动时传 `tvVoiceIndices` | 清空后回到空态；静音设置在任意入口生效 |
| B5 | mock/旧缓存击杀 UID 判空；世界击杀显示“环境”而非“自杀” | mock 击杀流不再全部“自杀” |
| B6 | 回合胜负只用 `endTick` 前的击杀；tickrate 从 demo 头读取；CS2 固定 12 回合半场；加时/Rush 检测 | 加时半场线正确；128-tick 时间正确；Rush demo 不崩溃/有提示 |

### 阶段 C：体验与可访问性

| 任务 | 内容 | 验收 |
|---|---|---|
| C1 | 对比度：`--text-2` 提升到至少 4.5:1（暗/亮两套）；正文最小 11.5–12px | 计算对比度达标；截图可读 |
| C2 | 语义化：导航/卡片/时间轴/下拉项改 button 或加 role/tabIndex/keydown；`aria-current`/`aria-pressed`；focus-visible | 仅键盘可完成：切页、选 demo、选回合、播放语音、跳转 |
| C3 | 悬停操作可见性：语音播放/跳转在 focus/hover 都显示，或常驻弱化显示 | 不悬停也能发现操作；键盘 focus 可见 |
| C4 | i18n 收口：详情/转写/设置硬编码中文补 key；地图名格式化；设置页居中/宽度 | EN 模式无中文残留（用户数据除外）；布局平衡 |
| C5 | 小问题：版本号取 package.json；外链走 `app.openUrl`；导出 URL 延迟 revoke；删除会话用自定义 Modal；ErrorBoundary 重试重挂载 | 版本显示 1.0.0；外链在系统浏览器打开；无重复窗口 |

### 阶段 D：CS2 兼容性

| 任务 | 内容 | 验收 |
|---|---|---|
| D1 | 以当前 Valve `huddemocontroller.vxml_c` 重建覆盖 XML，保留新增面板；加 HUD 自检日志 | 游戏内无 Panorama 报错；原生播放控件和语音 HUD 同时可用 |
| D2 | 建立回归 demo 集：普通 MR12、加时、128-tick、Rush、5E/Wmpvp zip | 每个样本解析/详情/转写/时间轴有快照或断言 |
| D3 | 在分支升级 `@deademx/cs2@4.0.2`，跑解析/语音/转写/HUD 回归 | 全部通过再合并；失败则保留 3.4.1 并记录阻塞点 |
| D4 | 明确 Rush 支持策略：检测模式并提示“暂不支持”，或适配 3v3/回合规则 | 用户不会看到错误的 5v5 统计 |

---

## 7. 建议的下一步

1. **先做阶段 A**（A1–A5）。这批是数据安全/可用性问题，改动相对独立，风险低，收益最大。
2. 阶段 A 完成后，再做 **B1/B2/B3/B4/B5**（正确性），其中 B1 语音掩码和 B3 AI 会话是用户最容易感知的。
3. **HUD 同步（D1）需要你配合真机验证**：我可以先按当前 Valve 布局重建 XML 并编译 VPK，你进游戏看控制台 `[DshVoiceHud]` 与原生 Demo UI 是否正常。
4. **Rush/加时/128-tick 样本**：如果你手上有对应 demo，放到库里或给我路径，我补回归；没有的话先做“检测并提示不支持”，不假装支持。
5. deadem 4.0.2 升级单独开分支，不和 UI 修复混在一起。

本轮只做审查与方案，**没有修改任何业务源码**；新增的只有本报告、证据截图和验证脚本产物。

---

## 8. 证据索引

- 截图：`docs/review-2026-10-18/shots/`
- 详细问题：`docs/review-2026-10-18/FINDINGS.md`
- 实施计划：`docs/review-2026-10-18/PLAN.md`
- CS2 更新影响：`docs/review-2026-10-18/CS2-UPDATE-IMPACT.md`
- 覆盖台账：`docs/review-2026-10-18/coverage.md`
