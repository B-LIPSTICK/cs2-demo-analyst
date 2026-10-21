# 实施计划（从审查到修复）

> 本计划按“先安全、再正确、后体验、最后兼容”的顺序组织。每个任务都可独立验收；不要把所有改动混成一个提交。

## 阶段 A：安全与数据一致性（最高优先）

### A1 收窄 CS2 清理范围

**文件**：`src/main/services/injector.ts`、`src/main/services/live.ts`

**动作**：
- `cleanAll` 只删除 `dsh_voice_override.vpk`、`dsh_voice_session.vpk`，不 `rm` 整个 `overrides`。
- `gameinfo.gi` 只移除本项目 `SEARCH_RE` 匹配的行；不要用旧备份直接覆盖。备份保留但只作为“参考/恢复”，并在覆盖前校验当前文件是否只差本项目行。
- 不删除 `_toolsettings`、`tools_thumbnail_cache.sqlite3`；`steam_appid.txt` 仅在确认由本项目创建时删除。
- `cleanAll` 增加 `dryRun`/日志，列出将删除的文件。

**验收**：
- 在 `overrides` 放一个第三方 `.vpk`，执行还原后它仍在。
- `gameinfo.gi` 只少本项目两行；CS2 更新后的其他行不变。
- 不触碰 `_toolsettings`。

### A2 暂存 demo 清单化与清理

**文件**：`src/main/services/live.ts`、`injector.ts`

**动作**：
- 新增 `staged-demos.json`（userData）记录 `{ path, hash, demoPath, createdAt }`。
- 启动/退出时按清单删除；提供“清理暂存”按钮/启动时清理超过 N 天的文件。
- 优先使用应用缓存目录（`userData/cache/staged`）而不是盘根 `dsh-demo`；如果必须用盘根，仍要清单化。
- 清理现有 `D:\dsh-demo` 与 `game/csgo/dsh-*.dem` 需要用户确认（一次性迁移）。

**验收**：
- 启动播放 → 退出 → 暂存目录无新增残留。
- 现有 12.29 GB 清理后释放；不会误删用户原始 demo。

### A3 资料库容错

**文件**：`src/main/services/library.ts`

**动作**：
- 增加 `indexLoadOk` 标志；`index.json` 读取/解析失败时不执行孤儿清理，改为备份损坏文件 + 提示。
- `fs.stat(meta.path)` 失败时标记 `meta.status='missing'`/`missingSince`，不删除 index/detail。
- `scan` 的“失效条目”清理只在 `indexLoadOk && rootsAvailable` 时执行；根目录不可达时跳过。
- 删除/清理前把 index/detail 移到 `library/trash/<timestamp>/`，保留 7 天。
- UI 卡片显示“文件不可用”，提供“重新定位/移除”。

**验收**：
- 破坏 `index.json` 后启动，detail JSON 仍在；UI 有恢复提示。
- 拔掉外部盘后启动，条目显示 missing；恢复盘后重新扫描恢复。
- 手动移除 demo 仍能清理，但不会波及其他条目。

### A4 设置写入串行化与防抖

**文件**：`src/main/services/settings.ts`、`src/main/index.ts`、`src/renderer/src/pages/SettingsPage.tsx`

**动作**：
- 主进程增加写队列：`let writeChain = Promise.resolve(); updateSettings = (patch) => writeChain = writeChain.then(() => doUpdate(patch))`；每次写独立 tmp 名（`settings.<pid>.<seq>.tmp`）。
- 渲染层文本输入（API Key、路径、启动参数、Base URL、模型）使用本地 state + 300ms 防抖/失焦保存；开关/选择可立即保存。
- `save` 加 try/catch，失败 toast 并保留 draft；不要用旧响应覆盖新 draft。
- `settings:changed` 只在写完成后广播一次。
- `SettingsPage` 在 props 变化时同步 draft（正在编辑的字段除外）。

**验收**：
- 连续输入 50 个字符只产生一次最终写盘（可用日志计数）。
- 模拟写失败有 toast；重启后值正确。
- 标题栏切主题后设置页主题同步。

### A5 响应式修复

**文件**：`src/renderer/src/theme/hud.css`、`DemoDetailPage.tsx`、`LibraryPage.tsx`

**动作**：
- `.demo-bottom-grid` 在 `max-width: 1200px` 堆叠；`.page-head` 在 `max-width: 1100px` 允许换行/纵向排列。
- `.tline` 用 `minmax(0, 1fr)`；窄宽度改为两行：第一行时间/玩家/回合，第二行文本 + 操作按钮。
- `.page-head .actions` 默认 `flex-wrap: wrap`；搜索框在窄宽度占满一行。
- 卡片网格最小列宽 280–300，避免 1080 下只剩两列但工具栏溢出。

**验收**：
- 1080/1200/1440 三档无横向滚动条。
- 1080 下语音文本每行 >= 8 个中文字符；工具栏所有按钮可见。

---

## 阶段 B：正确性

### B1 语音槽位不再猜

- `PlayerInfo.slot` 允许 undefined；删除 `idx` 回退。
- `computeVoiceMask` 遇到无 slot 的静音选手：不发送掩码，返回 `unknownSlots` 列表；UI 显示“槽位未知，无法自动闭麦”。
- 可用 `voiceIndex.slotByXuid` 或实体采样补全；补不上就明确提示。

**验收**：构造缺 slot 的 demo，闭麦不会误伤；提示明确。

### B2 `waitDetail` 自动解析 pending + 独立取消

- `waitDetail` 在 `meta.status === 'pending'` 时 `await this.parse(id)`（只触发一次）。
- `transcribeSignal` 改为 `Map<demoId, AbortController>`；`cancelTranscribe(id?)` 按 id 取消。
- `splitVoice` 也使用独立 controller。

**验收**：新扫描 demo 直接点转写会从解析开始；取消 A 不影响 B。

### B3 AI 会话绑定

- `AiService` 事件载荷增加 `sessionId`（或 renderer 生成 `requestId` 并回传）。
- `AiPage` 只把 delta/done/error 应用到对应 session；切换会话时按 `session.demoId` 拉详情。
- `ask` 用 try/catch/finally；IPC reject 时复位 `asking`。
- `saveChat` 加写队列（与 settings 类似）。

**验收**：A 会话流式中切到 B，答案仍在 A；异常后按钮恢复；R# 跳转正确。

### B4 转写页清空与统一启动

- “选择 Demo”空值调用 `onOpenDemo('')` 或让 App route 清空；effect 区分外部导航与用户清空。
- 抽出 `launchDemoWithSettings(demo, startTick)`，统一计算 `computeVoiceMask`，详情/转写/AI 共用。

**验收**：清空后空态；三个入口启动的掩码一致。

### B5 击杀流防御

- `isSuicide` 要求 `attackerUid !== undefined && victimUid !== undefined && attackerUid === victimUid`。
- `attackerUid === 65535` 显示“环境”而不是“自杀”。
- mock 数据补 `attackerUid`/`victimUid`。

**验收**：mock 击杀流正常；世界击杀标签正确。

### B6 回合/时间轴正确性

- `closeRound` 只用 `tick <= endTick` 的击杀推导 winner；`round_officially_ended` 后击杀不计入统计。
- tickrate 从 demo header/ServerInfo 读取；`timeSec`/`voiceSec` 使用实际 tickrate。
- CS2 固定 12 回合半场；MR15 仅按 demo 版本判断；加时单独标识。
- 增加模式检测：非 5v5/MR12（Rush 等）提示“暂不支持”，不要显示错误统计。

**验收**：加时样本 HT 在第 12 回合后；128-tick 时间正确；post-round 击杀不翻转；Rush 有提示。

---

## 阶段 C：体验与可访问性

### C1 对比度与字号

- `--text-2` 暗色提升到至少 `#8a8a92`（在 `#0a0a0c` 上约 5.5:1）；亮色提升到至少 `#6e6e73`（在 `#f2f2f7` 上约 4.6:1）。
- 10.5px 标签提升到 11.5–12px；关键正文 >= 12.5px。
- 用脚本计算关键组合对比度，CI/审查时跑。

### C2 语义化与键盘

- NavRail：`<button>` + `aria-current="page"`。
- 资料库卡片：外层 `<button>` 或 `role="button" tabIndex=0` + Enter/Space；菜单按钮独立。
- 时间轴：色块/圆点改 `<button>` 或加 `tabIndex`/`role`/`onKeyDown`。
- CustomSelect：`aria-expanded`、`aria-haspopup="listbox"`、`role="option"`、方向键/Enter/Escape。
- 语音行：`focus-within` 显示播放/跳转；不要只依赖 hover。
- Modal：focus trap、Escape 关闭、`role="dialog" aria-modal`。

### C3 i18n 收口

- 扫描 `DemoDetailPage`/`TranscriptPage`/`SettingsPage`/`LibraryPage` 中硬编码中文，补 zh/en key。
- 地图名格式化：`de_dust2` → `Dust II`；mock 也统一。
- EN 模式截图回归，确保除用户数据外无中文。

### C4 小问题

- 版本号：主进程读取 package.json 或 `app.getVersion()` fallback；开发模式显示 1.0.0。
- 外链：`target="_blank"` 改 `window.api.app.openUrl`；主进程加 `setWindowOpenHandler` 兜底。
- 导出：`a.click()` 后 `setTimeout(revoke, 1000)`。
- 删除会话：自定义 Modal 替代 `window.confirm`。
- 聊天头像：按 channel/玩家表着色。
- 设置页：`maxWidth: 860` 改居中（`margin: 0 auto`）或加宽。
- ErrorBoundary：重试加 `key` 重挂载；打开数据目录用真实路径。
- 最大化状态：订阅 `window:maximized` 更新图标。

---

## 阶段 D：CS2 兼容性

### D1 HUD 覆盖层同步

- 从当前 `huddemocontroller.vxml_c` 重建 XML，保留 `PlayerList`/`RoundMenu`/`Camera`/`Death`/`message_arrow` 等节点。
- 只追加 `DshVoiceDock`/`DshVoiceList` 与 snippet。
- 加 HUD 自检：启动时检查关键 ID，缺失写 `dsh_hud.log`。
- `scripts/build-panorama.mjs` 重新编译 VPK；`make-zip` 重新打包。
- 真机验证：原生播放控件、回合跳转、相机、语音 HUD 同时正常。

### D2 回归 demo 集

- 普通 MR12（已有 2026-10-18 样本）。
- 加时（30 回合）。
- 128-tick（如有）。
- Rush 3v3（如有）。
- 5E/Wmpvp zip 容器。
- 每个样本记录：map/score/rounds/kills/players/slots/voice packets；解析时间上限。

### D3 deadem 升级评估

- 新分支 `chore/deadem-4.0.2`。
- 升级 `@deademx/cs2`/`@deademx/engine` 到 4.0.2；按 4.0.0 breaking changes 调整（移除多线程、exports 限制）。
- 跑 D2 全部样本 + 语音索引 + 转写 + HUD。
- 通过再合并；失败保留 3.4.1 并记录具体不兼容点。

### D4 Rush 策略

- 短期：检测非 5v5/MR12 模式，提示“该模式暂不支持完整分析”，仍允许基础信息。
- 中期：适配 3v3/占塔/回合规则（需要样本和规则文档）。

---

## 建议提交拆分

1. `fix(safety): 收窄 CS2 清理范围并清理暂存 demo`
2. `fix(library): 索引/离线目录容错，避免误删转写`
3. `fix(settings): 串行写入与输入防抖`
4. `fix(ui): 1080 宽度响应式与语音行布局`
5. `fix(voice): 槽位未知不猜、统一启动掩码`
6. `fix(ai): 会话绑定与异常复位`
7. `fix(parser): 回合边界、tickrate、加时/Rush 检测`
8. `feat(hud): 同步当前 CS2 Demo UI 覆盖层`
9. `chore(deps): 评估 deadem 4.0.2`
10. `style(a11y+i18n): 对比度、键盘、文案收口`

每个提交都要跑 `npm run typecheck`；UI/主进程改动跑 `npm run build`；HUD 改动跑 `node scripts/build-panorama.mjs` + `make-zip`；真机验证由用户执行。
