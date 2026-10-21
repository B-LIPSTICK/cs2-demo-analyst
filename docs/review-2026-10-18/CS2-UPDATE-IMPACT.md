# CS2 更新影响评估（截至 2026-10-18）

## 1. 当前环境事实

- CS2 安装：`D:\11-Steam\steamapps\common\Counter-Strike Global Offensive`
- `appmanifest_730.acf`：
  - buildid `25966348`
  - LastUpdated `1792092822` → 2026-10-16 03:33:42（本地时间）
- `game/csgo/gameinfo.gi` 修改时间：2026-10-15 19:59:01
- 当前 `game/csgo/overrides` 不存在；无 `gameinfo.gi.dsh_inject.bak`（说明最近没有处于注入态）
- 项目依赖：`@deademx/cs2@3.4.1`、`@deademx/engine@3.4.1`

## 2. 最近 CS2 更新（与项目相关）

### 2026-10-15：Demo/Replay viewer improvements

Steam 公告原文（节选）：

> Demo/Replay viewer improvements:
> - Added a progress bar for demo/replay downloads
> - Camera controls now use click-and-drag scheme
> - Free and chase camera are usable during a paused demo
> - Fixed some minor issues when seeking to a different position in the demo file
> - Round backup files now require the game server startup flag "-allow_round_backup_files"
> - Updated AUG reload animations...
> - Stability improvements for Vulkan renderer

来源：Steam News `Counter-Strike 2 Update`，2026-10-15 07:02（本地时间）。

**对项目的影响**：

- `playdemo`、`demo_gototick`、`demo_pause` 等命令没有被公告移除；公告还修了 seek，理论上对跳转有利。
- 但 Demo UI 的布局/脚本可能随更新变化。项目覆盖的是完整的 `huddemocontroller.xml`，不是增量补丁；一旦 Valve 增加/重命名面板，覆盖层就会缺失节点。
- 当前 Valve `huddemocontroller.vts_c` 引用了 `PlayerList`、`RoundMenu`、`Camera`、`Death`、`message_arrow`；项目 XML 全部缺失（见下）。
- 当前 Valve 还有独立的 `huddemoplayback.vxml_c`；项目未覆盖。若新播放 UI 使用该布局，项目的 HUD 注入可能不再覆盖实际使用的界面。

### 2026-09-23：Rush 模式

Steam 公告/媒体：CS2 新增 3v3 Rush 模式，小竞技场、随机场景、占塔/消灭敌人赢回合，先攻下对方城堡赢比赛。

来源：
- Steam News `Rush Hour`，2026-09-23
- GamingOnLinux：`Counter-Strike 2 adds an intense fast-paced 3v3 'Rush' game mode`，2026-09-23

**对项目的影响**：

- 项目解析/UI 假设 5v5、10 名选手、MR12（12 回合半场）、R1/R13 手枪局、5 格存活条。
- Rush 是 3v3、非 MR12 的回合结构；拖入 Rush demo 时，选手数、回合数、半场线、存活条、经济/手枪局判断都可能错误。
- 项目没有模式检测；建议短期检测并提示“暂不支持完整分析”，中期再适配。

### 2026-10-09 / 10-06 / 10-01 等

- 10-09：AUG 换弹、拆弹包图标、demo 播放嗡嗡声修复；无解析格式变化。
- 10-06：创意工坊地图管理、宠物相册本地化、VK shader cache；无关。
- 10-01：准星系统大改；无关解析，但如果 HUD 使用准星/武器 UI 需注意。
- 09-24/25/26：Rush 地图 clipping、静音换弹、clan tag；clan tag 可能影响玩家名显示（项目已做 decorated name 清洗）。

## 3. HUD 覆盖层静态对比（关键证据）

从当前 `game/csgo/pak01_dir.vpk` 提取：

- `panorama/layout/hud/huddemocontroller.vxml_c`（Valve 当前编译布局）
- `panorama/scripts/hud/huddemocontroller.vts_c`（Valve 当前脚本）
- `panorama/layout/hud/huddemoplayback.vxml_c`（独立播放布局）

脚本字符串计数：

| 标识 | 当前 Valve 脚本出现次数 | 项目 XML |
|---|---:|---|
| `PlayerList` | 22 | 缺失 |
| `RoundMenu` | 16 | 缺失 |
| `Camera` | 10 | 仅图片路径/无该 ID |
| `Death` | 4 | 缺失 |
| `message_arrow` | 1 | 缺失 |
| `GetDemoControllerState` | 1 | HUD 依赖它（存在） |
| `IsPlayingDemo` | 3 | HUD 依赖它（存在） |

项目 XML 最后修改：2026-08-24；Valve 当前构建：2026-10-16。结论：

- **静态不匹配是确定的**。
- **游戏内影响是 probable**：可能出现 Panorama 报错、原生 Demo UI 控件缺失、HUD 不显示或部分交互失效。
- 需要真机验证；但不应等到用户报告再修。

## 4. 解析器/语音索引实测

### 4.1 解析

样本：`C:\Users\LIPSTICK\AppData\Roaming\CS2 Demo Analyst\Cache\zips\27a1ac4262471075\9210744306839323020_0.dem`（2026-10-18）

`@deademx/cs2@3.4.1` 结果：

- 成功；地图 `de_inferno`
- 比分 13:1；14 回合；112 击杀；2 条聊天；10 名选手
- 选手槽位 3–12
- 解析约 5.0 秒
- `hasVoice=true`，`voiceSec=557`

### 4.2 语音索引

同一 demo：

- 78,116 个 `SVC_VOICE_DATA`
- 9 个槽位有脉冲
- 0 个 malformed
- 约 0.9 秒

**结论**：当前更新没有让 3.4.1 的解析/语音索引整体失效。不要把“CS2 更新”直接等同于“解析必坏”；当前最大风险是 HUD 覆盖层和清理逻辑。

## 5. deadem 版本

- 项目：3.4.1（2026-07-15 发布）
- 最新：4.0.2（2026-10-09 发布）
- 4.0.0 breaking changes：
  - `@deademx/engine` 移除多线程解析
  - 增加 `exports` 字段，只允许包根导入（深路径 `src/**`、`proto/**` 不再解析）
- 4.0.1：修正示例脚本读取“无 user data 的 USER_INFO 条目”
- 4.0.2：主要是 Deadlock/Dota 2 fixed8 / `CUtlBinaryBlock` 修复；README 标注测试构建 CS2 1.41.8.9
- 当前 GitHub PR #23 `Proto Synchronization — cs2 (Auto)` 仍 open（2026-10-18 更新），说明 schema 同步仍在进行

**建议**：

- 3.4.1 当前可用，不必因为“有新版”就紧急升级。
- 在独立分支升级 4.0.2，跑解析/语音/转写/HUD 回归；4.0.0 的 exports/多线程变化可能影响构建。
- 如果升级后 Rush/加时样本仍失败，保留 3.4.1 并记录具体不兼容点。

## 6. VAC / `-insecure` / 注入

- 10-15 公告没有提到 VAC 规则变化。
- 项目普通原生模式不传 `-insecure`；voiceHud 模式传 `-insecure`（用于加载覆盖 VPK）。
- 当前安装没有 `overrides`/备份，说明最近没有注入态；无法从文件判断 VAC 风险。
- 比 VAC 更值得先修的是 `cleanAll` 的破坏性清理（见 F-02）：它可能删除其他 HUD 文件或回滚官方 `gameinfo.gi`。

## 7. 结论与建议

| 主题 | 结论 | 优先级 |
|---|---|---|
| 解析/语音索引 | 3.4.1 对 2026-10-18 样本仍可用 | 观察 |
| HUD 覆盖层 | 与当前 Valve 脚本静态不匹配，游戏内风险高 | 先修 + 真机验证 |
| Rush | 项目无模式检测，5v5/MR12 假设不适用 | 短期提示，中期适配 |
| deadem 4.0.2 | 有 breaking changes；当前 3.4.1 可用 | 分支评估，不盲升 |
| VAC/`-insecure` | 公告无变化；清理逻辑风险更大 | 先修清理 |
| `demo_gototick`/`playdemo` | 公告未移除，seek 修复可能有利 | 真机回归 |

## 8. 来源

- Steam News API / `Counter-Strike 2 Update` 2026-10-15、2026-10-09、2026-10-06、2026-10-01
- Steam News `Rush Hour` 2026-09-23
- GamingOnLinux `Counter-Strike 2 adds an intense fast-paced 3v3 'Rush' game mode` 2026-09-23
- npm registry `@deademx/cs2` 3.4.1/4.0.0/4.0.1/4.0.2 metadata
- GitHub `Igor-Losev/deadem` releases v4.0.0/v4.0.1/v4.0.2
- 本机 `appmanifest_730.acf`、`gameinfo.gi`、`pak01_dir.vpk` 提取结果

---

## 9. Steam 完整性硬约束（2026-10-19 用户反馈）

用户明确反馈：之前某个 Agent 的版本导致 Steam 每次正常启动 CS2 都提示“验证游戏文件完整性”，每次都要重新验证。必须把“不能触发 Steam 反复校验”作为 D 阶段的最高优先级硬约束。

风险点：
- 当前 HUD 方案通过修改 `game/csgo/gameinfo.gi` 的 SearchPath 注入 VPK。只要 Steam 在启动时看到 `gameinfo.gi` 与官方 manifest 不一致，就可能触发完整性校验。
- 即使 CS2 退出后恢复，若恢复不完整、备份过期、Steam 在注入态启动、或恢复了错误的旧版本，都可能让 Steam 认为文件被修改。
- 不应修改 `steam_appid.txt`、`game/_toolsettings`、`tools_thumbnail_cache.sqlite3`、`pak01_*.vpk`、`bin/*.dll` 等官方/来源不明文件。

D0 安全路线（先于 mute HUD）：
1. 优先验证非侵入式 addon 路线：现有 `game/csgo_addons/dsh_test/` 已包含编译后的 Panorama 资源。测试 `cs2.exe -addon dsh_test`（或等价启动方式）是否能加载 HUD，而不修改 `gameinfo.gi`。若可行，HUD 全部走 `csgo_addons`，停止 gameinfo 注入。
2. 若 addon 路线不可行：HUD 注入必须作为显式“实验模式”，并在每次启动 Steam/CS2 前强制移除本项目 SearchPath、校验 `gameinfo.gi` 不含 `dsh` 行、删除本项目备份；默认原生模式绝不修改游戏文件。
3. 增加“Steam 安全自检”：
   - 检查 `gameinfo.gi` 是否含 `dsh_voice_override.vpk` / `dsh_voice_session.vpk`；
   - 检查是否残留 `gameinfo.gi.dsh_inject.bak`；
   - 检查 `overrides` 是否含本项目 VPK；
   - 一键清理并显示“当前为官方纯净状态”。
4. 任何 HUD 真机测试后，先恢复并验证 `gameinfo.gi` 无本项目行，再让用户正常启动 Steam/CS2；用户确认不再触发完整性校验后，才算 D 通过。
5. 若无法可靠保证，宁可不发布 HUD 注入，也不接受“每次启动都要验证完整性”的回归。
