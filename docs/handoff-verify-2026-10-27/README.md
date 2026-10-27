# HANDOFF-2026-10-27 交接文档核验总报告

> 核验对象：`docs/HANDOFF-2026-10-27.md`（990 行 / 49,091 B，2026-10-27 生成）
> 核验时间：2026-10-27 17:15–17:50（Asia/Shanghai）
> 核验方式：Agent Teams 三线并行只读核验（Lead + 3 个 verifier），**未启动 CS2、未改任何游戏文件、未改任何 src 代码、未 build/打包**
> 工作区基线：`branch=frontend-apple`，`HEAD=5a10f62`，`git status` 仅 `M AGENTS.md` + 未跟踪文档

---

## 0. 一句话结论

**这份交接文档是可信的，可以照它开工** —— 代码类事实 39/39 文件行数精确命中、版本表 11/11 一致、IPC 契约零差集、便携包 SHA256 逐字符吻合。

**但它在「Steam 风险面」上高估了干净程度，且漏掉了一个已经发生的破坏**：`gameinfo.gi` 虽无 dsh 注入行，**字节层面已不是 Steam 官方文件**（LF vs CRLF，差 890 B），且可证明是本项目 `injector.ts` 的换行 bug 造成的 —— 这才是 R2「Steam 每次要求验证完整性」的真正根因，文档未记录。

---

## 1. 三份分项报告

| 报告 | 覆盖范围 | 行数 | 结论 |
|---|---|---|---|
| [code-build.md](code-build.md) | 代码 / 构建 / 依赖版本 / PARSER_VERSION / typecheck / i18n | 420 | HANDOFF 代码章节**未过时**；过时的是 `AGENTS.md` |
| [cs2-steam.md](cs2-steam.md) | CS2 游戏目录 / Steam manifest / addon / settings | 338 | **发现 3 个文档未记录的高风险事实** |
| [docs-artifacts.md](docs-artifacts.md) | 产物 / 文档清单 / 脚本 / HUD 源 / progress.md | 332 | 产物哈希全对；`dist/build-stage/` 与 31 个脚本漏登记 |

---

## 2. 🔴 高优先级发现（3 条，均为文档未记录）

### F1. `gameinfo.gi` 字节层面已被破坏 —— R2 的真正根因

| 判据 | 磁盘实际 | Steam 官方 manifest（depot 2347770 / buildid 26144732） |
|---|---|---|
| 大小 | 25,166 B | 26,056 B |
| 行尾 | 纯 LF（`\r` 计数 = 0，`\n` 计数 = 890） | CRLF |
| SHA1 | `ad658bd842cc10a4e510c4a8502563fc8fc0e17c` | `e345a2edbb075e32bac502f39fe5e81488f85477` |

**证明（Lead 已独立复算）**：把磁盘文件 `\n → \r\n`，大小变为 **26,056 B**，SHA1 变为 **`E345A2EDBB075E32BAC502F39FE5E81488F85477`** —— 与官方 manifest 逐字节吻合。差额 890 B 正是 890 个换行丢掉的 `\r`。

**根因已定位（`src/main/services/injector.ts`）**：

```ts
// injector.ts:112-129  addSearchPaths()
lines.splice(index, 0, ...)
return { text: lines.join('\n'), changed: true }   // ← 128 行：硬编码 LF，丢弃原换行风格

// injector.ts:132-139  removeSearchPaths(text, newline)
return { text: kept.join(newline), ... }          // 看似保留风格，但 newline 由「当前文本」探测
                                                   // 此时文件已是 LF → 永远回不去 CRLF
```

`readTextPreservingStrict` 明明探测了 `newline`，但 `addSearchPaths` 没用。因此 **inject 一次 → clean 一次 = CRLF 永久降级为 LF**，且 `cleanAll` 无法还原。

**mtime 佐证**：`2026-10-26T19:40:26Z`（本地 10-27 03:40:26）正好是 `console_log.txt` 记录的 inject 会话 `03:37:47 → 03:40:25` 退出后 1 秒 —— 即 `cleanAll()` 的回写时刻。

**为什么这解释了用户反复抱怨的现象**：应用自检 `officialClean`（`injector.ts:343`）只查「有无 dsh 行 / 备份 / 本项目 VPK」，**不比对 manifest 哈希**，所以它报「官方纯净」；但 Steam 一旦做哈希校验就会命中 **1 个文件不匹配** → 提示验证完整性。`progress.md` 本轮三十三「已验证 cleanAll 恢复后 gameinfo.gi hash 不变」是循环论证：比的是被自己改过的文件。

> 交叉验证：核验 B 比对了 1,534 个官方 `game\` 文件的大小，**只有 gameinfo.gi 一个不匹配**，其余全部对得上 buildid 26144732 → 说明游戏安装本身没被动过，问题纯粹是这一个文件的换行。

### F2. 游戏目录 addon 是「Shift+F2 会坏」的旧版，且后果比文档写的重

| | 游戏目录 | 项目包内 |
|---|---|---|
| `huddemocontroller.vxml_c` | **4,176 B**（2026-10-18） | **5,035 B**（2026-10-20） |
| 原生节点 | **缺** `PlayerList` / `RoundMenu` / `TimeScale` / `message_arrow` | Valve 现行 60 个 id 全保留 + 5 个 `Dsh*` |

文档只写「addon 是旧版，下次播放会被覆盖」，没写**这意味着 Shift+F2 现在就是坏的**。旧版正是 `progress.md` 本轮三十四修好的那一版。项目侧修复本身有效（HUD 源 XML 与 Valve 反编译布局 id 集合比对：55 个 Valve id 一个不缺），只是没部署到游戏目录。

### F3. `steam_appid.txt` 实际存在（文档 2.4 明确写「不存在」）

`D:\11-Steam\...\game\bin\win64\steam_appid.txt`，5 B，内容 `730\n\0`，mtime `2026-10-27T08:51:42Z`。

- 不在任何官方 manifest 内；`console_log.txt` 显示是完美平台（`-pwa`）直接 spawn `cs2.exe` 生成的。
- **本项目 addon/inject/native 模式同样直接 spawn `cs2.exe`，但清理逻辑只在 tools 模式删它**（`live.ts:712` / `:853`）→ 每播一次都会再生成一次。

---

## 3. 🟡 中优先级：文档需修正的条目

| # | 文档位置 | 文档写的 | 实际 |
|---|---|---|---|
| M1 | §10.6 | `huddemocontroller` 须保留 `Death` 节点 | `death` **不在** `huddemocontroller`，而在另一个文件 `huddemoplayback.vxml_c`（本项目未覆盖）；Valve 当前布局里也没有。属文档记录错误，不影响 Shift+F2 |
| M2 | §10.7 | HUD 与当前 CS2（10-23 更新）兼容性未验证 | 10-23 更新**未改 Demo UI 布局**：现行 VPK 内 `vxml_c` 仍 5,026 B，与 10-20 存档仅差 35 B 且全在图标哈希。真正风险是旧版 addon，不是版本不兼容 |
| M3 | §7.1 | `cs2.voiceHud = true`（列为生效值） | **死字段**：`types.ts` 无此字段、全 src 无读写；实际开关是 `cs2.hudMode` |
| M4 | §2.1 / §4.3 | 只警示旧 zip 与旧 `setup.exe` | 漏了 `dist/build-stage/`（2026-09-11 旧产物：app.asar 14,658,767 B、VPK **20,041 B**，共约 325 MiB）和 `dist/latest.yml`（仍把 2026-09-08 旧 setup.exe 当最新发布物） |
| M5 | 附录 A | 21 个脚本 | 21 个全在，0 缺失；但**反向漏记 31 个已入库脚本 + `scripts/lib/` 2 个依赖**，含 `check-tick-entity.mjs`（AGENTS.md §4.1 当验证脚本引用）、`verify-normal-play.mjs`（17,756 B，最大） |
| M6 | R7 | 两个「本轮二十九」（L41 / L680） | 行号正确；但另有第二对「本轮二十」（L250 / L279）。另 `progress.md` 尾部 10 行是 LF-only（其余 677 行 CRLF） |
| M7 | R11 | 根目录杂物「可清理，先确认无引用」 | `shot-lib.png` / `shot-web.png` 是 **git tracked**（需 `git rm`），且 `scripts/web-preview-main.js:12` 仍引用 `shot-web.png` → **有引用** |
| M8 | §0.2 | `progress.md`「有乱码」 | 已不成立：严格 UTF-8 合法、无 U+FFFD |
| M9 | §7.3 | backup 每 demo 保留最近 2 份 | 实际 8 份（含 4 个已删除 demo 的历史备份，无害） |
| M10 | §13 / 2.4 | `steam_appid.txt` 不存在 | **存在**（见 F3） |

---

## 4. 🟢 低优先级：HANDOFF 自身的 5 处小瑕疵

| # | 位置 | 问题 |
|---|---|---|
| L1 | §5.3 | `utils/format.ts` 被写成「时间/大小/地图名格式化」，实际只有 `formatMapName`（33 行）；`fmtTime/fmtBytes/fmtDate/fmtTick` 在 `components/ui.tsx:548-598` |
| L2 | §5.3 | 未收录 `main.tsx`（§5.4 又用「`main.tsx` 加载顺序」引用它）、`env.d.ts`、`assets/logo.png` |
| L3 | §4.2 | 命令表漏 `start` / `dist` / `dist:portable` 三个 npm script |
| L4 | §4.5 / 全文 | **`navSeq` 全文 0 命中**（只有 AGENTS.md 记得）。实际已实装：`App.tsx:87,142` + `TranscriptPage.tsx:31,36,115` |
| L5 | §5.1 | `deadem.d.ts` 行数留「—」，实际 83 行 |

---

## 5. ✅ 完全吻合、可直接信任的部分

| 核验项 | 结果 |
|---|---|
| §5.1/§5.3 的 39 个文件行数 | **39/39 精确相等，0 偏差** |
| §4.1 依赖版本表 | **11/11 一致**（Electron 43.4.1 / React 19.2.8 / TS 5.9.3 / Vite 7.3.6 / electron-vite 5.0.0 / electron-builder 26.15.3 / @deademx 3.4.1 / Node 24.12.0） |
| §5.4 七个 CSS 行数 + import 顺序 | 逐字相同 |
| `PARSER_VERSION = 9` | 确实在 `library.ts:164` |
| §6.2 / §6.3 IPC 契约 | 63 个通道 + 21 个 MainEvent，**双向差集为空** |
| `npm run typecheck` | **通过**，exit 0，1.6 s |
| i18n key | zh 490 / en 490，双向差集 0，且由 `Record<keyof ZhDict, string>` 编译期强制 |
| 便携 zip SHA256 | **逐字符吻合** `1A3A6966…91E1`，157,234,487 B（Get-FileHash + Node crypto 双算） |
| asar | 15,141,999 B / 2026-10-25 02:04:42 / §4.4 自检串三字段全对 |
| zip 内 app.asar / VPK / addon 哈希 | 与磁盘一致 → **发布物没错配** |
| gameinfo.gi 的 dsh 行 | 0 条（唯一 dsh 命中是 L747 `TimeSlicedShadowMapRendering`，与文档一致） |
| overrides / 备份 / cfg / log | 目录空（递归 0 文件）/ 无 `.dsh_inject.bak` / 无 `dsh-play.cfg` / 无 `dsh_hud.log` |
| CS2 版本 | buildid 26144732 / LastUpdated 2026-10-22T23:15:12Z / cs2.exe mtime 2026-10-15T11:58:58Z 全对 |
| 资料库 | 4 条全 `ready`，detail 缓存全部 `parserVersion=9` |
| voices 缓存 | 22 个目录（179 个 WAV，27.4 GB） |
| 附录 E 根一层目录树 | **零差异**（28 项一一对应） |
| HUD 源四件套 | 大小全对（8.8 KB / 11.8 KB / 0.4 KB / 2.5 KB；VPK 24,158 B；addon 5 文件） |

---

## 6. 方法论坑（给下一个核验者）

**HANDOFF 的行数口径是 `'\n' 数量 + 1`（= `wc -l` + 1）**。用 `ReadAllLines` 会每文件少 1 行；用本机 PowerShell 5.1 的 `Get-Content`（默认 GBK/936）会因中文注释吞换行而**再少 1–84 行**（`parser.ts` 实测 1484 vs 真实 1569，18/39 文件受影响）。

正确复算方式：

```pwsh
python -c "print(open('f',encoding='utf-8').read().count(chr(10))+1)"
```

若用 `(Get-Content x).Count` 会误报「文档过时 85 行」—— 本次已交叉验证排除该误判。

---

## 7. 下次开工的执行顺序（有依赖）

> **阻断级（前两步不做，任何播放都会重新污染或直接踩坑）**

1. **把 `settings.cs2.hudMode` 从 `inject` 改为 `addon`（或 `off`），重启应用。**
   验收：`settings.json` 里 `"hudMode": "addon"`。
2. **修掉 `injector.ts:128` 的 `lines.join('\n')`** → 改为按 `tf.newline` 回写（`addSearchPaths` 需接收 `newline` 参数，`removeSearchPaths` 同理）。
   不修 = 每次 inject 都永久降级 CRLF，cleanAll 无法还原。修完必须 `npm run typecheck` + 重新打包（`out/main/index.js` 目前含旧逻辑）。
3. **【用户手动，一次】让 Steam 把 `gameinfo.gi` 修回官方版本**：Steam 库 → CS2 右键 → 属性 → 已安装文件 → 验证游戏文件完整性。
   验收：26,056 B / SHA1 `e345a2edbb075e32bac502f39fe5e81488f85477` / `\r\n` 计数 890。
   备选（不想跑 Steam 校验）：退出 Steam → 备份 → 把 `gameinfo.gi` 做 LF→CRLF 转换 → 启动 Steam 观察。**不要**用旧备份覆盖，**不要**整目录删 `overrides`。
4. **【用户手动】删除 `game\bin\win64\steam_appid.txt`**（5 B，非官方文件）；并考虑让 `scheduleSessionCleanup` 的 `finish()` 也删它（代码改动，需另开任务）。
5. **验证 R10 已修**：用 addon 模式播一次 → 核对 addon 的 `vxml_c` 从 4,176 B 变为 **5,035 B**；`~` 控制台看 `[DshVoiceHud]` 报错；按 **Shift+F2** 确认原生进度条能打开。
6. **每次测试后**重跑「设置 → Steam 安全自检」，并人工复核 4 项（无 dsh 行 / 无备份 / overrides 无本项目 VPK / cfg+log 已清）。
7. **建议（非阻断）**：清理 8 月历史残留 `game\csgo\dsh_vfy.log`（90 KB）与 `game\csgo_addons\dsh_test\`（4 文件）。
8. **文档同步**：把本报告的 F1/F2/F3 与 M1–M10 回写进 `docs/HANDOFF-2026-10-27.md`。

---

## 8. 本轮未做 / 未验证

- 未跑 `npm run build` / `dist:zip`（按项目铁律，交付构建由后续轮次做）。
- 未做任何真机测试（CS2 启动 / HUD 显示 / Shift+F2 / Steam 完整性提示）—— 按项目铁律由用户操作。
- 未验证 R5「deadem 最新 4.0.2」（需联网查 npm registry）。
- 未验证 R4（回合胜负推导 vs `CCSTeam.m_iScore` 偏差）—— 需要跑解析脚本。
- 未修任何代码（本轮定位为**只读核验**）。
