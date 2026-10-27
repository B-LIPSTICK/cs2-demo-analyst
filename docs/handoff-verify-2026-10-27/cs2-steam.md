# 核验 B：CS2 游戏目录 / Steam 风险面

> 核验对象：`docs/HANDOFF-2026-10-27.md` 第 2.4 / 10 / 13 章 + 附录 D
> 核验时间：2026-10-27 17:20–17:45（Asia/Shanghai）
> 核验方式：**纯只读**（`Get-Item` / `Get-Content` / `Select-String` / `Get-FileHash` / `Test-Path` / `Get-ChildItem` / 只读解析 Steam depot manifest 与 `pak01_dir.vpk`）。
> 全程**未启动 CS2、未写游戏目录任何文件、未改 gameinfo.gi、未碰 steam_appid.txt / pak01_*.vpk / bin\*.dll / _toolsettings**。
> 核验时进程状态：Steam 运行中（PID 31536）；**CS2 未运行**；CS2 Demo Analyst 未运行。

---

## 结论摘要

1. **「dsh 注入面」确实干净，但「字节级」不干净 —— 这是本次核验最重要的发现。** `gameinfo.gi` 无任何 dsh SearchPath 行、无 `gameinfo.gi.dsh_inject.bak`、`overrides\` 完全为空、`dsh-play.cfg` / `dsh_hud.log` 均不存在。**但**该文件是 **25,166 B / LF 行尾**，而 Steam 官方 depot manifest（depot 2347770）要求 **26,056 B / CRLF / SHA1 `e345a2ed…`**；把它 LF→CRLF 转换后**逐字节精确还原官方 SHA1**。也就是说：**当前 gameinfo.gi 与 Steam 官方文件不一致（差 890 字节，正好是 890 个换行少掉的 `\r`）**。
2. **这个不一致是本项目自己的 inject/clean 循环造成的，而且可复现、可证明。** `injector.addSearchPaths()` 用 `lines.join('\n')` 写回（`src/main/services/injector.ts:128`），直接抹掉 CRLF；后续 `removeSearchPaths()` 只按当前探测到的换行风格（此时已是 LF）回写，**永远不会把 CRLF 还回去**。用官方 CRLF 文本完整模拟「注入 2 行 → 清理」后，得到的字节与磁盘上的 25,166 B 文件**完全一致**（SHA1 `ad658bd8…`）。`gameinfo.gi` 的 mtime `2026-10-26T19:40:26Z`（本地 2026-10-27 03:40:26）正好落在 `console_log.txt` 记录的 inject 启动 `03:37:47 → 03:40:25` 退出后 1 秒 —— 即上一次 inject 会话 `cleanAll()` 的回写时刻。
3. **因此 R2（Steam 完整性回归）并没有真正解除，只是从「有 dsh 行」降级成「无 dsh 行但哈希不符」。** 应用的 `officialClean` 判定只看「有没有 dsh 行 / 备份 / 本项目 VPK」，**不比对 Steam manifest 哈希**，所以它现在会报「官方纯净」，但这个结论**高估了实际干净程度**。`progress.md` 本轮三十三「已验证 cleanAll 恢复后 gameinfo.gi hash 不变」是**循环论证**：比的是「已被改成 LF 的文件」自己，不是 Steam 官方哈希。
4. **R10 仍然成立且比文档描述的更严重。** 游戏目录 addon `huddemocontroller.vxml_c` = **4,176 B（2026-10-18）**，包内 = **5,035 B（2026-10-20）**。进一步做了节点级比对：**4,176 B 旧版里根本没有 `PlayerList` / `RoundMenu` / `TimeScale` / `message_arrow`**（只有 `DshSpeakingRow` + `Settings` / `Restart` / `TrueView`），正是 `progress.md` 本轮三十四修复的「Shift+F2 打不开」那版；5,035 B 新版含 `RoundMenu` / `TimeScale` 等。**即当前游戏目录里的 addon 是「Shift+F2 会坏」的旧版**，不是「略有差异」。
5. **R1 仍然成立。** `settings.json` 的 `cs2.hudMode` 仍是 **`inject`**，`cs2.playMode` = `native`，`cs2.voiceHud` = `true`。**下一步点「CS2 中播放」= 再次走 inject 分支**（备份 → 写 2 个 VPK 到 overrides → 在 `gameinfo.gi` L17 前插 2 行 SearchPath）→ 又一次走上面第 2 条的破坏路径，且这次会把「已经不干净的 25,166 B 文件」当作备份。
6. **额外发现（文档未记录）：`game\bin\win64\steam_appid.txt` 实际存在**（5 B，内容 `730\n\0`，mtime `2026-10-27T08:51:42Z` = 本地 16:51:42），而文档 2.4 明确写「**不存在**」。它不在任何官方 manifest 里；`console_log.txt` 显示该时刻是完美平台（`-pwa`）直接 spawn `cs2.exe`。**本项目在 addon/inject/native 模式同样是直接 spawn `cs2.exe`，而清理逻辑只在 tools 模式删它**（`live.ts:712` / `:853`），因此这个文件**下次用应用播放还会再生成、且不会被清掉**。

### 现在是否可以安全让 Steam 正常启动？

**可以启动，但「干净」只是表面干净。** 判据：

| 判据 | 状态 |
|---|---|
| gameinfo.gi 有 dsh SearchPath 行 | ❌ 无（0 条） |
| gameinfo.gi.dsh_inject.bak | ❌ 无 |
| overrides 有本项目 VPK | ❌ 无（目录为空） |
| 会话残留 dsh-play.cfg / dsh_hud.log | ❌ 无 |
| **gameinfo.gi 与 Steam 官方 manifest 字节一致** | **⚠️ 不一致（25,166 B vs 26,056 B；SHA1 不符）** |
| **bin\win64\steam_appid.txt（非官方文件）** | **⚠️ 存在（5 B）** |

结论：**Steam 正常启动不会立刻出问题（当前无 dsh 注入残留），但「验证游戏文件完整性」一旦被触发，gameinfo.gi 会被判定为 1 个文件不匹配并被重新下载 —— 这正是用户反复抱怨的那个现象。** 建议：**在修掉 injector 的换行 bug 之前，不要再用 inject 模式做真机测试**；并且让用户手动跑一次 Steam「验证游戏文件完整性」把 gameinfo.gi 修回官方 CRLF 版本，再确认 Steam 不再提示。

---

## 2.4 游戏目录状态

CS2 根：`D:\11-Steam\steamapps\common\Counter-Strike Global Offensive`（存在，`game\bin\win64\cs2.exe` 可访问）

| 项目 | 文档值（HANDOFF 2.4） | 实际值 | 判定 |
|---|---|---|---|
| `game\csgo\gameinfo.gi` 存在 | 存在 | 存在 | ✅ 一致 |
| `gameinfo.gi` 大小 | 25,166 B | **25,166 B** | ✅ 一致 |
| `gameinfo.gi` mtime | `2026-10-26T19:40:26Z` | **`2026-10-26T19:40:26Z`**（本地 2026-10-27 03:40:26） | ✅ 一致 |
| `gameinfo.gi` 含 dsh SearchPath 行 | 0 条 | **0 条** | ✅ 一致 |
| `gameinfo.gi` 唯一 dsh 命中 | `TimeSlicedShadowMapRendering` | **仅 L747 `"TimeSlicedShadowMapRendering" "1"`**（全文件 dsh 命中数 = 1） | ✅ 一致 |
| `gameinfo.gi.dsh_inject.bak` | 不存在 | **不存在** | ✅ 一致 |
| `gameinfo.gi.dsh.tmp` | 未提及 | 不存在 | ✅ 干净 |
| `game\csgo\overrides\` | 存在但为空 | **存在**（CreationTime `2026-10-20T16:45:12Z`），**递归文件数 = 0** | ✅ 一致 |
| `game\csgo_addons\dsh_voice_hud\` | 存在 | **存在**（5 个文件） | ✅ 一致 |
| 其中 `huddemocontroller.vxml_c` | 4,176 B（旧版） | **4,176 B**，mtime `2026-10-18T18:37:17Z` | ✅ 一致（R10 成立） |
| `game\csgo\cfg\dsh-play.cfg` | 应已清理 | **不存在**（cfg 目录下 `dsh*` 文件数 = 0） | ✅ 一致 |
| `game\csgo\dsh_hud.log` | 应已清理 | **不存在** | ✅ 一致 |
| `steam_appid.txt` | **不存在** | **存在**：`game\bin\win64\steam_appid.txt`，5 B，`730\n\0`，mtime `2026-10-27T08:51:42Z` | ❌ **不一致（文档过时/已被破坏）** |
| `game\csgo\demos\` | 官方 demo 目录 | 存在，当前 **0 个文件** | ⚠️ 存在但空（文档未说明空） |

> 补充：`gameinfo.gi` 无 BOM（首字节 `0x22`）、全文件**无一个 `\r`**、共 890 个 `\n`、890 行；`SearchPaths` 块内只有 `Game_LowViolence` / `Game csgo` / `Game core` / `Mod csgo` / `AddonRoot` / `OfficialAddonRoot`，**没有任何 `Game csgo/overrides/...` 行**。

---

## gameinfo.gi 详解

**基本信息**

| 项 | 值 |
|---|---|
| 路径 | `D:\11-Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\gameinfo.gi` |
| 大小 | 25,166 B |
| mtime (UTC) | 2026-10-26T19:40:26Z（本地 2026-10-27 03:40:26） |
| 行数 | 890（890 个 `\n`，**0 个 `\r`**，即纯 LF） |
| BOM | 无（首 4 字节 `22 47 61 6D` = `"Gam`） |
| SHA256 | `E5CF35F3CA46591D0558A019015EC89F4F5C7AE642354A24E83B27A12C9AE7A1` |
| SHA1 | `ad658bd842cc10a4e510c4a8502563fc8fc0e17c` |

**dsh 命中情况**

- 全文件对 `dsh` 做不区分大小写匹配：**命中数 = 1**，位于 **L747**：`"TimeSlicedShadowMapRendering"	"1"` —— 与文档「唯一 dsh 命中是 TimeSlicedShadowMapRendering」**完全一致**。
- 用应用自己的正则复核（`injector.ts:29` `GAME_DSH_RE = /^\s*Game\s+[^\r\n]*\bdsh/im`）：**匹配 0 条** → 应用自检会正确判为「无 dsh 行」。
- 用 `SEARCH_RE`（本项目两条 overrides 行）复核：**匹配 0 条**。
- `BASE_GAME_RE`（注入锚点）匹配 1 处：**L17 `\t\t\tGame\tcsgo`** —— 下次 inject 就会插在它前面。
- `SearchPath` 关键字：全文件只出现在 **L13 `SearchPaths`**（块声明），**没有第二处 `SearchPath` 条目**。

**★ 关键发现：与 Steam 官方 manifest 不一致（LF vs CRLF）**

从 `D:\11-Steam\depotcache\2347770_67499503218971311.manifest`（depot 2347770，即 `buildid 26144732` 对应的已安装版本）解析出的官方条目：

| 字段 | 官方 manifest | 磁盘实际 | 判定 |
|---|---|---|---|
| 大小 | **26,056 B** | 25,166 B | ❌ 差 890 B |
| SHA1（存档副本 A） | `3efc93b8c6a7d352944c1b4d6a4e53a5cf00905a` | — | — |
| SHA1（当前副本 B） | `e345a2edbb075e32bac502f39fe5e81488f85477` | `ad658bd842cc10a4e510c4a8502563fc8fc0e17c` | ❌ 不符 |

**证明（三步，全部可复算）**

1. 把磁盘文件做 `\n → \r\n`：大小 **25,166 + 890 = 26,056**，SHA1 = **`e345a2edbb075e32bac502f39fe5e81488f85477`** → **与官方 manifest 副本 B 完全一致**。
2. 拿「官方 CRLF 文本」应用本项目的 `addSearchPaths`（`split(/\r\n|\n/)` → 插两行 → **`join('\n')`**）：得到 25,257 B、**无任何 `\r\n`**、含 2 条 dsh 行。
3. 再应用 `removeSearchPaths`（移除两条 dsh 行，按当前探测到的换行 LF 回写）：得到 **25,166 B / SHA1 `ad658bd8…`** → **与磁盘文件逐字节相同**。

> 即：**当前磁盘上的「干净」gameinfo.gi 正是「官方文件被本项目 inject 过一次、再被 cleanAll 还原」的产物。** 它不含 dsh 行，但**永远回不到官方字节**。mtime 也吻合：`console_log.txt` 显示 inject 模式启动 `2026-10-27 03:37:47`（`-insecure -consolelog dsh_hud.log +exec dsh-play.cfg`）、进程 `03:40:25` 退出；文件 mtime 为 `03:40:26` —— 退出后 1 秒由会话清理回写。

**代码定位（供核验 A / 修复参考）**

- `src/main/services/injector.ts:112-129` `addSearchPaths()`：`lines.splice(...)` 之后 `return { text: lines.join('\n') }` —— **硬编码 `\n`，丢弃原换行风格**（`readTextPreservingStrict` 明明探测了 `newline`，但此处没用）。
- `src/main/services/injector.ts:132-139` `removeSearchPaths(text, newline)`：`newline` 由「当前文本」推断，此时已是 LF → 回写 LF。
- 已核对打包产物 `out/main/index.js`（2026-10-24 18:04）中的实现与源码**一致**（仍是 `lines.join("\n")`），非「源码已修但未打包」的情况。
- `injector.ts:343-344` `officialClean = gameinfoExists && !gameinfoHasDsh && !backupExists && !overridesHasProjectVpk` —— **不含 manifest 哈希比对**，所以现在会误报「官方纯净」。

---

## overrides 与备份文件

| 项 | 文档值 | 实际值 | 判定 |
|---|---|---|---|
| `game\csgo\overrides\` 是否存在 | 存在 | 存在 | ✅ |
| 目录内条目数（含隐藏） | 空 | **0** | ✅ |
| 递归文件数 | 空 | **0** | ✅ |
| 含 `dsh_voice_override.vpk` | 无 | **无** | ✅ |
| 含 `dsh_voice_session.vpk` | 无 | **无** | ✅ |
| 含本项目之外第三方 VPK | 未提 | **无** | ✅ |
| 目录 CreationTimeUtc | — | `2026-10-20T16:45:12Z` | 记录 |
| 目录 LastWriteTimeUtc | — | `2026-10-26T19:40:26Z` | 与 gameinfo.gi 同一秒（cleanAll 删 VPK 时更新） |

| 备份/临时文件 | 文档值 | 实际值 | 判定 |
|---|---|---|---|
| `game\csgo\gameinfo.gi.dsh_inject.bak` | 不存在 | **不存在** | ✅ |
| `game\csgo\gameinfo.gi.dsh.tmp` | 未提 | 不存在 | ✅ |
| 全盘 `gameinfo.gi.dsh*` 残留（CS2 根递归 5 层） | — | **0 个** | ✅ |

> 注意：`overrides\` 目录本身**创建于 2026-10-20 16:45:12Z（本地 10-21 00:45）**，说明历史 inject 确实创建过它；现在内容为空 —— 按项目硬约束「绝不整目录删 overrides」，当前保留目录是符合约定的正确状态。

---

## addon 新旧版对比（游戏目录 vs 项目 assets）

**A. 文件清单与大小对照**（游戏目录 = `game\csgo_addons\dsh_voice_hud\`；项目 = `assets\panorama\addon\dsh_voice_hud\`）

| 文件 | 游戏目录 | mtime (UTC) | 项目 assets | mtime (UTC) | 大小 | 内容 |
|---|---|---|---|---|---|---|
| `addoninfo.txt` | 71 B | 2026-10-18T18:37:17Z | 71 B | 2026-10-20T20:09:59Z | 相同 | **完全相同**（SHA256 一致） |
| `panorama\layout\hud\huddemocontroller.vxml_c` | **4,176 B** | 2026-10-18T18:37:17Z | **5,035 B** | 2026-10-20T20:09:59Z | **不同** | **旧版（R10）** |
| `panorama\scripts\hud\dsh_voice.vjs_c` | 12,910 B | 2026-10-18T18:37:17Z | 12,910 B | 2026-10-20T20:09:59Z | 相同 | 仅 build tag 差 13 字节（内嵌编译目录名） |
| `panorama\scripts\hud\dsh_voice_data.vjs_c` | **201,727 B** | 2026-10-20T19:17:09Z | 1,290 B | 2026-10-20T20:09:59Z | 不同 | **正常**：游戏目录里是上次会话注入的真实数据，项目里是模板 |
| `panorama\styles\hud\dsh_voice.vcss_c` | 4,634 B | 2026-10-18T18:37:17Z | 4,634 B | 2026-10-20T20:09:59Z | 相同 | 仅 build tag 差 13 字节 |

合计：游戏目录 5 文件 / 223,518 B；项目 5 文件 / 20,340 B（差在 `dsh_voice_data.vjs_c` 的会话数据）。

**B. 关键文件哈希**

| 文件 | SHA256 |
|---|---|
| 游戏目录 `huddemocontroller.vxml_c`（4,176 B） | `F4C8E9408C7C81CCC12733D08B39EFA7D8781B98BA9B65E10D692F9E28CEC5AD` |
| 项目 `huddemocontroller.vxml_c`（5,035 B） | `7E1D0FA96479CF63794287BBC39531898FB69B0B65CF187B65C2C8E123AA0229` |
| `assets\panorama\dsh_voice_override.vpk`（24,158 B） | `3CB05C4CB6A0DF56E5738C54A4B7612F5C8DDE71C0078980E2712E2B4737E1CA` |
| 静态 VPK SHA1 / VPK 头 | `sig=0x55aa1234 ver=2 treeSize=213 fileData=23,869 otherMD5=48`，**4 条目，CRC 全部 OK** |

**C. 结构级比对（比大小更能说明问题）**

把能拿到的四个 `huddemocontroller.vxml_c` 做「原生节点存在性」比对（编译后的 Panorama 资源里节点 ID 以明文字符串表存在）：

| 构建 | 大小 | `PlayerList` | `RoundMenu` | `TimeScale` | `message_arrow` | `DshSpeakingRow` |
|---|---|---|---|---|---|---|
| **游戏目录（旧，2026-10-18）** | 4,176 B | ❌ | ❌ | ❌ | ❌ | ✅ |
| **项目 assets（新，2026-10-20）** | 5,035 B | ⚠️见下 | ✅ | ✅ | ❌ | ✅ |
| Valve 现行（从 `pak01_504.vpk` 提取） | 5,026 B | ✅ | ✅ | ✅ | ✅ | ❌ |
| `huddemocontroller\current\`（2026-10-20 存档） | 5,026 B | ✅ | ✅ | ✅ | ✅ | ❌ |

> 说明：编译后的字符串表存在截断/共享前缀（例如 `PlayerList` 在 5,035 B 版中与前一个字符串共享尾部），因此「子串命中」不完全等价于节点缺失。改用**反编译 XML 比对**更可靠：

| 比对 | 结果 |
|---|---|
| 项目 `assets\panorama\layout\hud\huddemocontroller.xml`（130 行 / 8,993 B）的 `id` 集合 ⊇ `huddemocontroller\current\huddemocontroller.decompiled.xml` 的 `id` 集合 | ✅ **无缺失**（Valve 当前 60 个原生 id 全部保留：`PlayerList` `RoundMenu` `PlayerControls` `CameraButton` `PlayerName` `TimeScale` `RoundMarkers` `Slider` `XRay*` `TrueView*` 等） |
| 项目 XML 额外新增的 id | `DshVoiceDock` / `DshVoiceList` / `DshRowAvatar` / `DshRowName` / `DshRowMuteBadge`（5 个，符合设计） |
| 现行 Valve `huddemocontroller.vxml_c`（从 VPK 提取） vs 项目 10-20 存档 | 同为 5,026 B，**仅 35 字节差异，且全部落在图标资源的 4 字节哈希上**（`domination.vsvg` / `camera.vsvg` / `clock.vsvg` / `film.vsvg` / `pause.vsvg` / `play.vsvg` / `settings.vsvg` / `skip.vsvg`）→ **CS2 10-23 更新没有改动 Demo UI 布局结构，只换了图标资源** |

**D. 静态 VPK 与 addon 的一致性**

解包 `assets\panorama\dsh_voice_override.vpk`（4 条目）与项目 addon 目录逐字节比对：**4 个文件大小完全相同，各只差 8 字节**，差异全部是内嵌编译目录名（`dsh_build_35396_1792526949576` vs `dsh_build_52596_1792526998764`）→ **静态 VPK 与 assets addon 出自同一次编译，内容同步**。同时 `dist\win-unpacked\resources\panorama\`（打包产物）中 VPK = 24,158 B、addon vxml_c = 5,035 B，**打包侧也是新版**。

**E. 结论（R10）**

- 游戏目录 addon **确认仍是旧版**（4,176 B，2026-10-18 构建，`dsh_build_56780_1792348636997`）。
- 它**不是「旧一点点」**：按 `progress.md` 本轮三十四，4,176 B 那版就是「缺 `PlayerList`/`RoundMenu`/`PlayerControls`/`CameraButton`/`message_arrow` → 原生 `HudDemoController` 初始化失败 → Shift+F2 打不开」的版本。
- 新版（5,035 B，`dsh_build_52596_1792526998764`）在项目、打包产物、静态 VPK 三处**都已就位**，只差「通过应用以 addon 模式播放一次」这一步 `copyDirContents` 覆盖。
- 附带：`game\csgo_addons\dsh_test\`（2026-08-23 的早期实验 addon，4 个编译资源）仍在，**不在任何官方 manifest 中**，属历史残留（文档未记录，风险低）。

---

## 会话残留（dsh-play.cfg / dsh_hud.log）

| 文件 | 文档 | 实际 | 判定 |
|---|---|---|---|
| `game\csgo\cfg\dsh-play.cfg` | 应已清理 | **不存在** | ✅ |
| `game\csgo\dsh_hud.log` | 应已清理 | **不存在** | ✅ |
| `game\csgo\cfg\dsh-test.cfg` | 未提 | 不存在 | ✅ |
| `game\csgo\cfg\dsh_hud.log`（错误位置） | 未提 | 不存在 | ✅ |
| CS2 根递归 5 层搜 `dsh_hud.log` / `dsh-play.cfg` / `gameinfo.gi.dsh*` | — | **0 个** | ✅ |
| `game\csgo\cfg\` 内所有文件含 `dsh` 的行 | — | **0 行**（48 个 cfg 文件全扫） | ✅ |

**其他残留（文档未记录，均不属本次注入面）**

| 文件/目录 | 大小 | mtime (UTC) | 说明 |
|---|---|---|---|
| `game\csgo\dsh_vfy.log` | 90,549 B | 2026-08-23T13:26:06Z | 2026-08-23 的手动验证日志（内容为 RenderSystem 启动日志），非官方文件、非本次会话 |
| `game\csgo_addons\dsh_test\` | 4 文件 | 2026-08-23T13:43:13Z | 早期实验 addon |
| `game\csgo\console.log` | 123,323 B | 2026-07-30T14:54:26Z | CS2 自身 `-condebug` 产物 |
| `game\csgo\pwa_*.log` | 94 个，共约 100 MB | 2026-07-31 ~ 2026-10-27 | 完美平台 `-condebug` 日志 |

> 判定：**注入类会话残留为 0，符合文档**；`dsh_vfy.log` / `dsh_test` 是 8 月的旧实验残留，不影响 Steam 校验（`dsh_test` 属 addon 目录，Steam 不把 addon 当官方文件校验，但 `dsh_vfy.log` 在 `game\csgo\` 下、不在 manifest 中）。

---

## CS2 版本现状

来源：`D:\11-Steam\steamapps\appmanifest_730.acf`（1,654 B，mtime 2026-10-27T09:13:18Z）

| 事实 | 文档值 | 实际值 | 判定 |
|---|---|---|---|
| `buildid` | 26144732 | **26144732** | ✅ 一致 |
| `LastUpdated`（Unix） | — | `1792710912` | — |
| `LastUpdated`（UTC） | 2026-10-22T23:15:12Z | **2026-10-22T23:15:12Z** | ✅ 一致 |
| `LastUpdated`（本地） | 2026-10-23 07:15 | **2026-10-23 07:15:12** | ✅ 一致 |
| `cs2.exe` mtime (UTC) | 2026-10-15T11:58:58Z | **2026-10-15T11:58:58Z** | ✅ 一致 |
| `cs2.exe` 大小 | — | 2,967,704 B | 记录 |
| **`LastPlayed`** | 未提 | `1793092398` = **2026-10-27T09:13:18Z（本地 17:13:18，即核验前 4 分钟）** | ⚠️ 文档未记录「今天刚玩过」 |
| `StateFlags` | — | `4`（Fully Installed） | ✅ 正常 |
| `UpdateResult` / `BytesToDownload` | — | `0` / 8,991,600 = `BytesDownloaded` | ✅ 无待更新 |
| `TargetBuildID` | — | `0` | ✅ 无待切换版本 |
| `SizeOnDisk` | — | 76,050,433,771 B（70.8 GiB） | — |
| `LastOwner` | — | `76561199446984252` | — |
| 用户语言 | — | `schinese` | — |

**版本一致性交叉验证**

| 检查 | 结果 |
|---|---|
| `pak01_dir.vpk` mtime | `2026-10-22T23:14:42Z`（与 LastUpdated 同批） |
| `pak01_dir.vpk` 大小 / SHA1 | 7,708,830 B，与 depot manifest **完全一致** ✅ |
| `pak01_000.vpk` 大小 / SHA1 | 105,176,480 B，与 depot manifest **完全一致** ✅ |
| `game\csgo\gameinfo_branchspecific.gi` | 518 B，与 depot manifest **完全一致** ✅ |
| `game\core\gameinfo.gi` | 2,474 B，与 depot manifest **完全一致** ✅ |
| `game\bin\win64\*.dll` 最新 mtime | `2026-10-22T23:15:01Z` |
| **按「已安装的 10 个 depot 的 manifest」核对 1,534 个官方 `game\` 文件的大小** | **仅 1 个不匹配 = `gameinfo.gi`**（26,056 vs 25,166），其余 1,533 个全部一致 ✅ |
| `gameinfo.gi` 的 SHA1 与 manifest | ❌ 不符（见上一章） |

> 这个交叉验证很关键：**除了 gameinfo.gi 之外，整个 CS2 安装 1,534 个官方文件的大小都与当前 buildid 的 manifest 完全吻合** → 说明安装未被 Steam 重下/篡改，唯一的偏离点就是本项目自己 inject/clean 留下的 gameinfo.gi。

**10-23 更新对 HUD 的实际影响（修正文档的判断）**

文档 10.7 说「HUD 重建是在 10-21（针对 10-16 build），因此 HUD 与当前 CS2 的兼容性尚未验证」。本次实测：从当前 `pak01_dir.vpk` 提取的 `panorama/layout/hud/huddemocontroller.vxml_c` **仍是 5,026 B**，与 2026-10-20 存档的同名文件**只差 35 字节、且全在图标资源 4 字节哈希上**，布局结构未变。→ **10-23 更新没有改动 Demo UI 布局**，「Shift+F2 兼容性」的结构性风险比文档描述的低；**真正的风险仍是「游戏目录跑的是 4,176 B 旧版 addon」**（R10），不是版本不兼容。这是本次核验对文档的一处**实质修正**。

---

## 运行时设置关键项

来源：`C:\Users\LIPSTICK\AppData\Roaming\CS2 Demo Analyst\settings.json`（**1,210 B**，mtime `2026-10-26T19:38:19Z` —— 与文档 7.1 的 1,210 B ✅ 一致）

| 字段 | 文档值 | 实际值 | 判定 |
|---|---|---|---|
| `language` | zh | `zh` | ✅ |
| `libraryRoots` | 4 个目录 | **4 个**（Wmpvp\demo / D:\5EDemocache / CS2\game\csgo\demos / D:\dsh-demo） | ✅ |
| `ui.theme` | dark | `dark` | ✅ |
| `asr.engine` | cloud | **`cloud`** | ✅ |
| `asr.cloudBaseUrl` | https://api.groq.com/openai/v1 | 同 | ✅ |
| `asr.cloudModel` | whisper-large-v3-turbo | 同 | ✅ |
| `asr.language` | zh | **`zh`** | ✅ |
| `asr.localModel` | 未提 | `base` | 记录（文档默认值写 small） |
| `ai.baseUrl` | https://open.bigmodel.cn/api/paas/v4 | 同 | ✅ |
| `ai.model` | glm-4-flash | 同 | ✅ |
| `cs2.installPath` | D:\11-Steam\...\Counter-Strike Global Offensive | 同 | ✅ |
| **`cs2.playMode`** | native | **`native`** | ✅ |
| **`cs2.hudMode`** | **inject** | **`inject`** | ✅ 一致（**R1 成立**） |
| **`cs2.voiceHud`** | true | **`true`** | ✅ 一致（**但见下：这是死字段**） |
| `cs2.vconsolePort` / `gsiPort` | 29000 / 30070 | 29000 / 30070 | ✅ |
| `cs2.useToolsMode` | false | `false` | ✅ |
| `cs2.playResolution` | auto | `auto` | ✅ |
| `cs2.launchArgs` | -worldwide | `-worldwide` | ✅ |
| `overlay.enabled` / `position` / `clickThrough` / `scale` | true / bottom-left / true / 1 | 同 | ✅ |
| `overlay.mutedPlayers` / `showMutedSpeakers` | [] / false | [] / false | ✅ |
| `overlay.muteHudMode` | badge | `badge` | ✅ |
| **`asr.cloudApiKey`** | 明文存在 | **字段存在，值 `<REDACTED>`**（非空，长度 56） | ⚠️ R9 仍成立（明文落盘） |
| **`ai.apiKey`** | 明文存在 | **字段存在，值 `<REDACTED>`**（非空，长度 49） | ⚠️ R9 仍成立（明文落盘） |

> **密钥处理声明**：本次核验只判断「字段是否存在 / 是否非空 / 长度」，**未在报告中写入、未回传任何密钥值**，上文一律 `<REDACTED>`。

**⚠️ 新增发现：`cs2.voiceHud` 是死字段**

- `src/shared/types.ts:339-350` 的 `cs2` 类型**没有 `voiceHud`**；`DEFAULT_SETTINGS.cs2`（同文件 393-397）只有 `launchArgs` / `playMode` / `hudMode`。
- 全 `src/` 搜索 `voiceHud`：**只有 i18n 文案 key（`settings.voiceHud` 等）和注释，没有任何读写代码**；`SettingsPage.tsx` 也没有这个开关。
- 实际生效的是 `cs2.hudMode`；`voiceHud` 之所以还在 `settings.json` 里，是 `deepMerge` 保留了 JSON 里的未知字段。
- 影响：文档 7.1 把它列为「当前实际值 = true」会误导——**它不影响任何行为**，HUD 开关请看 `hudMode`。

---

## 资料库与缓存

来源：`C:\Users\LIPSTICK\AppData\Roaming\CS2 Demo Analyst\`

| 项 | 文档值 | 实际值 | 判定 |
|---|---|---|---|
| `library\index.json` 条目数 | 4 条 | **4 条** | ✅ |
| 状态 | 全部 ready | **4/4 `ready`** | ✅ |
| 条目明细 | 3 个 `dsh-*.dem` + 1 个 zip 解出 | `1d697393c033b273` dsh-4a488737cd / `ce620ef3829462c0` dsh-8c1a2599bc / `8f3704622e1a8b0d` dsh-cfcbc61612 / `40a0512a0a202688` 9215107269675617292_0 | ✅ |
| 地图 / 回合 / 时长 | de_inferno | 全部 `de_inferno`，18 / 24 / 24 / 23 回合，1842 / 2299 / 2270 / 2197 s | ✅ |
| `index.json` 大小 | 未提 | 477,823 B（含 base64 头像，故大） | 记录 |
| `library\` detail 缓存 | 带 `parserVersion 9` | **4 个 detail 全部 `parserVersion=9`**，与 `PARSER_VERSION = 9`（`library.ts:164`）一致 | ✅ |
| `library\backup\` | 每 demo 保留最近 2 份 | **8 份**（含 4 个已删除 demo 的历史备份） | ⚠️ 数量多于「每 demo 2 份」（历史遗留，无害） |
| `voices\` 目录数 | **22 个目录** | **22 个目录** | ✅ |
| `voices\` 实际规模 | 未提 | **179 个 WAV，合计 28,038 MB（27.4 GB）** | 记录（体积大） |
| `voice-index\` | 1 个条目 | **1 个**（`08f524cb204aeb6e03b4b548.json`，97,809 B） | ✅ |
| `staged-demos.json` | 3 条，指向 `D:\dsh-demo\*.dem` | **3 条**，路径吻合 | ✅ |
| `ai-chats.json` | 2 B（空） | **2 B** | ✅ |
| `favorites\` | 当前空 | **0 项** | ✅ |
| `engines\` | csgove + whisper | `csgove\csgove.exe` 8.1 MB；`whisper\` 含 `whisper-cli.exe` + 3 个模型（base/medium/small，合计约 2.2 GB） | ✅ |
| `cache\zips\` | 平台 zip 解包缓存 | **1 个目录**（`40a0512a0a202688`） | ✅ |

补充（游戏侧目录）：`D:\dsh-demo\` 3 个 demo 均在（97.2 MB / 129.7 MB / 120.2 MB），**未被清理**，符合「不要删原始 demo」；`game\csgo\demos\` 为空（0 个文件）；`<CS2>\csgo\r0.cs2demos\` 另有 1 个 225.9 MB 的 `17855102498507.dem`（未在文档记录，非本项目目录，未动）。

---

## R1 / R2 / R10 当前状态判定

| 编号 | 文档描述 | 本次核验判定 | 依据 |
|---|---|---|---|
| **R1** | `settings.cs2.hudMode = inject`，但 gameinfo.gi 当前干净 → 下次播放会再次修改 gameinfo.gi | **✅ 成立，且风险比文档描述更高** | `settings.json` 实测 `inject`；代码路径 `live.ts:749-757 → prepareVoiceHud → demoInjector.install`：备份 + 写 2 个 VPK + 插 2 行 SearchPath。**因为 gameinfo.gi 现在已是 LF-only，这次备份 `gameinfo.gi.dsh_inject.bak` 会保存一个「已经非官方」的副本**；cleanAll 之后仍回不到官方字节。 |
| **R2** | Steam 完整性历史回归，每次启动都要求验证文件 | **⚠️ 未解除，只是换了一种形态** | 形式上无 dsh 行/备份/VPK（应用 `officialClean` = true）；**实质** gameinfo.gi 25,166 B / SHA1 `ad658bd8…` 与官方 manifest 26,056 B / `e345a2ed…` 不符，且已证明这个偏离正是本项目 inject→clean 的固定产物（换行被 `join('\n')` 永久抹掉）。一旦 Steam 做哈希校验，会命中「1 个文件不匹配」。 |
| **R10** | 游戏目录 addon 是旧版（4,176 B vs 包内 5,035 B） | **✅ 成立，且后果比文档更明确** | 游戏目录 4,176 B / 2026-10-18 / `dsh_build_56780_1792348636997`；包内 5,035 B / 2026-10-20 / `dsh_build_52596_1792526998764`。节点级比对显示旧版**缺 `PlayerList`/`RoundMenu`/`TimeScale`/`message_arrow`** → 就是 Shift+F2 打不开的那一版。项目 XML 已完整保留 Valve 现行 60 个原生 id（+5 个 DSH 节点），修复本身是有效的，**只是没被部署到游戏目录**。 |

**文档需要修正的事实（按严重度）**

| 严重度 | 文档位置 | 文档写的 | 实际 |
|---|---|---|---|
| **高** | 2.4「`steam_appid.txt`：**不存在**」 | 不存在 | **存在**：`game\bin\win64\steam_appid.txt`，5 B，`730\n\0`，mtime 2026-10-27T08:51:42Z |
| **高** | 2.4 / 附录 D「官方纯净 / gameinfo.gi 干净」 | 干净 | **仅「无 dsh 行」，字节层面与 Steam manifest 不符（LF vs CRLF，差 890 B）** |
| **中** | 10.7「HUD 与当前 CS2 兼容性尚未验证（10-23 更新）」 | 结构可能变 | **10-23 更新未改 Demo UI 布局**：现行 VPK 内 `huddemocontroller.vxml_c` 仍是 5,026 B，与 10-20 存档仅差 35 字节图标哈希 |
| **中** | 7.1 `cs2.voiceHud = true`（列为生效值） | 生效 | **死字段**：类型/默认值/代码均无，实际开关是 `cs2.hudMode` |
| 低 | 2.4 未记录 | — | `game\csgo\dsh_vfy.log`（90 KB，2026-08-23）、`game\csgo_addons\dsh_test\`（4 文件，2026-08-23）仍存在 |
| 低 | 附录 D「游戏目录 addon 存在，vxml_c 4,176 B（旧）」 | — | ✅ 一致，但**没写出后果**（缺原生节点 → Shift+F2 坏） |
| 低 | 7.3「backup 每 demo 保留最近 2 份」 | — | 实际 8 份（含 4 个已淘汰 demo 的备份） |

---

## 下次真机测试前必须做的事

> 顺序有依赖：**3 → 5 → 1 → 4 → 2**。前两步是「把 Steam 面弄回真正干净」，必须先做；否则任何一次播放都会重新污染。

1. **【必须先做，阻断级】把 `settings.cs2.hudMode` 从 `inject` 改成 `addon`（或 `off`），并重启应用。**
   - 理由：当前 `inject` 一按播放就会备份/写 VPK/改 gameinfo.gi（R1）。
   - 改法：应用内「设置 → 游戏内语音 HUD 模式 → Addon（推荐）」，或直接改 `settings.json` 后重启应用（应用有 settings 缓存，改文件必须重启）。
   - 验收：`settings.json` 里 `"hudMode": "addon"`。

2. **【必须先做，阻断级】修掉 injector 的换行 bug，再谈任何 inject 测试。**
   - `src/main/services/injector.ts:128` 的 `lines.join('\n')` 应改为 `lines.join(tf.newline)`（`addSearchPaths` 需要接收 `newline` 参数），并在 `removeSearchPaths` 里同样按原换行回写。
   - 不修的话：**每一次 inject 都会把 gameinfo.gi 的 CRLF 永久降级成 LF，且 cleanAll 无法还原官方字节** —— R2 的根因。
   - 修完必须重新 `npm run typecheck` + 重新打包（`out/main/index.js` 目前含旧逻辑）。

3. **【用户手动，一次】让 Steam 把 gameinfo.gi 修回官方版本。**
   - 推荐：Steam 库 → CS2 右键 → 属性 → 已安装文件 → **验证游戏文件完整性**。预期它会发现并重新获取 `gameinfo.gi`（回到 26,056 B / CRLF）。
   - 备选（不想跑 Steam 校验时）：退出 Steam → 备份 → 用「LF→CRLF」转换把 `game/csgo/gameinfo.gi` 恢复成官方字节（转换后应为 26,056 B、SHA1 `e345a2edbb075e32bac502f39fe5e81488f85477`）→ 启动 Steam 观察是否还提示校验。
   - **不要**用 `gameinfo.gi.dsh_inject.bak` 之类的旧备份覆盖（现在也没有该文件）；**不要**整目录删 `overrides`。
   - 验收：`gameinfo.gi` = 26,056 B，SHA1 = `e345a2edbb075e32bac502f39fe5e81488f85477`，`\r\n` 数量 = 890。

4. **【用户手动】删除 `game\bin\win64\steam_appid.txt`（5 B，非官方文件）。**
   - 它已存在（`730\n\0`，mtime 2026-10-27T08:51:42Z），不在任何官方 manifest 中；项目历史里 `-tools` 模式生成的同名文件曾导致「VAC 无签名报错」。
   - 注意：**本项目 addon/inject/native 模式都是直接 spawn `cs2.exe`，清理逻辑只在 tools 模式删它**（`live.ts:712`、`:853`），所以应用每播放一次都会再生成一次。建议同时给 `scheduleSessionCleanup` 的 `finish()` 增加删除 `game\bin\win64\steam_appid.txt`（这属于代码改动，需另开任务，本次只读核验未动）。
   - 验收：`Test-Path <CS2>\game\bin\win64\steam_appid.txt` = False。

5. **【验证 R10 已修】用 addon 模式播一次，然后核对 addon 是否被刷新成新版。**
   - 播放前：`game\csgo_addons\dsh_voice_hud\panorama\layout\hud\huddemocontroller.vxml_c` = 4,176 B。
   - 播放后：应为 **5,035 B**（SHA256 `7E1D0FA9…`），`dsh_voice_data.vjs_c` 会被重新编译成会话数据（大小随 demo 变化，不是 1,290 B 模板值）。
   - 然后在 `~` 控制台看 `[DshVoiceHud]` 报错、按 Shift+F2 确认原生进度条能打开（验证旧版 addon 的 `PlayerList`/`RoundMenu` 缺失问题已消失）。

6. **【每次测试后必做】重跑「设置 → Steam 安全自检」并人工复核 4 项：**
   - `gameinfo.gi` 无 dsh 行（用 `Select-String -Pattern '^\s*Game\s+.*dsh'` 复核，注意别被 `TimeSlicedShadowMapRendering` 误判）；
   - 无 `gameinfo.gi.dsh_inject.bak`；
   - `overrides\` 无 `dsh_voice_override.vpk` / `dsh_voice_session.vpk`（目录本身**不要删**）；
   - `dsh-play.cfg` / `dsh_hud.log` 已消失。

7. **【建议，低风险清理，非阻断】清掉 8 月的历史实验残留**（可选，清理前先确认无引用）：
   - `game\csgo\dsh_vfy.log`（90,549 B，2026-08-23）；
   - `game\csgo_addons\dsh_test\`（4 个文件，2026-08-23 早期 addon，`-addon dsh_test` 用的）。
   - 两者都不在官方 manifest 中，也不属当前 HUD 方案。**不要**碰 `pak01_*.vpk` / `bin\*.dll` / `_toolsettings` / `tools_thumbnail_cache.sqlite3`。

8. **【文档同步】把本次核验结论回写到 `docs/HANDOFF-2026-10-27.md`：**
   - 2.4 `steam_appid.txt` 的「不存在」改为实际状态；
   - 附录 D / 2.4 的「官方纯净」标注为「无 dsh 注入残留，但字节与 Steam manifest 不符」；
   - 10.7 补充「10-23 更新未改 Demo UI 布局（现行 VPK 内 vxml_c 仍为 5,026 B，仅图标哈希变化）」；
   - R10 补上「旧版 addon 缺原生节点 → Shift+F2 坏」的后果描述；
   - 7.1 标注 `cs2.voiceHud` 是死字段。

---

### 核验方法附录（只读命令，供复核）

```powershell
$CS2 = 'D:\11-Steam\steamapps\common\Counter-Strike Global Offensive'
# 1. gameinfo 基本状态 + dsh 命中
Get-Item "$CS2\game\csgo\gameinfo.gi" | Select-Object Length,LastWriteTimeUtc
Select-String -Path "$CS2\game\csgo\gameinfo.gi" -Pattern 'dsh' -SimpleMatch
# 2. 换行风格（证明 LF-only）
$b=[IO.File]::ReadAllBytes("$CS2\game\csgo\gameinfo.gi"); ($b -contains 13)   # → False
# 3. 与官方 manifest 比对（解析 depotcache 2347770 的 26056 B / e345a2ed…）
# 4. 备份 / overrides / 残留
Test-Path "$CS2\game\csgo\gameinfo.gi.dsh_inject.bak"                        # → False
(Get-ChildItem "$CS2\game\csgo\overrides" -Force -Recurse -File).Count       # → 0
Test-Path "$CS2\game\csgo\cfg\dsh-play.cfg"; Test-Path "$CS2\game\csgo\dsh_hud.log"  # → False / False
Test-Path "$CS2\game\bin\win64\steam_appid.txt"                              # → True（文档说 False）
# 5. addon 新旧
Get-Item "$CS2\game\csgo_addons\dsh_voice_hud\panorama\layout\hud\huddemocontroller.vxml_c" | % Length   # 4176
Get-Item ".\assets\panorama\addon\dsh_voice_hud\panorama\layout\hud\huddemocontroller.vxml_c"  | % Length   # 5035
# 6. CS2 版本
Select-String 'D:\11-Steam\steamapps\appmanifest_730.acf' -Pattern 'buildid|LastUpdated|LastPlayed'
[DateTimeOffset]::FromUnixTimeSeconds(1792710912).UtcDateTime                  # 2026-10-22T23:15:12Z
```

*报告完。本文件为只读核验结论，未修改任何游戏/项目文件（仅新建本报告）。*
