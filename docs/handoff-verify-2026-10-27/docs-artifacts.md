# 核验 C：产物 / 文档清单 / 脚本 / HUD 源

> 核验对象：`docs/HANDOFF-2026-10-27.md`（49,091 B / 990 行，2026-10-27 17:05）
> 核验方式：**只读**。仅使用 `Test-Path` / `Get-Item` / `Get-FileHash` / `Get-ChildItem` / `git ls-files` / `git status` / `read` / `grep` / `node -e`（只读 fs）；未改动 `dist/`、`out/`、`node_modules/`、`test-data/`，未跑 `npm run build` / `dist:zip`，未 `git add` / `commit`。
> 执行时间：2026-10-27 17:1x–17:4x（Asia/Shanghai）
> 说明：本目录下的 `huddemocontroller.vxml_c`、`dsh_voice.*_c`、`valve_live_huddemocontroller.vxml_c`、`.tmp\` 是**同期另一位核验 teammate 的解包证据文件**（2026-10-27 17:37/17:38 落盘），不是本报告产物；本报告只写了 `docs-artifacts.md` 这一个文件。

---

## 结论摘要（最关键 6 条）

1. **便携 zip 的 SHA256 完全吻合**：`1A3A6966574ABA3AA95BD6F9BE04D4C5AC2F8A44AA5E412FA2F1874410AB91E1`。`Get-FileHash -Algorithm SHA256` 与 Node `crypto` 两条独立路径各算一次，结果一致；字节数 157,234,487 B 也与文档逐字节相同。**附录 D 的这条记录可直接信任。**
2. **asar 三件套全部吻合**：15,141,999 B / 2026-10-25 02:04:42 / 文档 §4.4 自检命令实跑输出 `asar 15141999 brand-logo true logo true`（与期望字符串逐字一致）。
3. **`dist/` 里有一份文档完全没写的旧产物**：`dist/build-stage/`（2026-09-11 残留，`app.asar` 14,658,767 B、静态 VPK 20,041 B，均非当前版本）。文档 §4.3 只警示了旧 zip 与旧 `setup.exe`，**没有提这一份**，存在被误当“解包目录”使用的风险。
4. **附录 A 的 21 个脚本 100% 存在，0 缺失**；但反向漏记 **31 个已入库脚本 + `scripts/lib/` 2 个依赖**。其中 `check-tick-entity.mjs` 被 `AGENTS.md` §4.1 当作验证脚本引用，`verify-normal-play.mjs`（17,756 B）是 `scripts/` 里最大的一个 —— 新 Agent 会以为它们不存在。
5. **HUD 原生节点：源码层完全保留（结论：安全）**。`assets/panorama/layout/hud/huddemocontroller.xml` 与当前 Valve 反编译布局做 id 集合比对：Valve 的 **55 个 id 一个不缺**，项目只多 5 个 `Dsh*`。`PlayerList / RoundMenu / PlayerControls / CameraButton / message_arrow` 全部在。**但文档 10.6 写的 `Death` 是错的**：`huddemocontroller` 里没有 `id="Death"`，Valve 当前布局里也没有；`Death` 实际存在于 Valve 的另一个文件 `huddemoplayback.vxml_c`（本项目未覆盖它）。
6. **R7 只记了一半**：确实有两个「本轮二十九」（L41、L680），但还有第二对「本轮二十」（L250、L279）；另外 `progress.md` 尾部 10 行是 LF-only（其余 677 行 CRLF），按 CRLF 读取会把 L680 整段吞成一行。

---

## 产物核对（asar / 便携 zip + SHA256 / 旧 setup.exe）

### 1) `dist\win-unpacked\resources\app.asar`

| 项 | 实际值 | 文档值 | 判定 | 证据 |
|---|---|---|---|---|
| 存在性 | 存在（`Test-Path` True） | 存在 | ✅ | — |
| 字节数 | **15,141,999 B** | 15,141,999 B（§2.1 / 附录 D / §4.4） | ✅ 逐字节一致 | `Get-Item` |
| mtime | 2026-10-25 02:04:42（UTC 2026-10-24T18:04:42Z） | 2026-10-25 02:04 | ✅ | `Get-Item` |
| §4.4 自检 | `asar 15141999 brand-logo true logo true` | 期望同串 | ✅ 三个字段全对 | `node -e "…readFileSync('dist/win-unpacked/resources/app.asar')…"` |
| SHA256 | `449704B9E2DE1D4BA6288637BD3BCBB68504860C396F020730AACAC798241681` | 文档未记 asar 哈希 | ⚪ 无对照（新增基准值） | `Get-FileHash` |

### 2) `dist\CS2-Demo-Analyst-1.0.0-win64-portable.zip`

| 项 | 实际值 | 文档值 | 判定 | 证据 |
|---|---|---|---|---|
| 存在性 | 存在 | 存在 | ✅ | — |
| 字节数 | **157,234,487 B** | 157,234,487 B（§1 / §2.1 / 附录 D） | ✅ 逐字节一致 | `Get-Item` |
| 体积口径 | 149.95 MiB / 157.23 MB(10⁶) | §1「150.0 MB」、§2.1「157,234,487 B」 | ✅ 两者是同一文件的不同口径（`make-zip.ps1` 用 `/1MB` 打印 MiB） | 计算 |
| mtime | 2026-10-25 02:04:54 | 附录 D 未记 zip mtime（§「本轮二十九」记 2026-10-25 02:04） | ✅ | `Get-Item` |
| **SHA256** | **`1A3A6966574ABA3AA95BD6F9BE04D4C5AC2F8A44AA5E412FA2F1874410AB91E1`** | **`1A3A6966574ABA3AA95BD6F9BE04D4C5AC2F8A44AA5E412FA2F1874410AB91E1`** | ✅ **完全吻合** | `Get-FileHash -Algorithm SHA256` + Node `crypto.createHash('sha256')` 双算 |

**zip 内容与 `win-unpacked` / `assets` 的一致性交叉验证**（把 zip 内条目解到 `%TEMP%` 后算哈希，不改动 `dist/`）：

| 条目 | zip 内 SHA256 | 磁盘同名文件 SHA256 | 判定 |
|---|---|---|---|
| `resources/app.asar` | `449704B9E2DE1D4BA6288637BD3BCBB68504860C396F020730AACAC798241681` | 同 | ✅ 相同 |
| `resources/panorama/dsh_voice_override.vpk` | `3CB05C4CB6A0DF56E5738C54A4B7612F5C8DDE71C0078980E2712E2B4737E1CA` | `assets/panorama/dsh_voice_override.vpk` 同 | ✅ 相同 |
| `resources/panorama/addon/.../huddemocontroller.vxml_c` | `7E1D0FA96479CF63794287BBC39531898FB69B0B65CF187B65C2C8E123AA0229` | `assets/panorama/addon/.../huddemocontroller.vxml_c` 同 | ✅ 相同 |

zip 共 **34 个条目**，内层根目录统一为 `CS2-Demo-Analyst\`（与 `make-zip.ps1` 的 stage 逻辑一致）。

### 3) `dist\CS2-Demo-Analyst-1.0.0-setup.exe`（旧包，勿分发）

| 项 | 实际值 | 文档值 | 判定 | 证据 |
|---|---|---|---|---|
| 存在性 | 存在 | 存在 | ✅ | — |
| mtime | **2026-09-08 23:03:23** | 2026-09-08（§2.1 / §4.3.4 / R13） | ✅ 同日 | `Get-Item` |
| 字节数 | 96,674,640 B = 96.67 MB(10⁶) = 92.20 MiB | 「96.6 MB」（§2.1） | ⚠️ 取整口径不一致（96.67 → 96.6，或应为 92.2 MiB） | 计算 |

> 附注：`dist\` 中另有 `CS2-Demo-Analyst-1.0.0-setup.exe.blockmap`（102,274 B，2026-09-08）、`dist/latest.yml`（360 B，2026-09-08，`version: 1.0.0`，`path`/`url` 都指向 **setup.exe**）、`dist/builder-debug.yml`（887 B）。**这三个文件文档 §2.1 都没有登记**；`latest.yml` 尤其值得注意 —— 它仍然把 2026-09-08 的旧安装包当作“最新发布物”。

### 4) `dist/build-stage/`（文档完全未记录）

| 项 | 实际值 | 文档值 | 判定 |
|---|---|---|---|
| 目录 | 存在，mtime 2026-09-11 20:28:02 | 无任何记载 | ❌ 文档缺失 |
| `resources/app.asar` | 14,658,767 B（≠ 当前 15,141,999 B），2026-09-11 20:28:00 | — | ❌ 旧版残留 |
| `resources/panorama/dsh_voice_override.vpk` | **20,041 B**（≠ 当前 24,158 B） | — | ❌ 旧版残留（无 `addon/` 子目录） |
| 总体积 | 341,197,525 B（≈325 MiB） | — | 占磁盘 |

### 5) 其他产物路径

| 路径 | 实际 | 判定 |
|---|---|---|
| `dist/win-unpacked/CS2 Demo Analyst.exe` | 235,574,272 B，2026-10-25 02:04:43 | ✅ |
| `dist/win-unpacked/resources/panorama/dsh_voice_override.vpk` | 24,158 B（= assets 版哈希相同） | ✅ |
| `dist/win-unpacked/resources/panorama/addon/dsh_voice_hud/` | 5 个文件（addoninfo 71 B + 4 个 `*_c`） | ✅ |
| `assets/logo/csicon-512.png` 与 `src/renderer/src/assets/logo.png` | 均 205,841 B、SHA256 相同、PNG IHDR 512×512 bitDepth 8 colorType 6（RGBA） | ✅ 文档「512×512 RGBA」成立 |
| `build/icon.ico` / `build/icon-256.png` | 77,134 B / 50,678 B | ✅ |
| `D:\...-backups\2026-10-21-working\`（§2.2） | 3 个文件齐全：`…working-2026-10-21.zip` 156,998,008 B、`…source-working-2026-10-21.zip` 10,121,813 B、`RESTORE.md` 615 B | ✅ |

---

## 文档清单核对（表格）

### docs\

| 路径 | 实际 | 文档值 | 判定 |
|---|---|---|---|
| `docs/HANDOFF-2026-10-27.md` | 存在，49,091 B / 990 行，2026-10-27 17:05 | 本文 | ✅ |
| `docs/DEVELOPMENT.md` | 存在，5,146 B / 82 行 | 存在（§0.2、§2.6） | ✅ |
| `docs/GUIDE.md` | 存在，5,383 B / 115 行 | 存在（§2.6） | ✅ |
| `docs/frontend-apple/shots/` | 存在，**79 个 PNG**（`frontend-apple/` 本身无散落文件） | 存在（§2.6、附录 C） | ✅ |
| `docs/review-2026-10-18/REVIEW.md` | 存在，21,621 B / 297 行 | 存在 | ✅ |
| `docs/review-2026-10-18/FINDINGS.md` | 存在，22,884 B / 341 行 | 存在 | ✅ |
| `docs/review-2026-10-18/PLAN.md` | 存在，10,537 B / 219 行 | 存在 | ✅ |
| `docs/review-2026-10-18/CS2-UPDATE-IMPACT.md` | 存在，9,202 B / 173 行 | 存在 | ✅ |
| `docs/review-2026-10-18/D1-VERIFY.md` | 存在，5,858 B / 116 行 | 存在 | ✅ |
| `docs/review-2026-10-18/coverage.md` | 存在，5,803 B / 78 行 | 存在 | ✅ |
| `docs/review-2026-10-18/shots/` | 存在，29 个 PNG | 存在（§2.6） | ✅ |
| `docs/screenshots/` | 存在，6 个 PNG | 存在（§2.6 旧版截图） | ✅ |
| `docs/review-2026-10-18/README.md` | **存在，518 B / 10 行** | **文档 §2.6 / 附录 C 未列** | ❌ 实际有、文档没写 |

### 仓库根

| 路径 | 实际 | 文档值 | 判定 |
|---|---|---|---|
| `AGENTS.md` | 12,637 B，mtime 2026-10-27 17:03 | 存在 | ✅ |
| `DESIGN.md` | 3,659 B | 存在 | ✅ |
| `PRODUCT.md` | 1,728 B | 存在 | ✅ |
| `progress.md` | 103,296 B / 687 行 | 存在 | ✅ |
| `findings.md` | 22,644 B | 存在 | ✅ |
| `task_plan.md` | 5,176 B | 存在（「早期计划，已过时」） | ✅ |
| `research-voice-decode.md` | 10,662 B | 存在 | ✅ |
| `README.md` / `README.en.md` | 7,525 B / 7,303 B | 存在（附录 E） | ✅ |
| `LICENSE` / `package.json` / `package-lock.json` / `.gitignore` / `electron-builder.yml` / `electron.vite.config.ts` / `tsconfig{,.node,.web}.json` | 全部存在 | 存在（附录 E） | ✅ |
| 文档 §2.7 `.tmp-cdp` 8 个点名脚本 | `cdp.cjs`、`launch-packaged.cjs`、`launch-real.cjs`、`launch-plain.cjs`、`kill-app.cjs`、`procs.cjs`、`hash.cjs`、`crop.cjs` 全部存在 | 存在 | ✅ |

### 版本控制状态（供交叉印证）

```
git branch --show-current  -> frontend-apple
git log --oneline -1       -> 5a10f62 docs: record the real titlebar icon and this build
git status --short         ->  M AGENTS.md
                              ?? docs/HANDOFF-2026-10-27.md
                              ?? docs/handoff-verify-2026-10-27/   ← 本次核验新建，属预期
```

文档 §3.3 / §16 写的「应只有 `M AGENTS.md` 与 `?? docs/HANDOFF-2026-10-27.md`」在本次核验前**完全正确**；第 3 条是本轮核验的目录，交付前若要保持洁净可删。

---

## 附录 A 脚本清单（存在 / 缺失）

**结论：文档点名的 21 个脚本 100% 存在，0 缺失。**

| # | 脚本 | 实际大小 | 判定 |
|---|---|---|---|
| 1 | `build-panorama.mjs` | 10,780 B | ✅ |
| 2 | `make-zip.ps1` | 1,422 B | ✅ |
| 3 | `cdp-shot.ps1` | 1,567 B | ✅ |
| 4 | `cdp-probe.ps1` | 3,987 B | ✅ |
| 5 | `verify-all-demos.mjs` | 2,253 B | ✅ |
| 6 | `verify-kill-teams.mjs` | 2,690 B | ✅ |
| 7 | `verify-stats-economy.mjs` | 2,971 B | ✅ |
| 8 | `verify-pistol-round.mjs` | 1,459 B | ✅ |
| 9 | `dump-round-events.mjs` | 2,256 B | ✅ |
| 10 | `dump-rounds.mjs` | 1,948 B | ✅ |
| 11 | `dump-voice.mjs` | 1,320 B | ✅ |
| 12 | `dump-voice-full.mjs` | 1,270 B | ✅ |
| 13 | `decode-voice-own.mjs` | 2,819 B | ✅ |
| 14 | `extract-voice-own.mjs` | 6,197 B | ✅ |
| 15 | `test-hud-logic.mjs` | 3,540 B | ✅ |
| 16 | `test-inject.mjs` | 3,493 B | ✅ |
| 17 | `test-static-vpk.mjs` | 3,070 B | ✅ |
| 18 | `test-session-vpk.mjs` | 3,114 B | ✅ |
| 19 | `simulate-voicehud-session.mjs` | 3,066 B | ✅ |
| 20 | `publish-release.mjs` | 4,206 B | ✅ |
| 21 | `serve.mjs` | 1,688 B | ✅ |

**文档写了但实际不存在：无（0 个）。**

**实际存在但文档没写：31 个顶层文件 + `scripts/lib/` 2 个依赖**（`scripts/` 共 57 个顶层文件、2 个子目录文件，全部已被 git 跟踪）：

| 类别 | 未登记的脚本 |
|---|---|
| 较大/常被引用 | `verify-normal-play.mjs`（17,756 B，scripts 最大）、`dump-events.mjs`（1,953 B）、`dump-events2.mjs`（3,966 B）、`check-tick-entity.mjs`（3,082 B，**AGENTS.md §4.1 明确当验证脚本用**） |
| 语音/WAV 实验 | `wav-convert.mjs`、`wav-energy.mjs`、`xcorr.mjs`、`slice-wav.mjs`、`fix-normalize.mjs`、`convert-int32.mjs`、`check-int32.mjs`、`check-bitlayout.mjs`、`compare-wavs.mjs`、`compare-own-csgove.mjs`、`decode-wasm-own.mjs`、`test-ogg-decode.mjs`、`parse-test.mjs` |
| 逆向/解包 | `asar-decrypt.mjs`、`asar-find-playdemo-call.mjs`、`capture-cs2-cmdline.mjs`、`find-position.mjs`、`find-position2.mjs`、`check-devil-slices.mjs`、`repro-app-bug.mjs` |
| 图标/打包辅助 | `make-logo.ps1`、`png-to-icon.ps1`、`png-to-transparent-icon.ps1` |
| 旧 Web 版 | `web-preview-main.js` |
| 非脚本文件 | `release-notes.md`（3,421 B）、`capture-cs2-cmdline-result.txt`、`verify-normal-play-result.txt`（后两个 `.gitignore` 覆盖） |
| **子目录** | `scripts/lib/EmscriptenWasm.js`（82,130 B）、`scripts/lib/opus-decoder.js`（104,034 B）—— **附录 A 与附录 E 都没提 `scripts/lib/`** |

> `diag-*.mjs` 通配符覆盖的 5 个实际文件（`diag-inject-matrix`、`diag-play-hud`、`diag-postverify-prep`、`diag-run-full`、`diag-single-mode`）与文档一致 ✅。

---

## R11 根目录杂物

| 项 | 实际 | 文档值 | 判定 | 备注 |
|---|---|---|---|---|
| `NUL` | **存在**，261,964 B，mtime 2026-08-20 23:10:10，属性 `Archive` | 存在 | ✅ | ⚠️ `Test-Path -LiteralPath` **返回 False**（Windows 保留设备名）；须用 `Get-ChildItem -Force` 或 `[IO.File]::Exists('\\?\…\NUL')` 才能看到。已被 `.gitignore:11` 忽略 |
| `true\` | **存在**，1 个文件 `true\315d52…bf5\electron-v43.4.1-win32-x64.zip`，150,154,788 B（143.2 MiB） | 存在（「误建目录，可删」） | ✅ | 已被 `.gitignore:9 true/` 忽略 |
| `shot-lib.png` | **存在**，639,967 B | 存在 | ✅ | **git 已跟踪**（不是忽略文件） |
| `shot-web.png` | **存在**，757,808 B | 存在 | ✅ | **git 已跟踪**；且 `scripts/web-preview-main.js:12` 仍把它当默认输出路径 → 文档「先确认无引用」的提醒是对的，**确有引用** |

> 补充：真正需要 `git rm` 的只有 `shot-lib.png` / `shot-web.png`（两个 tracked 文件），`NUL` 与 `true/` 已被 ignore，直接删文件即可。

---

## progress.md 最近 5 轮 + R7 核实

### R7：两个「本轮二十九」——**成立**，但文档只记了一半

```
L41 : ## 本轮二十九（收尾补丁：设置页目录名本地化、转写/AI 地图名统一、语音索引孤儿缓存清理、AI 数据说明修正）✅
L680: ## 本轮二十九（2026-10-25）：标题栏换回真实应用图标
```
- 文档 R7 说的行号 **41 与 680 完全正确** ✅
- **但还有第二对真重复**：`L250` 与 `L279` 都是「本轮二十」（前者「击杀流视觉锐化重构」，后者「全应用下拉栏统一…」），文档未登记 ❌
- 带「补N」后缀的重号（本轮十三×4、十四×5、十五×3）是编号风格，非错误
- 另：文件共 49 个二级标题、687 行；`本轮` 系列 41 个。**尾部 10 行（L678–687）是 LF-only，其余 677 行是 CRLF** → 任何按 `\r\n` 切分的读取器都会把 L680 起的整段并成一个 600+ 字符巨行（已复现）。

### 顶部 60 行「最近 5 轮真实改动」（L3–L49 实测）

| 轮次 | 行 | 真实改动（要点） |
|---|---|---|
| 本轮三十四 | L3 | **修复 Shift+F2 原生 Demo UI 打不开**：旧 `huddemocontroller.xml` 基于 2026-08-24 布局，缺 `PlayerList/RoundMenu/PlayerControls/CameraButton/message_arrow` → 用当前 Valve 布局重建，仅追加 `dsh_voice` 样式/脚本、`DshSpeakingRow` snippet、`DshVoiceDock/List`；重编静态 VPK 24,158 B；已复制到 `dist/win-unpacked/resources/panorama/`，应用已重启；**注意便携 zip 尚未重打包（当轮）** |
| 本轮三十三 | L9 | 按用户要求恢复 Inject 旧功能；`settings.cs2.hudMode=inject`；`writeTextPreserving` 失败清理 `gameinfo.gi.dsh.tmp`；`cleanAll` 后 `gameinfo.gi` hash 不变 |
| 本轮三十二 | L16 | 修「游戏内 HUD 语音不显示」：addon 会话数据必须走 `resourcecompiler` 编译（手写 48 B 头只适用于 VPK）；新增 `compileVjsResource()` |
| 本轮三十一 | L23 | `PARSER_VERSION 9` 导致 detail 全失效；`doParse` 先回读磁盘旧 detail 保 `voice`；覆盖前备份到 `library/backup/`（每 demo 留 2 份） |
| 本轮三十 | L32 | 「全部解析」无动画 / 重新扫描卡顿：新增 `zip-cache.json`（按路径+size+mtime 失效）、`readFileAsync`、`library:scan` 进度事件、`Ring.indeterminate` |

> 文档 §0.2 说「顶部 1–60 行 = 最近 5 轮（34→30）」，实测 **L3–L49 正好是 34→30 五轮**；L50 起是「本轮二十八」、L60 是「本轮二十七」——即 60 行其实覆盖到 7 轮开头，措辞略宽但不算错。

### 文档 §0.2 称 progress.md「有乱码」——**不成立（已过时）**

- 严格 UTF-8 校验通过（`UTF8Encoding($false,$true)` 无异常）
- U+FFFD 计数 **0**；`锟/烫/屯/Ã¤/â€/ï¼` 等 mojibake 特征计数 **0**
- 唯一命中：`L611`「`'涓浗'→中文、'鉁?'→移除按钮文案`」——这是**引用历史乱码字符串做说明**，不是现存乱码

---

## 附录 E 目录树差异

### 根一层：**零差异** ✅

排除 `node_modules/out/dist/.git/.tmp-cdp/test-data/research` 后，磁盘 28 个顶层条目与附录 E 的 28 条**一一对应**：
- 文档有、实际没有：**0**
- 实际有、文档没写：**0**

### 两层/更深：漏了 5 处

| 实际存在 | 文档状态 | 判定 |
|---|---|---|
| `scripts/lib/EmscriptenWasm.js`（82,130 B）、`scripts/lib/opus-decoder.js`（104,034 B） | 附录 A / 附录 E 都没提 | ❌ 漏记（opus 解码是语音实验链路的实际依赖） |
| `src/renderer/full-src/{full.css, main.ts}` | §5.3 未列、附录 E 未列 | ❌ 漏记（旧 Web 版源码，已入库） |
| `src/renderer/overlay-src/{overlay.css, main.ts}` | §5.3 未列（§6.1 只提 `out/renderer/overlay.html`） | ❌ 漏记 |
| `docs/review-2026-10-18/README.md`（518 B） | §2.6 / 附录 C 未列 | ❌ 漏记 |
| `dist/build-stage/` | 文档全篇未提（`dist` 被排除在目录树外，但 §4.3 也没警示） | ❌ 见产物核对第 4 节 |

> 附录 E 的 `huddemocontroller/`、`assets/`、`build/`、`src/`、`docs/` 描述与实际一致（`huddemocontroller/current/` 4 个文件 + 3 个顶层 `*_c` 全在）✅。`true/`、`NUL`、`shot-*.png` 也都在树里 ✅。

---

## HUD 源文件与原生节点

### 源文件大小 / 行数（§5.5）

| 文件 | 实际 | 文档值 | 判定 |
|---|---|---|---|
| `assets/panorama/layout/hud/huddemocontroller.xml` | **8,993 B = 8.78 KiB / 130 行**（130 个 LF，文件以 LF 结尾；混合 CRLF：113 个 CRLF + 17 个 lone-LF） | 8.8 KB / **131 行** | ⚠️ 大小 ✅（8.8 KB 口径），**行数 +1**（131 是把末尾空串也算一行） |
| `assets/panorama/scripts/hud/dsh_voice.js` | **12,046 B = 11.76 KiB / 360 行**，LF-only | 11.8 KB / **361 行** | ⚠️ 大小 ✅，**行数 +1**（同口径偏差） |
| `assets/panorama/scripts/hud/dsh_voice_data.js` | **426 B = 0.42 KiB / 15 行** | 0.4 KB | ✅ |
| `assets/panorama/styles/hud/dsh_voice.css` | **2,586 B = 2.53 KiB / 107 行** | 2.5 KB | ✅ |
| `assets/panorama/addon/dsh_voice_hud/` | **5 个文件**：`addoninfo.txt` 71 B、`huddemocontroller.vxml_c` **5,035 B**、`dsh_voice.vjs_c` 12,910 B、`dsh_voice_data.vjs_c` 1,290 B、`dsh_voice.vcss_c` 4,634 B | 5 个编译产物 | ✅ |
| `assets/panorama/dsh_voice_override.vpk` | **24,158 B**（VPK v2：tree 213 B / fileData 23,869 B / otherMD5 48 B，4 个条目） | 24,158 B | ✅ 精确 |

> 行数 +1 是系统性的（两个文件都 +1，来源都是「末尾换行后多算一个空行」），不影响内容正确性。

### 原生节点核对（文档 §10.6）

方法：提取 `id="…"` 集合作差，对照 `huddemocontroller/current/huddemocontroller.decompiled.xml`（Source 2 Viewer 20.1 从当前 `pak01_dir.vpk` 反编译）。

| 节点（文档 10.6 点名） | 项目 `huddemocontroller.xml` | Valve 当前反编译布局 | 判定 |
|---|---|---|---|
| `PlayerList` | ✅ L57（`<Panel id="PlayerList" …>`） | ✅ L44 | ✅ 保留 |
| `RoundMenu` | ✅ L58 | ✅ L45 | ✅ 保留 |
| `PlayerControls` | ✅ L98 | ✅ L85 | ✅ 保留 |
| `CameraButton` | ✅ L112 | ✅ L99 | ✅ 保留 |
| `message_arrow` | ✅ L100、L104（`message_arrow.vsvg` 图标 ×2） | ✅ L87、L91 | ✅ 保留 |
| **`Death`** | ❌ **没有 `id="Death"`**；只有 `L109` 的 `deathnotice/domination.vsvg`（属 `NextEventButton`） | ❌ **当前 `huddemocontroller` 布局里也没有**（反编译 XML 与 `huddemocontroller.vxml_c` 二进制均搜不到） | ❌ **文档写错**：`Death` 只出现在 Valve 的**另一个文件** `huddemoplayback.vxml_c` 的编译字符串表（offset 1662），说明它属于播放 HUD 而非 demo controller；本项目不覆盖该文件 |

**id 集合全量比对（最强证据）**：

```
Valve 当前布局 id 数            = 55
项目 XML id 数                  = 60
Valve 有而项目没有的 id          = 0     ← 一个都不缺
项目有而 Valve 没有的 id         = DshRowAvatar, DshRowMuteBadge, DshRowName, DshVoiceDock, DshVoiceList
```

即：`huddemocontroller.xml` = **Valve 当前布局 100% 节点 + 5 个 Dsh 扩展**，结构（`<root>`/`<styles>`/`<scripts>`/`<snippets>`/`<CSGOHudDemoController>`）标签闭合正常（各 1 对）。**Shift+F2 所需的原生节点在源码层面是齐的。**

### 编译产物侧

| 项 | 结果 |
|---|---|
| `addon/.../huddemocontroller.vxml_c` | 5,035 B vs Valve 原始 5,026 B（+9 B，增量与「3 个 include + 1 个 snippet + 5 个 id」的扩展一致） |
| `dsh_voice_override.vpk` 内嵌 vxml_c | 5,035 B，与 addon 版**仅差 8 字节**（内嵌 search-path `csgo_addons/dsh_build_35396_1792526949576` vs addon 版 `…52596_1792526998764`）→ 两者同源、无「旧版覆盖新版」问题 |
| `dsh_voice.vjs_c` | 含 `DshVoiceList`×3、`DshSpeakingRow`、`DshRowMuteBadge`、`DshRowAvatar`、`_SpeakingSlots`、`_ShowRow`、`GetDemoControllerState`×6 → 与 `dsh_voice.js` 源一致（50 ms 轮询 `$.Schedule(0.05, _Poll)` + 750 ms 慢轮询） |
| 字节级 grep 的**局限** | 编译后的 `.vxml_c` 用 token 压缩字符串表：Valve 原始文件能直接搜到 `PlayerList`（offset 2376），但 addon 版只搜到后缀 `List`（offset 2093）与 `RoundMenu`（2098）。**所以不能用字节 grep 证明 addon 里每个 id 都在**；权威做法仍是 progress.md「本轮三十四」那样用 VRF/Source2Viewer 反编译核对。本次只读核验不做反编译。 |

---

## 按严重度排序的「文档与磁盘不一致」清单

### 🔴 高（会误导操作 / 误用产物）

1. **`dist/build-stage/` 未登记**：2026-09-11 的整套旧解包产物（`app.asar` 14,658,767 B、VPK **20,041 B**，无 addon 子目录），文档 §2.1/§4.3 只警示旧 zip 与旧 `setup.exe`。误把它当 `win-unpacked` 会用到 9 月的 HUD（旧 VPK 更小）。
2. **附录 A 漏记一半脚本**：31 个已入库脚本 + `scripts/lib/` 2 个依赖未列，其中 `check-tick-entity.mjs` 是 `AGENTS.md` §4.1 明确指定的验证脚本、`verify-normal-play.mjs` 是最大的验证脚本（17,756 B）。新 Agent 会重复造轮子或以为工具不存在。
3. **§10.6 的 `Death` 节点是错的**：`huddemocontroller.xml` 与 Valve 当前布局都没有 `id="Death"`（`Death` 在另一个文件 `huddemoplayback.vxml_c`）；`progress.md` 本轮三十四的原文核对清单里也**没有** `Death` —— 属文档作者追加时引入。按 `Death` 去找会白找一场。

### 🟡 中（信息不准，可能造成判断偏差）

4. **R11 少一句关键说明**：`shot-lib.png` / `shot-web.png` 是 **git 跟踪文件**（需 `git rm`），且 `scripts/web-preview-main.js:12` 仍引用 `shot-web.png` 作默认输出 —— 「先确认无引用」是对的，但结论应写明「有引用」。
5. **R7 只记一对重复**：除 L41/L680「本轮二十九」外，还有 L250/L279「本轮二十」；且 `progress.md` 尾部 10 行是 LF-only（CRLF 混用），按 CRLF 读取会把 L680 整段合成一行。
6. **`dist/latest.yml`（360 B）仍指向 2026-09-08 的 `setup.exe`**（`version: 1.0.0`、sha512、size 96,674,640），文档未提；任何「按 latest.yml 发布」的流程都会发错包。
7. **附录 E / §2.6 漏 4 处**：`scripts/lib/`、`src/renderer/full-src/`、`src/renderer/overlay-src/`、`docs/review-2026-10-18/README.md`。
8. **§0.2 说 `progress.md`「有乱码」已不成立**：严格 UTF-8 合法、无 U+FFFD；唯一命中是 L611 引用历史乱码作说明。

### 🟢 低（口径 / 取整 / 计数）

9. **行数系统性 +1**：XML 131 vs 实际 130、`dsh_voice.js` 361 vs 实际 360（把末尾换行后的空串算成一行）。
10. **MB 口径混用**：zip「150.0 MB」= 149.95 MiB（十进制 157.23 MB）；`setup.exe`「96.6 MB」= 96.67 MB(10⁶) / 92.20 MiB。同一文档内 MiB 与 MB 交替，读者易误算。
11. `dist/builder-debug.yml`（887 B）、`setup.exe.blockmap`（102,274 B）未登记（无功能影响）。
12. §3.3 的「工作区应只有 2 项」在本次核验后变成 3 项（多了 `?? docs/handoff-verify-2026-10-27/`）—— 属预期，交付前删除即可。

---

### 已核实为「完全一致、可直接信任」的项（无需复查）

- 便携 zip：157,234,487 B + SHA256 `1A3A6966…91E1`（双算法）
- `app.asar`：15,141,999 B + 2026-10-25 02:04 + §4.4 自检串
- `setup.exe`：2026-09-08 旧包，勿分发
- 附录 A 点名的 21 个脚本：全部存在
- 根一层目录树：附录 E 零差异
- HUD 源四件套存在、大小与「24,158 B VPK」「5 个 addon 产物」全部对得上
- 原生节点在**源码**层面 55/55 齐全（`Death` 除外，见 🔴3）
- `assets` 与 `dist/win-unpacked` 与便携 zip 三处 VPK/asar/addon 哈希一致（发布物未错配）
