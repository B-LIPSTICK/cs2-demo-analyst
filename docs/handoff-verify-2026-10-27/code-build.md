# 核验 A：代码与构建事实

> **核验对象**：`docs/HANDOFF-2026-10-27.md`（990 行，49,091 B）中「代码 / 构建 / 版本」类事实
> **核验时间**：2026-10-27 17:2x–17:4x（Asia/Shanghai）
> **核验方式**：只读（read / grep / glob / Get-Item / Get-Content / `python` 解析），唯一执行的构建类命令是 `npm run typecheck`
> **未做（按任务约束）**：未跑 `npm run build` / `dist` / `dist:zip`，未读写 `node_modules/`（仅 `Get-Content` 读版本号）、未触碰 `out/` `dist/`，未修改任何 `src/` 文件，未 `git add` / `git commit`
> **工作区基线**：`branch=frontend-apple`，`HEAD=5a10f62`，`git status --short` = `M AGENTS.md`、`?? docs/HANDOFF-2026-10-27.md`、`?? docs/handoff-verify-2026-10-27/`（最后一项是本次核验产物）

---

## 结论摘要

1. **HANDOFF 的「代码」章节基本没有过时**：39 个被点名的源文件**全部存在**，行数与文档**逐一精确相等（39/39，0 偏差）**；§4.1 版本表、§5.4 CSS 加载顺序、`PARSER_VERSION=9`（`:164`）、§6.2 的 63 个 IPC 通道、§6.3 的 21 个 `MainEvent` 全部与磁盘一致。**不要轻易给 HANDOFF 记「过时」**。
2. **真正过时的是 `AGENTS.md`，不是 HANDOFF**：`AGENTS.md` 仍写「五页面（含 live）」+ `LivePage` + `0.1.0` 包名 + `--vcon-mock` 开发参数 —— 四项在代码里**都已不存在**（`NavRail` 的 `Page` 只有 4 个值；`src/renderer/src/` 无任何 `*Live*` 文件；`package.json version=1.0.0`；`src/main/index.ts` 无 `--vcon-mock`）。HANDOFF §1 的提示是对的，但它只标注了前两项。
3. **文档行数的「口径」本身是个坑（最重要方法论结论）**：文档所有行数 = `文本中 '\n' 数量 + 1`（等价 `wc -l + 1`）。若用编辑器或 `ReadAllLines` 数，会**每文件少 1 行**；若用本机 PowerShell 5.1 的 `Get-Content`（默认 GBK/936 解码），中文注释会把换行吞掉，**18/39 个文件再少 1–84 行**（`parser.ts` 实测 1484 vs 真实 1569）。**任何后续核验者若用 `(Get-Content x).Count` 会误判「文档过时 85 行」**——本次已逐文件交叉验证排除该误判。
4. **HANDOFF 自身的真实偏差只有 3 处（均为小瑕疵，非事实错误）**：① §5.3 把 `utils/format.ts` 说成「时间/大小/地图名格式化」，实际 `format.ts`（33 行）**只有 `formatMapName`**，`fmtTime/fmtBytes/fmtDate/fmtTick` 都在 `components/ui.tsx:548-598`；② §5.3 未收录 `main.tsx`（而 §5.4 又用「`main.tsx` 加载顺序」引用它）、`env.d.ts`、`assets/logo.png`；③ §4.2 命令表漏了实际存在的 `start` / `dist` / `dist:portable` 三个 npm script。
5. **`navSeq` 只存在于 AGENTS.md，HANDOFF 完全没有**：`App.tsx:87,142` 与 `TranscriptPage.tsx:31,36,114-115` 都实装了「同 demo 重复导航也生效」，但 HANDOFF 全文 grep `navSeq` = 0 命中。这是 HANDOFF 的**缺项**（AGENTS.md §4.5 反而记得）。
6. **`npm run typecheck` 通过**：exit code 0，实测 **1.6 s**（文档 §4.2 写「约 2 秒」，一致），两个工程（`tsconfig.node.json` + `tsconfig.web.json`）均无输出/无报错。

---

## 4.1 依赖版本

**文档值**：HANDOFF §4.1（第 241–251 行）。**实际值**：`package.json` 声明 + `package-lock.json`（lockfileVersion 3）+ 已安装 `node_modules/<pkg>/package.json` 三处一致。

| 组件 | 文档值 | 实际值（lockfile / 已安装） | 是否一致 | 证据 |
|---|---|---|---|---|
| `package.json` `name` | 文档未写 | `cs2-demo-analyst` | — | `package.json:2` |
| `package.json` `productName` | 文档未写 | `CS2 Demo Analyst` | — | `package.json:3` |
| `package.json` `version` | 全文按 `1.0.0` 使用（产物名/§1/§2.1） | `1.0.0` | ✅ | `package.json:4`；`git log`/`app.setVersion` 亦为之 |
| Electron | `43.4.1` | `43.4.1` | ✅ | lockfile `node_modules/electron`；已安装 `node_modules/electron/package.json` |
| React / ReactDOM | `19.2.8` | `19.2.8` / `19.2.8` | ✅ | 同上 |
| TypeScript | `5.9.x` | `5.9.3`（声明 `~5.9.0`） | ✅ | 同上 |
| Vite | `7.3.6` | `7.3.6` | ✅ | 同上 |
| electron-vite | `5.0.0` | `5.0.0` | ✅ | 同上 |
| electron-builder | `26.15.3` | `26.15.3` | ✅ | 同上 |
| `@deademx/cs2` | `3.4.1` | `3.4.1`（声明 `^3.4.1`） | ✅ | 同上；源码 `parser.ts:22`、`voiceIndex.ts:8`、`deadem.d.ts:4` 引用 |
| `@deademx/engine` | `3.4.1` | `3.4.1`（声明 `^3.4.1`） | ✅ | 同上 |
| Node | `24.12.0（本机）` | `v24.12.0` / npm `11.6.2` | ✅ | `node -v` / `npm -v` |
| 「Electron 43 + React 19」 | HANDOFF §1（第 37 行） | `43.4.1` + `19.2.8` | ✅ | 大版本对得上 |

**附加事实（文档未写）**：
- `@deademx/engine@^3.4.1` 是**声明但未被任何源码 import** 的依赖（全仓 grep 仅 `package.json:22` 与 `scripts/extract-voice-own.mjs:11` 的注释），可视为潜在可清理项。
- 其余 dependencies：`adm-zip 0.6.0` / `chokidar 4.0.3` / `opencc-js 1.4.2`（均与声明一致）；devDeps `@types/node 26.2.0`、`@types/react 19.2.18`、`@types/react-dom 19.2.4`、`@vitejs/plugin-react 5.2.0`、`cross-env`，文档未列举，不算不一致。

> 结论：**§4.1 版本表 11/11 项全部一致，无一处过时。**

---

## 5.1/5.3 文件与行数

**关键口径说明（必读）**：文档数字 = `open(f, encoding='utf-8').read().count('\n') + 1`（= `wc -l` + 1，即「按行分割后的元素数」）。用该口径复算 **39/39 文件全部精确命中**。

```pwsh
# 复现文档数字的正确方式
(Get-Content <file> -Encoding UTF8) → 仍少 1 行
(Get-Content <file>)                  → 本机 PS 5.1 默认 GBK，中文吞换行，再少更多
# 正确：
python -c "print(open('f',encoding='utf-8').read().count(chr(10))+1)"
```

**证据：同一文件三种数法差异（节选）**

| 文件 | 文档值 | `count('\n')+1` | `ReadAllLines` | PS5.1 `Get-Content`（GBK） |
|---|---|---|---|---|
| `src/main/services/parser.ts` | 1569 | **1569** | 1568 | **1484（−85）** |
| `src/main/services/stagedDemos.ts` | 579 | **579** | 578 | **543（−36）** |
| `src/main/services/asr.ts` | 934 | **934** | 933 | **893（−41）** |
| `src/renderer/src/pages/SettingsPage.tsx` | 1793 | **1793** | 1792 | **1770（−23）** |
| `src/main/index.ts` | 598 | **598** | 597 | **577（−21）** |

> 实测 39 个文件中 **18 个**在 `Get-Content`（默认编码）下少 1–84 行（合计少 361 行）。这是编码误判，**不是文档过时**。

### 5.1 主进程（`src/main/`）

| 文件 | 实际行数 | 文档行数 | 差异 | 判定 |
|---|---:|---:|---:|---|
| `src/main/index.ts` | 598 | 598 | 0 | ✅ 存在且一致 |
| `src/main/overlay.ts` | 470 | 470 | 0 | ✅ 存在且一致 |
| `src/main/services/library.ts` | 1629 | 1,629 | 0 | ✅ 存在且一致 |
| `src/main/services/parser.ts` | 1569 | 1,569 | 0 | ✅ 存在且一致 |
| `src/main/services/asr.ts` | 934 | 934 | 0 | ✅ 存在且一致 |
| `src/main/services/live.ts` | 1070 | 1,070 | 0 | ✅ 存在且一致 |
| `src/main/services/injector.ts` | 381 | 381 | 0 | ✅ 存在且一致 |
| `src/main/services/vpk.ts` | 207 | 207 | 0 | ✅ 存在且一致 |
| `src/main/services/voiceIndex.ts` | 347 | 347 | 0 | ✅ 存在且一致 |
| `src/main/services/ai.ts` | 762 | 762 | 0 | ✅ 存在且一致 |
| `src/main/services/settings.ts` | 85 | 85 | 0 | ✅ 存在且一致 |
| `src/main/services/engines.ts` | 235 | 235 | 0 | ✅ 存在且一致 |
| `src/main/services/download.ts` | 166 | 166 | 0 | ✅ 存在且一致 |
| `src/main/services/favorites.ts` | 107 | 107 | 0 | ✅ 存在且一致 |
| `src/main/services/mock.ts` | 412 | 412 | 0 | ✅ 存在且一致 |
| `src/main/services/stagedDemos.ts` | 579 | 579 | 0 | ✅ 存在且一致 |
| `src/main/services/vconsole.ts` | 298 | 298 | 0 | ✅ 存在且一致 |
| `src/main/types/deadem.d.ts` | 83 | —（文档未给） | n/a | ⚠️ 文档行数为「—」，属未填而非错误 |

### 5.2 共享与预加载

| 文件 | 实际行数 | 文档行数 | 差异 | 判定 |
|---|---:|---:|---:|---|
| `src/shared/types.ts` | 610 | 610 | 0 | ✅ |
| `src/preload/index.ts` | 124 | 124 | 0 | ✅ |

### 5.3 渲染进程（`src/renderer/src/`）

| 文件 | 实际行数 | 文档行数 | 差异 | 判定 |
|---|---:|---:|---:|---|
| `App.tsx` | 222 | 222 | 0 | ✅ |
| `pages/LibraryPage.tsx` | 1021 | 1,021 | 0 | ✅ |
| `pages/DemoDetailPage.tsx` | 2064 | 2,064 | 0 | ✅ |
| `pages/TranscriptPage.tsx` | 630 | 630 | 0 | ✅ |
| `pages/AiPage.tsx` | 667 | 667 | 0 | ✅ |
| `pages/SettingsPage.tsx` | 1793 | 1,793 | 0 | ✅ |
| `components/ui.tsx` | 961 | 961 | 0 | ✅ |
| `components/TitleBar.tsx` | 107 | 107 | 0 | ✅ |
| `components/NavRail.tsx` | 50 | 50 | 0 | ✅ |
| `components/Timeline.tsx` | 94 | 94 | 0 | ✅ |
| `i18n/zh.ts` | 516 | 516 | 0 | ✅ |
| `i18n/en.ts` | 507 | 507 | 0 | ✅ |
| `i18n/index.tsx` | 63 | 63 | 0 | ✅ |
| `utils/format.ts` | 33 | —（文档只写职责，未给行数） | n/a | ⚠️ **职责描述错误**（见下） |

**§5.3 职责描述核对结果**

| 文档描述 | 实际 | 判定 |
|---|---|---|
| `utils/format.ts` =「时间/大小/地图名格式化」 | 仅 `formatMapName` 一个导出（33 行）；`fmtTime`/`fmtTick`/`fmtBytes`/`fmtDate` 在 `components/ui.tsx:548,555,562,568` | ❌ **描述过时** |
| `App.tsx` =「页面常驻（`display` 切换不卸载）、路由、主题、Toast」 | 全部成立；另含 `ErrorBoundary`（:20-71）、`updat-banner`（:175-185）、`app-loading` 壳（:161-168），文档未提 | ✅（不完整但不错） |
| `components/ui.tsx` =「Btn/Tag/Panel/Avatar/Modal/Select/Ring…」 | `Panel`/`SectionHead`/`Btn`/`Tag`/`Led`/`Ring`/`Toggle`/`Avatar`/`Empty`/`ToastProvider`/`CustomSelect`/`VoicePlayButton`/`useFloatingPosition` 存在；**无独立 `Modal` 组件**（各页自建 `createPortal` 弹层） | ⚠️ 大致对，「Modal」名不副实 |
| `components/Timeline.tsx` =「回合时间轴」 | 实为「比分走势折线 + 回合胜败色块条」 | ✅ 可接受 |
| `components/NavRail.tsx` =「左侧导航」 | 4 项 + 底部 credit，`Page` 联合类型只有 `library/transcript/ai/settings` | ✅ |
| `index.ts` =「窗口、IPC 注册、单实例锁、启动时安全清理、开发参数」 | `requestSingleInstanceLock`(:406)、`live.restoreCleanFiles()` 启动清理(:429)、`--route/--ai-mock/--overlay-demo/--fullpanel-demo/--transcribe/--screenshot/--eval-js` 全在 | ✅ |
| `library.ts` =「扫描、zip 缓存、解析队列、详情缓存、`waitDetail`、`PARSER_VERSION`」 | 关键词命中：zip×123 / cache×79 / queue×7 / `waitDetail`×7 / `PARSER_VERSION`×10 / scan×5 | ✅ |
| `vpk.ts` =「纯 JS VPK v2 writer」 | 头注释明确 VPK v1/v2 + `vjs_c` 生成，零依赖 | ✅ |
| `download.ts` =「HTTPS 下载、重定向、进度」 | `https.get`、3xx `location` 跟随(:73-75)、`DownloadProgress` | ✅ |
| `engines.ts` =「csgove/whisper/ggml」 | `CSGOVE_VERSION='v3.1.6'`、`WHISPER_VERSION='v1.9.2'`、`MODEL_FILES` base/small/medium | ✅ |
| `settings.ts` =「设置持久化（串行写）」 | `writeChain: Promise<void>` 串行链(:54)、tmp+rename 写(:69) | ✅ |
| `asr.ts` =「csgove 提取、WAV 归一化、VAD、本地/云端转写、取消」 | `normalizeWav`(:351)、`v >> 16`(:410)、`AbortSignal` 系列 | ✅ |
| `stagedDemos.ts` =「暂存 demo 清单与安全删除」 | `STAGED_DEMOS_MANIFEST`、`registerStagedDemo`/`cleanupStagedDemo`/`pruneStagedDemos` | ✅ |
| `overlay.ts` =「旧版悬浮层窗口 + 演示播放器（按真实时间推进）」 | `setInterval(tickSim, 1000/20)`(:271,348,373)、`Date.now()`(:179) | ✅（但见下「悬空代码」） |

**未收录进 §5.1/5.2/5.3 的 `src/` 文件**（文档表非穷举，列出供参考）：
`src/renderer/src/main.tsx`（18 行，§5.4 却引用它）、`src/renderer/src/env.d.ts`（11 行）、`src/renderer/src/assets/logo.png`（205,841 B）、`src/renderer/index.html`、`src/renderer/overlay.html`、`src/renderer/overlay-full.html`、`src/renderer/full-src/{main.ts,full.css}`、`src/renderer/overlay-src/{main.ts,overlay.css}`。

---

## 5.4 样式文件与加载顺序

**文档 §5.4（第 346–360 行）**：加载顺序 `hud.css → apple.css → apple-library.css → apple-detail.css → apple-settings.css → apple-transcript.css → apple-ai.css`，并给出 7 个文件行数。

**实际 `src/renderer/src/main.tsx:4-10`（原文）**

```ts
import './theme/hud.css'
import './theme/apple.css'
import './theme/apple-library.css'
import './theme/apple-detail.css'
import './theme/apple-settings.css'
import './theme/apple-transcript.css'
import './theme/apple-ai.css'
```

| 顺序 | 文件 | 实际行数 | 文档行数 | 差异 | 大小 | 判定 |
|---:|---|---:|---:|---:|---:|---|
| 1 | `theme/hud.css` | 4232 | 4,232 | 0 | 88,977 B | ✅ |
| 2 | `theme/apple.css` | 840 | 840 | 0 | 19,268 B | ✅ |
| 3 | `theme/apple-library.css` | 883 | 883 | 0 | 22,171 B | ✅ |
| 4 | `theme/apple-detail.css` | 1216 | 1,216 | 0 | 24,560 B | ✅ |
| 5 | `theme/apple-settings.css` | 737 | 737 | 0 | 18,798 B | ✅ |
| 6 | `theme/apple-transcript.css` | 964 | 964 | 0 | 23,704 B | ✅ |
| 7 | `theme/apple-ai.css` | 1199 | 1,199 | 0 | 28,302 B | ✅ |

补充核对：
- `theme/` 目录**只有这 7 个文件**，无新增、无缺失（`Get-ChildItem` 全列）。
- **加载顺序与文档逐字符一致**（7/7 同序）。
- `hud.css` 内**无 `@import`**（不存在隐蔽的二级加载）。
- 整个 renderer 只有 `main.tsx` 加载这 7 个；另两个旧入口 `overlay-src/main.ts`、`full-src/main.ts` 各自加载 `overlay.css` / `full.css`（旧悬浮层专用，与文档 §6.1「悬浮层 → overlay.html（原生 DOM，旧版）」相符）。
- 文档 §11.1 token 值抽查：`--bg-0..4 = #0a0a0c/#161618/#1e1e21/#262629/#303034` ✅；`--accent #0a84ff` / `--accent-strong #3f9cff` / `--accent-dim rgba(10,132,255,.16)` ✅；`--t #f5a623` / `--ct #5dade2` ✅；浅色 `#f2f2f7…#dcdce2` + `#007aff` ✅（`apple.css:8-40`、`:96-104`）。
- 文档 §11.2 动效约定抽查：卡片 hover `translateY(-4px)` ✅（`apple-library.css:329`）、press `scale(0.988)`（文档写 0.985，**轻微不符**）、按钮 press `scale(0.97)` ✅（`apple.css:460`）、导航 hover `translateX(2px)` ✅（`apple.css:318-322`）、ease `cubic-bezier(0.22,1,0.36,1)` ✅、`--r-sm/md/lg/xl = 10/14/20/24` ✅、`--titlebar-h: 56px` ✅。

---

## PARSER_VERSION

| 项 | 文档值 | 实际值 | 判定 |
|---|---|---|---|
| 值 | `9`（§7.3 第 466 行、「当前 **9**」） | `9` | ✅ |
| 行号 | `src/main/services/library.ts:164`（§8.3 第 497 行、§15.2 第 797 行） | **`library.ts:164`** | ✅ 精确命中 |

**证据**（`grep -n PARSER_VERSION src/`，10 处引用）：

```ts
// src/main/services/library.ts:161-164
// 解析器版本：解析逻辑变更（如击杀阵营实时跟踪）时 +1，旧详情缓存自动失效重解析
// v8: 修复控制器实体索引与 USER_INFO 偏移导致的选手错位与机器人污染，修正语音槽位
// v9: 收尾优化提升详情缓存版本，使旧缓存失效并按当前解析器重解析（本次未改解析逻辑）
const PARSER_VERSION = 9
```

引用点：`:376`（持久化写 `parserVersion`）、`:578/:598`、`:1191`（命中即返回）、`:1196/:1205/:1227`（不命中→重解析）、`:1323/:1341`（stale 判定）。**语义与文档 §7.3「与 `PARSER_VERSION` 不一致时自动重解析」一致。**

另外两个文档 §7.4 提到的版本常量也对得上：

| 常量 | 文档值 | 实际值 | 证据 |
|---|---|---|---|
| `VOICE_INDEX_CACHE_VERSION` | 2 | `2` | `voiceIndex.ts:20` |
| `COMPACT_PAD_SEC`（§4.2/AGENTS） | 0.3 | `0.3` | `asr.ts:120` |

---

## typecheck 实跑结果

```pwsh
PS> npm run typecheck
> cs2-demo-analyst@1.0.0 typecheck
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json
EXITCODE=0
```

| 项 | 结果 |
|---|---|
| 退出码 | **0（通过）** |
| 耗时 | **1.6 s**（`Measure-Command`，文档 §4.2 写「约 2 秒」→ ✅） |
| stderr / 告警 | 无（两个 tsc 均零输出） |
| 覆盖工程 | `tsconfig.node.json`（main+preload+shared+`electron.vite.config.ts`）、`tsconfig.web.json`（renderer src + overlay-src + `src/main/types/*.d.ts` + shared） |
| 严格度 | 两个工程均 `strict: true` + `noUnusedLocals` + `noUnusedParameters`（→ 未使用 import 会直接报错，意味着 §6.1 的「`overlay.ts` 仍被引用」为真） |

> `typecheck` 通过同时是一条**强证据**：`i18n/en.ts` 声明为 `Record<keyof ZhDict, string>`，任何 key 缺/多都会编译失败 —— 见下节。

---

## i18n key 对齐

| 项 | `zh.ts` | `en.ts` | 判定 |
|---|---|---|---|
| 文件行数（NL+1 口径） | 516 | 507 | ✅ 与文档 516/507 精确一致 |
| key 数量（顶层 `'x.y':`） | **490** | **490** | ✅ 完全对齐 |
| 重复 key | 0 | 0 | ✅ |
| 嵌套对象 | 0 | 0 | ✅ 扁平字典 |
| 差集 | **only-zh = 0，only-en = 0** | | ✅ |

**类型层强制**（比数数更可靠）：

```ts
// src/renderer/src/i18n/zh.ts:515,517
export const zh = { ... } as const
export type ZhDict = typeof zh

// src/renderer/src/i18n/en.ts:1,4
import type { ZhDict } from './zh'
export const en: Record<keyof ZhDict, string> = { ... }
```

> 因为 `en` 被标注为 `Record<keyof ZhDict, string>`，**少 key 或多 key 都会让 `npm run typecheck` 失败**。本次 typecheck 通过 ⇒ 「新增文案必须双份」这条约定在**编译期**被兜住，文档 §11.4 / AGENTS.md 的要求成立且已被机器保证。

其它核对：
- 代码里以字面量 `t('...')` 使用的 key 共 308 个，**全部**存在于字典（missing = 0）；其余 182 个通过 `t.t(...)` / 模板拼接使用（`SettingsPage` 大量使用 `t.t()`），非缺失。
- `i18n/index.tsx`（63 行 = 文档 63）导出 `I18nProvider` / `useT` / `useTKey` / `TKey` / `Lang` ✅，与 §5.3「`useT` / `useTKey`」一致。
- 文档 §11.4「地图名统一走 `formatMapName`」✅（`AiPage`/`DemoDetailPage`/`LibraryPage`/`TranscriptPage` 均 import）；「目录名走 `formatRootLabel`」⚠️ —— `formatRootLabel` 实际定义在 `pages/LibraryPage.tsx:31`（不是 `utils/format.ts`），`SettingsPage.tsx:6` 反向 import。约定成立，但归属位置与 §5.3 的 `format.ts` 描述冲突（同上文）。

---

## App.tsx 页面常驻/navSeq

### 页面常驻（`display` 切换不卸载）—— ✅ 成立

```tsx
// src/renderer/src/App.tsx:196-213（原文节选）
{/* 页面常驻（display 显隐而非卸载）：切换页面后保留原页面状态
    （选中的 demo、筛选、转写进度等不再丢失） */}
<div className={`page-stage ${route.page === 'library' ? 'active' : ''}`}>
  <LibraryPage demoId={route.demoId} onOpenDemo={...} onGoTranscript={...} />
</div>
<div className={`page-stage ${route.page === 'transcript' ? 'active' : ''}`}>
  <TranscriptPage initialDemoId={route.demoId} navSeq={navSeq} onOpenDemo={...} />
</div>
<div className={`page-stage page-stage-ai ${route.page === 'ai' ? 'active' : ''}`}>
  <AiPage onGoSettings={...} />
</div>
<div className={`page-stage ${route.page === 'settings' ? 'active' : ''}`}>
  <SettingsPage settings={settings} version={version} />
</div>
```

```css
/* src/renderer/src/theme/apple.css:358-374 */
.page-stage { display: none; min-width: 0; min-height: 0; }
.page-stage.active { display: block; animation: apple-page-in var(--dur-slow) var(--ease-out) both; }
.page-stage-ai.active { display: flex; flex: 1; flex-direction: column; height: 100%; }
```

- 4 个页面**同时挂载**在 DOM，只用 `.page-stage` / `.page-stage.active` 的 `display` 显隐切换 → **不卸载**，与 §11.3「`App.tsx` 用 `display` 切换，**不卸载**」一致 ✅。
- ⚠️ 文档写的类名是 `.page` / `fadeUp`，实际承载切换的是 **`.page-stage`**（`.page` 在现代码里只是各页的内层 padding 容器，且 `apple.css:218-224` 已把 `animation: none` 覆盖掉 `hud.css:244` 的 `fadeUp`）。**§11.3 的概念正确、class 名过时**。

### navSeq（`AGENTS.md §4.5` 有，`HANDOFF` 无）—— ✅ 代码成立，文档缺项

```tsx
// App.tsx:86-87
// 导航序号（navigate 每次 +1）：页面常驻下重复跳转同一 demo 时目标页也能感知
const [navSeq, setNavSeq] = useState(0)

// App.tsx:135-143
const navigate = useCallback((page: Page, demoId?: string) => {
  setRoute(...)
  // 导航序号：同一 demo 重复导航时也递增，让目标页能感知「再次跳转」并重新同步选中
  setNavSeq((s) => s + 1)
}, [])
```

```tsx
// TranscriptPage.tsx:31,36,114-115
navSeq,            // props
/** 导航序号（App navigate 每次 +1）：重复跳转同一 demo 时也重新同步选中 */
navSeq?: number
// navSeq 变化（重复导航到同一 demo）时也刷新详情
}, [demoId, navSeq])
```

| 项 | 文档 | 实际 | 判定 |
|---|---|---|---|
| 页面常驻不卸载 | HANDOFF §11.3 有 | 成立（`.page-stage` + `display`） | ✅ 概念一致 / class 名过时 |
| `navSeq` 机制 | **HANDOFF 全文 0 命中**；AGENTS.md §4.5 有 | `App.tsx:87,142` + `TranscriptPage.tsx:31,36,115` | ⚠️ **HANDOFF 缺项** |
| `navigate(page, demoId)` | AGENTS.md §4.5 | `App.tsx:135` | ✅ |
| 目标页 effect 依赖 `[initialDemoId, navSeq]` | AGENTS.md §4.5 | `TranscriptPage.tsx:115` 是 `[demoId, navSeq]`（`initialDemoId` 走 `:72-74` 单独 effect） | ⚠️ AGENTS.md 写法与实际略有出入 |
| 弹窗 `createPortal` 到 body | AGENTS.md §4.5 | `ui.tsx:910`（CustomSelect）、`AiPage.tsx:619`、`SettingsPage.tsx:150,365` | ✅ |

### 其它 UI 约定抽查（§11.3 / AGENTS §4.5）

| 约定 | 实际 | 判定 |
|---|---|---|
| 56 px 标题栏 + 左导航 | `--titlebar-h: 56px`、`--nav-w: 196px`（`apple.css:73-74`） | ✅ |
| 资料库卡片 24 px 圆角 | `--library-card-radius: 24px` | ✅ |
| 卡片无 T:CT 比分、日期+语音 Tag 在 date-row | `LibraryPage.tsx:895-898`（`.date-row` 内 `.date` + `voiceTag`）；`.mid` 里只有 `teamT`/`teamCT` 队名 Tag（`:959-960`，是**队名不是比分**） | ✅ 与「已删比分」一致 |
| 设置页单列分组行 | 7 个 `<SectionHead idx={1..7}>` + `.set-row` 单列，无二级导航 | ✅ |
| 标题栏真实 logo、无 CSS 占位 | `TitleBar.tsx:1` `import logoUrl from '../assets/logo.png'`；`apple.css:754-765` `.brand-logo{width:28px;height:28px;border-radius:8px}`；全 CSS **无** `.brand::before/::after` | ✅ |
| Avatar 有 url 显图 / 无则首字母 | `ui.tsx:382-430`（`objectFit:'cover'`、`width/height 100%`、`display:block`、`borderRadius:50%`） | ✅ |

---

## 判定为「文档已过时」的条目清单

> 分级：**P1 = 会误导后续 agent 做错事 / P2 = 描述不准确 / P3 = 缺项或表述粗糙**

### A. HANDOFF-2026-10-27.md 内部（共 5 条）

| # | 级别 | 位置 | 文档写的 | 实际 | 证据 |
|---|---|---|---|---|---|
| A1 | **P1** | §5.3 `utils/format.ts` 行 | 「时间/大小/地图名格式化」 | 仅 `formatMapName`（33 行）；`fmtTime/fmtTick/fmtBytes/fmtDate` 在 `components/ui.tsx:548-598`；`formatRootLabel` 在 `pages/LibraryPage.tsx:31` | grep `fmtTime` → `ui.tsx:548`；`format.ts` 全文 33 行 |
| A2 | P2 | §11.3 第 668 行 | 「`App.tsx` 用 `display` 切换」+ AGENTS 提 `.page` 的 `fadeUp` | 承载切换的是 **`.page-stage`** 类（`apple.css:358-374`）；`.page` 的 `animation` 已被 `apple.css:218-224` 覆盖为 `none` | `grep page-stage` 只命中 `apple.css`；`grep fadeUp` 只在 `hud.css`（被覆盖） |
| A3 | P2 | §4.2 命令表 | 列 6 条：`dev`/`typecheck`/`build`/`smoke`/`dist:zip`/`build-panorama` | `package.json` 实际 8 条，另有 `start`（=`npm run dev`）、`dist`（=`npm run dist:zip`）、`dist:portable`（`electron-builder --win portable`） | `package.json:10-19` |
| A4 | P3 | §5.3 表格 | 未收录 `main.tsx` / `env.d.ts` / `assets/logo.png` | 三者均存在（18 / 11 行；logo 205,841 B），且 §5.4 又用「`main.tsx` 加载顺序」引用 | `Get-ChildItem src/renderer/src` |
| A5 | P3 | §5.1 表格 | `types/deadem.d.ts` 行数为「—」 | 实际 83 行，非空文件 | `count('\n')+1 = 83` |

### B. HANDOFF 缺项（不错误，但接手者会缺信息，共 3 条）

| # | 级别 | 缺失内容 | 实际 | 备注 |
|---|---|---|---|---|
| B1 | P2 | `navSeq` 导航机制 | `App.tsx:87,142` + `TranscriptPage.tsx:31,36,115` | AGENTS.md §4.5 有，HANDOFF 0 命中 |
| B2 | P3 | `ErrorBoundary` / `app-loading` / `update-banner` | `App.tsx:20-71,161-168,175-185` | 都是防黑屏/升级提示的关键壳 |
| B3 | P3 | `src/renderer/overlay-full.html` + `full-src/`（全屏面板入口） | `electron.vite.config.ts:43-46` 注册了 3 个 renderer 入口（`index`/`overlay`/`overlay-full`）；§6.1 只提 `overlay.html` | `overlay.ts` 导出 `setFullPanel`/`getFullWindow` 与之配套 |

### C. AGENTS.md（**真正大面积过时的那份**，共 5 条）

> 虽然任务只要求核 HANDOFF，但 AGENTS.md 与新文档冲突会直接误导新会话，必须单列。

| # | 级别 | 位置 | 写的 | 实际 |
|---|---|---|---|---|
| C1 | **P1** | `AGENTS.md:55,57` | 「五页面：library/detail、transcript、**live**、ai、settings」「`pages/*.tsx` … / **LivePage**」 | **无 `LivePage`**：`NavRail.tsx:5` `type Page = 'library'\|'transcript'\|'ai'\|'settings'`（4 页）；`src/renderer/src` 下无任何 `*Live*` 文件；只有 `ui.tsx:74` 留了个未使用的 `IcLive` 图标 |
| C2 | **P1** | `AGENTS.md:33` | 打包产物 `CS2-Demo-Analyst-0.1.0-win64-portable.zip` | `package.json version = 1.0.0` ⇒ 实际产物名 `-1.0.0-`（make-zip.ps1 从 package.json 读版本） |
| C3 | **P1** | `AGENTS.md:37` | 开发参数含 `--vcon-mock` | `src/main/index.ts` 无 `--vcon-mock` 分支；`startVConsoleMock`（`vconsole.ts:235`）**无任何调用方**（dead code）。现存参数：`--route` `--ai-mock` `--overlay-demo` `--fullpanel-demo` `--transcribe` `--screenshot` `--shot-delay` `--eval-js` |
| C4 | P2 | `AGENTS.md:106` | 目标页 effect 依赖 `[initialDemoId, navSeq]` | 实际 `TranscriptPage.tsx:115` 为 `[demoId, navSeq]`；`initialDemoId` 走独立 effect（`:72-74`） |
| C5 | P3 | `AGENTS.md:107` | 「`.page` 有 fadeUp 动画 transform 会让 fixed 失效」 | `apple.css:218-224` 已 `animation: none`；当下真实原因仍是祖先 `transform` 风险，但 `fadeUp` 已不是活跃动画（结论仍建议 `createPortal`，只是理由过时） |

### D. 明确「不过时」的关键项（避免误伤，建议保留）

| 项 | 结论 |
|---|---|
| §4.1 版本表 11 项（Electron/React/TS/Vite/electron-vite/electron-builder/`@deademx/*`/Node） | **全部一致** |
| §5.1/§5.2/§5.3 共 32 个带行数的文件 | **32/32 行数精确一致**（NL+1 口径） |
| §5.4 CSS 7 文件行数 + 加载顺序 | **7/7 一致 + 顺序逐字相同** |
| `PARSER_VERSION = 9` @ `library.ts:164` | **值与行号都对** |
| §6.2 IPC 通道（63 条） | **63 注册 / 63 列出，双向差集为空** |
| §6.3 `MainEvent`（21 条） | **21/21 完全一致** |
| `npm run typecheck` | **通过，1.6 s** |
| `@deademx/* = 3.4.1` | **一致**（R5「最新 4.0.2」属外部信息，本次未联网验证） |
| §11.1 tokens / §11.5 标题栏 logo 已删 `::before/::after` | **一致** |

### E. 本次无法核验 / 不在本任务范围

| 项 | 原因 |
|---|---|
| §4.2「`npm run build` 约 1 秒」「`dist:zip` 约 20 秒」 | 任务禁跑 build/dist |
| §4.4 构建后自检期望值（`asar 15141999`、`brand-logo true`） | 属产物核验（核验 C 范围），且禁读 `dist/` |
| §5.5 HUD 资源（xml/js/css/vpk 大小行数） | 核验 C 范围 |
| §2 / §7 的绝对路径、`settings.json`、`library/index.json` | 核验 B 范围 |
| R5「deadem 最新 4.0.2」 | 需联网，未查 |

---

## 附：本次核验执行的只读命令清单（可复现）

```pwsh
# 版本（三处交叉：package.json 声明 / lockfile / 已安装）
python -c "import json; j=json.load(open('package-lock.json',encoding='utf-8')); ..."
Get-Content node_modules/electron/package.json -Raw | ConvertFrom-Json   # 只读

# 行数（正确口径）
python -c "print(open(F,encoding='utf-8').read().count(chr(10))+1)"

# 结构
Get-ChildItem -Recurse -File src | %{ $_.FullName.Replace((Get-Location).Path+'\','') }
Select-String -Path src/renderer/src/theme/*.css -Pattern 'page-stage'
Select-String -Path src/main/index.ts -Pattern "ipcMain\.handle\('([^']+)'"
Select-String -Path src/main/services/library.ts -Pattern 'PARSER_VERSION'

# 唯一允许的构建类命令
npm run typecheck     # exit 0, 1.6s
```

*报告生成：verifier-code / 2026-10-27。全程只读；本文件是本次唯一新建的文件。*
