# 覆盖台账（Coverage）

## 审查深度

- 深度：完整范围审查（full-scope），覆盖 5 个主页面 + 标题栏/导航 + 共享组件 + 主进程关键链路 + HUD/Overlay 静态结构。
- 未做：无限输入穷举、真实 CS2 游戏内注入/播放/VAC 验证、真实付费 API 调用、多用户/多租户权限（本项目为单机桌面应用）。
- 结论：**部分验证**。静态/构建/截图/真实 demo 解析已验证；游戏内 HUD、真机播放、VAC 状态待用户验证。

## 页面

| PAGE | 入口 | 覆盖 | 证据 |
|---|---|---|---|
| PAGE-01 资料库 | 启动默认页 / 侧栏 DEMO | 空态、卡片、目录筛选、搜索、排序、选择模式、删除弹窗、收藏、语音扫描 | `library.png`、`library-cards.png`、`library-light.png`、`library-narrow.png` |
| PAGE-02 Demo 详情 | 点击卡片 | 头部、比分、时间轴、选手表、麦克风、回合条、击杀流、语音/聊天、选手弹窗 | `detail.png`、`detail-scroll.png`、`detail-light.png`、`detail-light-scroll.png`、`narrow.png` |
| PAGE-03 语音转写 | 侧栏 语音转写 | demo 下拉、玩家/回合筛选、搜索、tab、导出、分割/转写按钮、进度 | `transcript.png` |
| PAGE-04 AI 分析 | 侧栏 AI 分析 | 会话下拉、新建/删除、demo 下拉、提示卡、输入/发送/停止、流式消息 | `ai.png`、`ai-narrow.png` |
| PAGE-05 设置 | 侧栏 设置 | 主题/语言、目录、转写引擎/Key/语言、AI 服务商/Key/模型、CS2 路径/模式/HUD/还原、引擎下载、离线说明 | `settings.png`、`settings-cs2.png`、`settings-narrow.png` |
| PAGE-06 标题栏/导航 | 全局 | 版本、状态灯、GitHub、主题、窗口控制、导航项 | 所有截图 |
| PAGE-07 HUD/Overlay | 游戏内 / overlay | 覆盖 XML、语音 HUD、overlay 定位 | 静态 + VPK 提取；游戏内未执行 |

## 共享组件

| CMP/DEF | 覆盖 | 状态 |
|---|---|---|
| `Btn` / `Tag` / `Avatar` / `Empty` / `Ring` / `Toggle` | 视觉、尺寸、主题、禁用 | 已审查 |
| `CustomSelect` | 打开/关闭、点击外部、Escape、滚动、定位 | 已审查；键盘缺失 |
| `ToastProvider` | 队列、自动消失、稳定 value | 已审查 |
| `VoicePlayButton` | 播放/停止/切换/清理 | 已审查；全局单例 |
| `useFloatingPosition` | 上下翻转、边界、resize | 已审查；scroll 关闭 |
| `Modal`（Settings） | portal、遮罩、确认/取消 | 已审查 |
| `PlayerModal` | 数据、武器统计、击杀列表、跳转 | 已审查 |
| `RoundFilterBar` | 横向滚动、箭头、自动居中 | 已审查 |
| `MatchTimelineBar` | 半场/加时/存活条/图标 | 已审查；F-12/F-21 |
| `KillRow` / `KillIcons` | 击杀渲染、图标、跳转 | 已审查；F-09 |
| `Timeline` | 比分走势/色块 | 已审查；键盘缺失 |

## 主进程

| 模块 | 覆盖 | 状态 |
|---|---|---|
| `main/index.ts` | 窗口、IPC、更新、截图/冒烟、单实例 | 已审查；F-04/F-17/F-19 |
| `settings.ts` | 读写、deepMerge、原子写 | 已审查；F-04 |
| `library.ts` | 扫描、zip、解析队列、detail、waitDetail、remove、transcribe | 已审查；F-03/F-07/F-18 |
| `parser.ts` | header、事件、回合、击杀、经济、统计、slot | 已审查 + 真实 demo 解析；F-06/F-13/F-21 |
| `asr.ts` | VAD、紧凑 WAV、csgove、whisper/cloud、切分 | 已审查；F-11 |
| `voiceIndex.ts` | SVC_VOICE_DATA 槽位/脉冲 | 已审查 + 真实 demo 语音索引 |
| `ai.ts` | context、stream、mock、chat 持久化 | 已审查；F-08 |
| `live.ts` | 启动、cfg、VConsole、清理、定位 | 已审查；F-02/F-16 |
| `injector.ts` | gameinfo/VPK 注入/清理 | 已审查；F-01/F-02 |
| `engines.ts` / `download.ts` | 下载、镜像、进度、取消 | 已审查；P3 |
| `overlay.ts` | overlay 窗口/定位/状态 | 已审查；F-20 |

## 场景（SCN）状态

| SCN | 前提 | 动作 | 结果 | 状态 |
|---|---|---|---|---|
| SCN-01 | 默认 1440，深色 | 打开资料库/详情/转写/AI/设置 | 正常渲染 | passed（截图） |
| SCN-02 | 默认 1440，浅色 | 切主题，打开资料库/详情 | 正常渲染 | passed（截图） |
| SCN-03 | 1082px | 打开资料库 | 工具栏溢出/横向滚动 | failed（F-05） |
| SCN-04 | 1082px | 打开详情，滚到语音 | 文本 13px 竖排 | failed（F-05） |
| SCN-05 | mock 库 | 打开详情击杀流 | 全部“自杀” | failed（F-09） |
| SCN-06 | 转写页已选 mirage | 选择“选择 Demo” | 弹回 mirage | failed（F-10） |
| SCN-07 | 真实 2026-10-18 demo | 解析 | 成功，5s | passed |
| SCN-08 | 同一 demo | 语音索引 | 78,116 包/0 malformed | passed |
| SCN-09 | 真实 CS2 安装 | voiceHud 注入 + 播放 | 未执行（用户验证） | blocked |
| SCN-10 | 真实 CS2 安装 | 还原官方文件 | 未执行（有破坏性风险） | blocked |
| SCN-11 | 加时/Rush/128-tick 样本 | 解析/时间轴 | 无样本 | blocked |
| SCN-12 | 设置页快速输入 | 连续输入 Key/路径 | 未做压力复现 | planned |
| SCN-13 | 外部盘离线/索引损坏 | 启动资料库 | 未做破坏性复现（代码已证明） | planned |

## 未覆盖/限制

- 未启动 CS2，因此 HUD 覆盖层的实际 Panorama 报错、原生控件缺失、VAC 状态未验证。
- 未调用真实付费 AI/ASR API；只审查了错误处理路径。
- 未覆盖多显示器、DPI 缩放 150%/200%、触摸屏、屏幕阅读器。
- 未覆盖大规模资料库（数百个 demo）性能；只做了单 demo 解析。
- 未覆盖 zip 容器/5E/Wmpvp 的最新样本；代码审查覆盖，运行验证不足。
- 未生成 `audit.json` 机械台账；本报告用 `coverage.md` 记录分母与状态。若需要，我可以下一轮补 `audit.json` 并按 skill 的 ledger 校验。
