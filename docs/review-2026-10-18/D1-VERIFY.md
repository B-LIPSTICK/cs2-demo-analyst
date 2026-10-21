# D0/D1 验证清单（2026-10-19 凌晨）

## 当前交付

- 便携包：`D:\00-projects\Github\cs2-demo-analyst\dist\CS2-Demo-Analyst-1.0.0-win64-portable.zip`（149.7 MB）
- 解包目录：`D:\00-projects\Github\cs2-demo-analyst\dist\win-unpacked\`
- 可执行文件：`D:\00-projects\Github\cs2-demo-analyst\dist\win-unpacked\CS2 Demo Analyst.exe`
- 已验证：`npm run typecheck`、`npm run build`、`npm run dist:zip` 全部通过
- 当前游戏目录：`gameinfo.gi` 无 dsh 行、无 `dsh_inject.bak`、无 `overrides`、无运行时 addon 副本

## 这次改了什么

### 1. HUD 默认改为非侵入式 addon

- 设置 → CS2 → 游戏内语音 HUD 模式：
  - **Addon (Recommended)**：只写 `<CS2>\game\csgo_addons\dsh_voice_hud\`，不修改 `gameinfo.gi`
  - **Inject (Experimental)**：旧的 SearchPath 注入，仍可能触发 Steam 完整性校验
  - **Off**：不加载 HUD
- Addon 启动参数：`-insecure -addon dsh_voice_hud +exec dsh-play.cfg ...`
- 播放结束清理 `dsh-play.cfg`；addon 目录保留（额外内容，不是官方 manifest 文件）。

### 2. 静音选手 HUD

- 设置 → CS2 → 游戏内语音 HUD 模式下方：
  - **Show mute badge**（默认）：静音选手仍显示说话行，头像右上角显示红底白禁言标志
  - **Hide speaker**：静音选手完全不显示
- 数据来源：`tv_listen_voice_indices` 掩码反推 `mutedSlots`，写入 `DshVoiceData`；HUD 不需要读取设置文件。
- 静态 per-launch：播放中修改，下一次启动播放才生效。

### 3. Steam 安全自检

设置页新增：

- **Run check**：只读检查 `gameinfo.gi` 是否有 dsh 行、是否有 `dsh_inject.bak`、`overrides` 是否有本项目 VPK、addon 目录是否存在。
- **One-click cleanup**：只移除本项目两条 SearchPath、本项目两个 VPK、本项目备份、`dsh-play.cfg`、`dsh_hud.log`；不覆盖 `gameinfo.gi`，不删第三方文件，不碰 `steam_appid.txt`、`_toolsettings`、`tools_thumbnail_cache`、`pak01`、`bin`。

## 真机验证步骤

### 测试 1：Addon HUD 是否能加载

1. 运行 `dist\win-unpacked\CS2 Demo Analyst.exe`。
2. 设置 → CS2 → HUD 模式保持 **Addon (Recommended)**。
3. 在 Demo 详情页选一场有语音的 demo，点“CS2 中播放”。
4. 进游戏后看左下角是否出现说话者 HUD。
5. 如果 **没有 HUD**：
   - 打开控制台 `~`，看是否有 `[DshVoiceHud]` 或 Panorama 报错；
   - 不要手动改 `gameinfo.gi`；
   - 回设置切到 **Inject (Experimental)** 再试一次（仅作为 fallback）。

### 测试 2：Badge 模式

1. 设置 → CS2 → 静音选手选 **Show mute badge**。
2. 在详情页/设置页静音 1–2 名选手。
3. 重新点播放。
4. 静音选手说话时，HUD 行应显示：28px 方形头像 + 名字 + 右上角 14x14 红底白禁言标志。
5. 检查：
   - 头像没有变窄/被裁；
   - badge 没有被裁切；
   - badge 没有挡住名字；
   - 非静音选手没有 badge；
   - 游戏内声音确实被静音。

### 测试 3：Hide 模式

1. 设置 → 静音选手选 **Hide speaker**。
2. 重新点播放。
3. 静音选手说话时，HUD 完全不出现该行；其他说话者正常。

### 测试 4：Steam 完整性（最重要）

1. 退出 CS2。
2. 设置页点 **Run check**，确认：
   - `gameinfo.gi contains dsh lines: No`
   - `dsh_inject.bak: Missing`
   - `Project VPKs in overrides: 0`
   - 显示 `Official clean`
3. 正常通过 Steam 启动 CS2。
4. **确认不再提示“验证游戏文件完整性”**。
5. 如果仍然提示验证：
   - 立即停止 HUD 测试；
   - 点 **One-click cleanup**；
   - 把设置页自检截图/Steam 提示发我；
   - 不再使用 Inject 模式。

### 测试 5：清理不误删

1. 在 `game\csgo\overrides` 放一个第三方 `.vpk`（如果目录不存在可新建）。
2. 点 **One-click cleanup**。
3. 确认第三方 VPK 仍在；本项目两个 VPK 不存在。

## 已知风险

- Addon 是否被 CS2 实际加载尚未真机验证；如果引擎静默忽略 addon，HUD 不会出现，需切 Inject 或进一步调 addoninfo/参数。
- `muted.vsvg` 在当前 VPK 中存在；如果 badge 只有红底没有白色图标，说明该版本资源路径不可用，需要换图标。
- `overflow: noclip` 在部分 Panorama 版本可能裁切 badge；如果边缘被裁，改为 0 负 margin。
- Inject 模式仍是实验 fallback，仍可能触发 Steam 校验；优先用 Addon。
- 播放中切换 badge/hide 不会热更新，下一次启动生效。

## 回滚

- 源码改动未 commit；可用 `git diff` 查看。
- 验证工件：`D:\00-projects\Github\.d0-verify\`（D0）和子 Agent 临时目录（D1）。
- 游戏目录当前是官方纯净状态；不要用旧备份覆盖 `gameinfo.gi`。

---

## 2026-10-20 补充优化

- `PARSER_VERSION` 8 → 9：旧 detail 缓存会自动失效并重解析，B6 的回合/tickrate/槽位修复才会作用到旧 demo。
- 语音索引缓存：`%APPDATA%\CS2 Demo Analyst\voice-index\`，按 demo size+mtime 失效；HUD 播放不再每次完整重解析。
- AI 上下文预算：击杀 600 / 聊天 300 / 语音 250 / 总字符 60000，超限会标注省略数量并优先保留关键击杀。
- 英文资料库：平台名、空态、地图名（`Dust II`/`Mirage`）已格式化；设置页目录名仍默认中文。
- HUD 自检：Steam 自检现在会检查 addon 的 5 个关键文件是否齐全；缺文件会显示缺失数量。
- Inject 二次确认：切到 Inject 会先弹确认框，明确可能触发 Steam 完整性校验。
- 重复 CSS：删除 `assets/panorama/scripts/hud/dsh_voice.css` 旧副本，唯一来源为 `assets/panorama/styles/hud/dsh_voice.css`。
- 最新便携包：`dist/CS2-Demo-Analyst-1.0.0-win64-portable.zip`（重新打包于 2026-10-20）。
