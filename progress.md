# progress.md — 会话日志

## 本轮十七（新增 ADR、KAST、Rating 2.0、首杀对决与回合经济系统分析）✅
- **核心电竞数据补全**:
  1. **伤害与 ADR**: 拦截 `player_hurt` 事件，过滤队友误伤，实现前置生命值截断（不溢出），输出每位选手场均有效伤害（ADR）与全场总伤害。
  2. **高阶战力指标 (KAST / Rating 2.0 / 首杀首死)**:
     - 追踪每回合首个击杀（Opening Duel），输出全场首杀/首死（FK/FD）。
     - 实现换人头判定（Traded，受害者阵亡后 3 秒内队友击杀凶手）、助攻伤害贡献（>=41 伤害）、击杀与存活判定，输出 KAST 贡献率（%）。
     - 引入社区成熟的 HLTV Rating 2.0 多元线性回归拟合算法（基于 KPR, DPR, KAST, ADR, Impact 加权）。
  3. **回合经济系统 (Economy)**:
     - 拦截 `round_freeze_end`，从 `CCSPlayerController` 实体读取 `m_pInGameMoneyServices`（开局资金、本回合消费）。
     - 实现 MR12 官方连败补偿状态机（$1400~$3400，每胜-1，每负+1，R13 换边重置）。
     - 判定双方每回合买枪类型（长枪满配 Full Buy / 强起 Force Buy / 半起 Semi Buy / 纯抗 Eco）。
  4. **版本与缓存控制**: `PARSER_VERSION` 从 4 升级至 5，旧 Demo 打开详情自动无缝触发重解析回填新数据。
  5. **UI 与 Bug 修复**:
     - 选手面板扩充 Rating、ADR、KAST、FK/FD 列，加高亮配色；`PlayerModal` 弹出卡片同步升级。
     - 回合详情条增加首杀与双方买枪经济条目。
     - 修复 `DemoDetailPage` 中 `meta` 变量未初始化的潜在作用域报错风险。
     - 双语 i18n（zh/en）全面补齐对应词条。
- **验证**:
  - `scripts/verify-stats-economy.mjs` 对真实 103MB Demo 验证：21 回合全绿，Rating (0.46~1.98)、ADR (50.8~179.9)、KAST (42.9%~81%)、经济买枪分类全部正确，断言 0 错误。
  - `npm run typecheck`（Node + Web 双工程零报错）✓
  - `npm run build` 打包构建成功 ✓

## 本轮十六（1.0 发布 + 界面 4s 闪烁根因修复）✅ 待 git 提交
- **1.0 正式版**: package.json/package-lock version → 1.0.0（App 版本默认值与设置页 About v 标签动态化）；electron-builder.yml win.target → nsis（oneClick:false + 可选安装目录 + 桌面/开始菜单快捷方式，artifact CS2-Demo-Analyst-1.0.0-setup.exe 92MB）；移除 TitleBar 左上角 logo（只留 Demo Analyst 字标）；dist: zip 147MB + setup 安装包齐。
- **★界面每 ~4s "从下弹出"闪烁根因（DOM 探针实证）**: 资料库页 `.page` 内 `card-grid` ↔ `empty(SCANNING)` 每 4.0s 往返切换（卡片重建 → fadeUp 重放）。链路: ToastProvider `value={{ push }}` **每次渲染新建对象** → 所有 useToast 消费者每次 provider 渲染获得新引用 → `LibraryPage.load` 的 `useCallback([toast])` 依赖随之变 → `useEffect([load])` 反复重跑 → load()（setLoading(true)→SCANNING→list→恢复）。修复: ToastProvider value 用 `useMemo` 稳定化（顺带避免全树 context 重渲染风暴）。
- **排障方法论入库**: ① 打包版 exe 只读 `dist/win-unpacked/resources/app.asar` —— **改完代码必须 make-zip（electron-builder --dir）后才生效**，build-only 后重启 exe 跑的是旧 asar（本次大坑，曾误判修复无效）；② scripts/cdp-probe.ps1（CDP MutationObserver 探针）可复用于验证 DOM 周期重建。
- 待办: 应用图标验收（zeus）、GitHub 头像上传 zeus-512.png、旧 0.1.0 zip 清理。

## 本轮十五补2（Logo 终稿：直接用原版透明素材，不重绘）✅ 待 git 提交
- **AI 重绘两版均被否（"太丑"）**: image2 手绘版（黑底深蓝枪）和文字重绘版（浅蓝+红龙）都不像原皮肤 → 用户拍板：**不重绘，直接抠图**，提供透明底素材（1536×1024 Format32bppArgb，四角 A=0 已抠好）。
- **处理**: `scripts/png-to-icon.ps1`（新增，透明素材 → 图标全套）：自动 trim 透明边（内容框 1435×973）→ 长边 88% 适配 1024 方形画布居中 → `assets/logo/zeus-master-1024.png`、`zeus-512.png`（README 引用）→ `build/icon-256.png` + `build/icon.ico`（16~256 七尺寸 PNG 透明条目）。产物经棋盘格预览验收（完整无黑边、比例合适、缩放清晰）。
- 原素材存档 `assets/logo/zeus-reference.png`（用户提供，勿删）。此前 AI 重绘的黑底图经 `png-to-transparent-icon.ps1`（洪水抠图）产物 zeus-master 已被真图覆盖。
- 已重打包 zip（147MB）并重启应用。待用户验收任务栏/托盘图标；GitHub 头像上传用 zeus-512.png。

## 本轮十五补1（Logo 定稿方向：Zeus x27 电击枪）✅ 待 git 提交
- **用户否定放大镜版（"太难看了"）→ 拍板概念**: 玩 Zeus 电击枪的玩家，要 **CS2 Zeus x27 蓝色皮肤本体**作图标：圆角/透明、中间电击枪，用于状态栏托盘。
- **绘制**: image2（dsh-pupil）生成 Zeus x27 蓝皮肤 1024 图（黑背景）→ `scripts/png-to-transparent-icon.ps1`（C# 洪水填充去背景：从四边 BFS、按与角点色差 tol=26 标记背景置 alpha0；踩坑: GDI+ `Image.Save(file)` 偶发 generic error → 全部改 MemoryStream + WriteAllBytes；路径用 GetFullPath 显式；PS5.1 here-string 须 ASCII）。
- **产物**: `assets/logo/zeus-master-1024.png`（透明源稿）、`zeus-512.png`（README/GitHub 用，README 已改引用）、`zeus-preview-checker.png`（棋盘格验收图）、`build/icon-256.png` + `build/icon.ico`（16~256 七尺寸 PNG 条目，透明）。
- 另留 `scripts/make-logo.ps1`（矢量版生成器：放大镜/播放三角版可用参数重画，产物在 assets/logo/logo-*.png 与候选图，未删除供参考）。
- 已重打包 zip（146.9MB）并重启应用。待用户验收 + GitHub 上传 zeus-512.png。

## 本轮十五（AGENTS.md 交接文档 + 品牌 Logo 重绘）✅ 待 git 提交
- **AGENTS.md（根目录，多 agent 无缝交接入口）**: 项目一句话/协作铁律（测试由用户操作、typecheck+build+zip 流程、git 中文 message、progress.md 记录惯例）/常用命令/当前架构/关键链路血泪事实（解析首回合无 prestart、PARSER_VERSION、WAV 缓存、+exec cfg 播放、VPK HUD 编译流、waitDetail、页面常驻 navSeq 等）/开放问题清单（头像左裁、winner 偏差、README 截图过时、scripts/hud/dsh_voice.css 旧残留）。docs/DEVELOPMENT.md 已标注"以 AGENTS.md 为准"。
- **Logo 重绘（用户否定播放器概念 → "重在分析师"）**: 设计 = **金色放大镜（#F5B942）+ 镜内蓝色准星十字（#6FB1FF）+ 金色中心点 + 玻璃高光**，深蓝黑渐变底（#1B2030→#0A0E1A）。"放大镜审视比赛 + 十字锁定" = 分析师/复盘定位，单符号小尺寸可辨。
- **实现**: `scripts/make-logo.ps1`（内嵌 C# + System.Drawing 矢量绘制，参数化可重跑；注意 PS5.1 按 ANSI 读无 BOM 脚本会乱码——脚本保持 ASCII）。产物: `assets/logo/logo-master-1024.png`、`logo-512.png`（README/GitHub 用）、`build/icon-256.png` + `build/icon.ico`（16~256 七尺寸 PNG 条目）。README 顶部已加 logo 图。踩坑: GDI+ Arc 角度坐标系（正 sweep=顺时针、90°=屏幕下方）曾画坏声波条，改"矩形+端圆"才稳。
- 打包含新图标（zip 146.9MB）。待用户验收图标 + GitHub 头像上传（用 assets/logo/logo-512.png）。

## 本轮十四补4（卡片布局 + 转写页联动修复）✅ 待 git 提交
- **voice:split demo not found 根因（第二次）**: 用户 8-29 新加 demo（ff2e6510…, de_inferno 8:13）后分割报错——转写页 demos 下拉**只在挂载时拉一次、不订阅 library:updated**，库里旧 demo 移除后列表仍是过期 id → `store.index[id]` 不存在 → waitDetail 返回 null → 'demo not found'（index/detail 均 ready，非解析问题）。修复: ① 转写页订阅 library:updated 实时刷新列表；② 前端 catch 对 'demo not found' 显示友好中文（"已不在资料库，请重新选择"）。
- **详情页 → 转写页不自动选中 demo**: 页面常驻下重复导航同一 demo 时 `initialDemoId` 值不变 → React effect 不触发。修复: App navigate 递增 `navSeq`，TranscriptPage effect 依赖 [initialDemoId, navSeq]，点转写必重新选中。
- **卡片布局（资料库页）**: 删 T:CT 比分（score 块 + CSS）；日期字号 10→13px 加粗；语音 Tag（语音/无语音/待检测·扫描）从 mid 行移到日期右边（.date-row flex）；地图名/文件名/底部 stats（时长/回合/大小/选手）不变；菜单按钮 margin-left:auto 保持右对齐。
- **聊天头像**: 详情页 chat 行补 avatar 传参（转写页 ChatRow 已有）。
- 回归: typecheck ✓ / build ✓ / dist:zip ✓（146.9MB）。待用户实机验证。

## 本轮十四补3（demo not found 根因：解析未完成即转写/AI）✅ 待 git 提交
- **场景**: 用户本地新加 demo 后立刻转写/分割/AI 对话 → 报 "demo not found"。根因: demo 加入后处于 pending/parsing，`library.detail()` 返回 null（无缓存 / parserVersion 不匹配 / 缓存被清理），转写/分割/AI 三处入口直接抛英文错误。
- **修复**: ① `LibraryService.waitDetail(id, timeout=180s)`——解析中自动轮询等待解析队列完成；ready 但缓存缺失自动触发重解析；解析失败/超时返回 null；② 转写/分割入口改用 waitDetail，失败抛友好中文提示（区分"解析失败/未完成"）；③ `ai:ask` 同样改用 waitDetail（AI 对话不再报 demo not found，自动等解析完成再回答）；④ 转写页按钮：选中 demo 未 ready 时禁用 + hover 提示"尚未解析完成"（runTranscribe/runSplit 内也加守卫）；⑤ i18n zh/en 新增 notReadyHint/transcribeHint。
- 回归: typecheck ✓ / build ✓ / dist:zip ✓。待用户实机验证。

## 本轮十四补2（转写链路：分割复用 + 重复修复 + 语言选择）✅ 待 git 提交
- **分割后转写仍卡（根因）**: ① `transcribeDemo` 无条件重跑 `extractVoice`（csgove 重新提取 100MB+/玩家，还先 `fs.rm` 全删）；② 重跑 `detectSpeech` VAD——分割结果（detail.voice 无文字段）完全没被复用；③ `normalizeWav` 每次全量读 WAV 文件（100MB+）。
- **修复**: ① `extractVoice` 缓存复用——voices/<id>/ 已有非空 WAV 且比 demo 新 → 跳过 csgove；② `transcribeDemo` 优先用 detail.voice 无文字段作切分（跳过 VAD），无分割才 detectSpeech；③ `normalizeWav` 只读 44B 头判断格式（16bit 直接返回）。
- **★"一段话转写两次"根因（UI 层）**: `runTranscribe` 完成后未清 `liveSegs`（转写过程实时预览事件累积），`allVoice = [...base, ...liveSegs]` → 整个列表翻倍。修复: 转写完成 setLiveSegs([]) + allVoice 按 player|timeSec 去重兜底。
- **★段边界错位（引擎层）**: 紧凑 WAV 多段无缝拼接，whisper 段边界识别差（上句延续到下段 → 文本重复/错位）。修复: `buildCompactWav` 段间插入 0.3s 静音（COMPACT_PAD_SEC），`mapCompactSegments` 映射同步计入。
- **转写语言选择**: settings.asr.language（默认 auto）；设置页下拉（自动/简体中文 zh/英/日/韩/俄/法等）；本地 whisper `-l <lang>`；云端 multipart 加 language 字段（auto 不传）。中文 demo 选 zh 避免繁体输出。旧配置 deepMerge 自动补默认值。
- 回归: typecheck ✓ / build ✓ / dist:zip ✓（146.9MB）。待用户实机验证（分割后转写不再重新提取、无重复、繁体消失）。

## 本轮十四补1（★手枪局丢失根因：CS2 首回合无 round_prestart）✅ 待 git 提交
- **★根因（事件时间线实证）**: 该 demo `round_announce_match_start@18.5s` → 9 个击杀 @37-67s（真手枪局，**无 round_prestart**——CS2 首回合隐式开始）→ 首个 `round_prestart@74.3s`（=R2 开始）。解析器 `startRound` 在 `roundsStarted=false` 时**直接覆盖**装着 9 个手枪局击杀的隐式 currentRound 而不入数组 → **手枪局整局丢失**；比分 6:13（19 局）只解析出 18 局。上一轮以为的"热身击杀"其实是手枪局本身。
- **修复（parser.ts）**: ① `startRound` 首个 prestart 到来前若隐式回合已有击杀/炸弹 → 先 `closeRound` 收进 rounds（5E/完美 demo 无 begin_new_match 时必然触发）；② 换边判定 `prestartCount>12` 改 `rounds.length+1>12`（隐式回合使 prestart 序号与真实回合号差 1，否则 R13 换边错位）；③ 隐式回合击杀过滤：`begin_new_match`/`round_announce_match_start` 之前的击杀丢弃（热身击杀不污染 R1）；④ 手枪局击杀阵营走 pawn 句柄兜底（roundTeamByName 首回合为空），已验证全对。
- **验证**: 19 回合 ✓（=6:13）、R1=手枪局 9 杀全手枪（USP-S/Glock-18）✓、R2-R19 与旧版 R1-R18 一一对应无回归 ✓、R13 上半场/R14 换边翻转 ✓。`scripts/verify-pistol-round.mjs` 入库回归。PARSER_VERSION 3→4（自动重解析）。
- **遗留（既有问题，非本次引入）**: 推导 winner 统计 T:14 CT:5 vs 实体比分 6:13 系统性偏差——疑似 5E 平台 CCSTeam 实体读分或 winner 推导问题，待单独排查（击杀记录颜色用户已确认正确）。

## 本轮十四（设置页修复 + 击杀阵营/第一局解析 + 删除头像功能）✅ 待 git 提交
- **设置页三修**: ①「推荐免费」确认弹窗 createPortal 到 body（`.page` fadeUp 动画的 transform 会让 position:fixed 相对页面而非视口 → 弹窗错位到下拉栏中间）；② API Key 说明下加可点击「获取免费 Key」链接（console.groq.com）；③ 切「自定义 API」时清空 baseUrl → 显示 API 地址 + 模型输入框（原来 baseUrl 残留 groq.com 导致输入框不出现）。转写/AI 两个引擎区同改。
- **GSI 说明文字** + 转写/AI 引擎下拉精简（推荐免费 Groq / 本地 Whisper / 自定义 API，声明弹窗注明上传第三方+隐私提示）。
- **击杀记录与选手数据**: 自杀/环境击杀（attackerUid==victimUid 或 65535）→ 显示「自杀」+ 空攻击者；选手数据阵营颜色与击杀记录互换（此前开局相反）；拆弹回合图标改 🔧 emoji。
- **★第一局（R1/手枪局）解析修复**: 解析器升级为实时跟踪击杀阵营；`PARSER_VERSION=3` 写入详情缓存，版本不匹配自动视为无缓存 → 强制重新解析（parse/parseAll/detail 三处）；详情页缓存失效时自动重解析并轮询回填。旧实例需重启应用才生效（内存缓存不自动重读）。
- **删除/恢复调整**（用户拍板）: ① **demo 卡片地图名左边的正方形地图徽标（MapGlyph 雷达风 SVG 轮廓）整条删除**——卡片 JSX、mapBadge()/MapGlyph() 组件（134 行 SVG）、hud.css .map-badge 全部规则（保留 mapName 文字与 inferMap/MAP_BADGE_CLASS 推断逻辑）；② 玩家头像曾误删，**用户要求后已全部恢复**——Avatar 组件 img 渲染 + avatar prop 还原，DemoDetailPage（选手数据表 20px/语音行 16px/选手弹窗 46px）与 TranscriptPage（VoiceRow/ChatRow 18px）传参还原（有真实头像显示图片，无则首字母圆标兜底）。
- 回归: typecheck ✓ / build ✓ / dist:zip ✓（146.9MB）。待用户实机验证。

## 本轮十三补9（★真机 HUD 显示 + UI 定型）✅ 待 git 提交
- **★真机验证成功（诊断脚本 diag-play-hud.mjs 驱动）**: 游戏内 HUD 显示！日志定位最终 bug —— **Panorama Panel API 是 `BHasClass()` 不是 `HasClass()`**（TypeError 中断渲染）；修复后说话者胶囊出现。此错误同时证明 VPK/数据/JS 链路全通。
- **参数顺序坑**: `steam -applaunch` 透传时 **`+exec` 必须放最后**（`-applaunch 730 -insecure -novid -console -consolelog dsh_hud.log +exec dsh-play.cfg`）；+exec 后置参数被吞（SwiftDemoUIPro 同款规则）。`-console` 让游戏内按 ~ 看 Panorama 错误。
- **UI 迭代（用户反馈驱动）**: 黑底胶囊 → 右下角 → 紧凑小框 → **最终 = CS2 原生语音指示风格**：
  - 左下角（margin-left 28px / margin-bottom 140px）、透明无背景框
  - **方形头像 28px + 名字 18px**（比例协调，说话时头像微放大+白发光）
  - **阵营色用 CS2 原生 CSS 变量 `color-T` / `color-CT`**（Swift 生产代码同款，非近似值）
  - **从下往上排**: JS MoveChildBefore 把最新说话者置顶 → 最早说话者沉底
  - 说完消失（行占位 opacity 显隐）→ 上方行不跳动；新说话者优先占空位
- **最终静态 VPK**: 20204B/4 文件（vxml_c 3893 + vcss_c 3642 + vjs_c 11216 + data 1164）。
- **回归**: typecheck ✓ / test-inject ✓ / test-static-vpk ✓ / test-session-vpk ✓ / test-hud-logic ✓ / simulate ✓。
- **清理**: 一次性诊断脚本（vpkedit 对比/minidump/参考 VPK 部署等）已删；保留 diag-inject-matrix/diag-single-mode/diag-play-hud/diag-postverify-prep 作为回归工具。

## 本轮十三补8（★VPK 格式根因破解：树结构 + otherMD5 位置）✅ 待真机验证 HUD
- **★矩阵 v1 关键结果**: A=SUCCESS（Steam -applaunch 启动可用）、B=SUCCESS（注入行 OK）、C=CRASH（参考 VPK+手写 session 组合崩 53s）、D=NOLAUNCH（Steam 验证干扰，无效）。
- **★Steam 验证循环机制破解**: 注入/恢复 gameinfo.gi + overrides VPK 变动 → Steam 检测官方文件哈希偏离 → 自动"验证本地文件"（移走 gameinfo.gi、73GB 全量校验）→ 验证期间 CS2 起不来 → 测试 NOLAUNCH。这是 Steam 自愈机制，SwiftDemoUIPro 同样触发（会话短不阻塞）。对策: waitSteamIdle 门控（gameinfo.gi 存在 + downloading/730 消失 + 稳定 30s）+ 单模式快速验证窗口。
- **★VPK 格式根因（逐字节逆向 swift-ref.vpk）**:
  1. **树结构**: `[ext\0] [dir\0] (name\0 + crc u32 + preload u16 + archive u16 + offset u32 + size u32 + 0xffff u16)* [\0空name=dir结束] [\0空dir=ext结束] ... [\0空ext=树结束]`；同 ext 同 dir 共享组头；**无 4 字节对齐**。我们旧实现: 每条目独立组头 + 缺空分隔 + 有对齐 → CS2 树解析错乱崩溃。
  2. **★otherMD5 区在文件末尾**（数据区之后）: tree MD5 + MD5("") + 16B 零（参考 VPK 尾 48B 验证一致）。我们旧实现放在数据区之前 → CS2 把 48B MD5 当数据读 → 所有文件内容错位 → vxml_c 头解析失败崩溃。
- **修复**: vpk.ts buildVpk + build-panorama.mjs inlineBuildVpk 重写（分组树 + 空分隔 + 末尾 otherMD5）；静态 VPK 重建 19438B/4 文件；vpk-debug.mjs 三层解析验证（树结束=声称值、offset 链连续、组头共享）。
- **★真机矩阵全绿**: A/B/C/D/E/F 全部 SUCCESS（90s+ 存活 0 minidump）—— 手写静态 VPK + 手写会话 VPK（97KB 真实语音索引）+ 组合部署均稳定。
- **应用改动**: live.ts voiceHud 模式改 **steam.exe -applaunch 730 -insecure -novid +exec dsh-play.cfg**（SwiftDemoUIPro 同款，注入状态必须 Steam 启动）+ locateSteamExe()（注册表 SteamPath + 兜底路径）；普通模式保持直接 spawn。
- **回归**: test-inject ✓ / test-static-vpk ✓（v2 布局）/ test-session-vpk ✓ / test-hud-logic ✓ / simulate-voicehud-session ✓（全链路）/ typecheck ✓。
- **待用户真机验证**: 应用内「CS2 中播放」+ 语音 HUD 开关 → CS2 播放 demo → 游戏内说话者胶囊显示。

## 本轮十三补7（注入失败根因定位：Steam 启动矩阵）⏳ 待用户跑脚本
- **问题**: 注入状态（gameinfo SearchPath 行 + overrides VPK）直接 spawn cs2.exe → 立即 "Encountered error" 退出（code=1, minidump, 异常 code=0x0）。已排除: VPK v1→v2 格式（resourcecompiler 接受）、VPK 内容（最小占位也失败）、手写 vs 参考 VPK（SwiftDemoUIPro 生产版同样失败）、cwd、-insecure、spawn 选项。
- **★SwiftDemoUIPro 源码逐字节对比（research/SwiftDemoUIPro/launcher/src/Cs2Manager.cpp:719-786）**: 注入行格式 `Game\tcsgo/overrides/<name>.vpk`、缩进取 `Game csgo` 行 `^(\s*)`、插入到第一个 `Game csgo` 行前（session 行在 static 前）、换行检测 CRLF/LF join 还原、QSaveFile 原子写 —— **与我们的 injector.ts 完全一致**（当前 gameinfo.gi: UTF-8 BOM + LF×349 + 3Tab 缩进，注入器无损）。→ gameinfo 注入行逻辑无差异。
- **剩余变量**: 启动方式（Swift=steam.exe -applaunch 730 -insecure；我们=直接 spawn cs2.exe；完美=直接 spawn 无注入）+ VPK 加载本身。
- **scripts/diag-inject-matrix.mjs（全自动 4 模式矩阵，~6min）**: A=无注入基线 / B=仅注入行无 VPK / C=行+参考 VPK(Swift 生产版) / D=行+手写 VPK，全部 steam.exe -applaunch 730 -insecure -novid -consolelog dsh_hud.log 启动，60s 监控（出现时间/存活时长/新 minidump/consolelog 尾部），自动 kill+清理。
- 判定: A 失败→Steam 启动本机不可用；B 失败→注入行问题；C 失败→参考 VPK 加载问题；D 失败→手写 VPK 产物问题；C/D 成功→问题在直接 spawn 启动方式，应用改 Steam -applaunch。

## 本轮十三补6（全链路模拟会话）✅
- **scripts/simulate-voicehud-session.mjs**: 完整模拟播放会话（不启动 CS2）——语音索引（92152 demo: 25676 包/7 说话者/**1.2s**）→ 会话 VPK（97KB）→ 静态 VPK → gameinfo.gi 注入（两行 SearchPath 正确）→ 播放 cfg 打印 → 恢复无残留。**全链路通过**。
- 至此实现侧全部收敛：实现/自测/审查/打包/文档/模拟全通过；唯一剩余 = 用户真机验证（CS2 内 HUD 显示）。## 本轮十三补5（HUD 逻辑单测 + JS 审查修复 + 重打包）✅
- **HUD 纯逻辑单测**（scripts/test-hud-logic.mjs）: 二分查找/说话者判定窗口/多人排序/边界 18 断言全过（与 dsh_voice.js 同步维护）。
- **JS 审查修复 4 处**: ①渲染签名加玩家表摘要（名字延迟解析可刷新）；②玩家表刷新拆到 750ms 低频轮询（50ms 轮询只算说话者，减性能开销）；③item.avatar null 防御（条件表达式不再抛错）；④item.name/meta null 防御。
- 静态 VPK 重编译（19397B/4 条目 CRC OK）+ build ✅ + 重打包 zip 146.9MB。
- 待用户真机验证。## 本轮十三补4（失败回滚 + GUIDE 更新 + 重打包）✅
- **injector.install 失败回滚**: gameinfo.gi 读取/写入失败时删除本次已写的 VPK（防半注入残留）。
- **GUIDE.md 第 4 步重写**: 普通模式播放（推荐）→ 游戏内语音 HUD（VPK 注入说明）→ 工具模式（跳转控制）；清理"游戏内悬浮层"旧表述。
- 注入回归测试通过（18672B 静态 VPK）+ typecheck ✅ + build ✅ + 重打包 zip 146.9MB。
- 待用户真机验证。## 本轮十三补3（HUD JS 健壮性增强 + vjs_c 格式对比验证）✅
- **vjs_c 格式对比**: resourcecompiler 编译产物带非空 RED2（编译字节码）；手写格式（RED2 空 + DATA 原文 JS）为 SwiftDemoUIPro 生产验证的**数据文件**形态 → 设计确认：逻辑 JS 走编译器（静态 VPK）、数据 JS 走手写（会话 VPK）。
- **HUD JS 增强**: ①说话者行改 XML snippet 实例化（BLoadLayoutSnippet，CSGOAvatarImage 由模板创建——消除 JS 直接创建该面板类型的风险）；②slot 解析 fallback 链（GetPlayerSlot → src.slot/player_slot → GetPlayerStatsJSO → GetPlayerXuidStringFromPlayerSlot 扫描）。
- 静态 VPK 重新编译（18672B/4 条目 CRC OK）+ typecheck ✅ + build ✅。
- 待用户真机验证。## 本轮十三补2（静态 VPK 验证 + 打包）✅
- **静态 VPK 结构验证通过**（scripts/test-static-vpk.mjs）: 4 条目（vxml_c/vcss_c/vjs_c×2）、路径正确、CRC 全 OK、数据偏移连续。
- **解析器 bug 记录**: VPK v1 目录树**每个条目以 0xffff 结束**（非仅最后）；自研解析器原先遇 0xffff 即 break → 只读到 1 条目（误报）。已修正 test-static-vpk/test-session-vpk。
- **dist:zip 打包验证**: electron-builder --dir + extraResources（assets/panorama → resources/panorama）；待验证 zip 内含 dsh_voice_override.vpk。
- 待用户真机验证（设置开语音 HUD → 播放 → CS2 内说话者显示）。## 本轮十三补（残留清理 + README）✅
- **启动残留清理**（live.ts cleanupStaleInjection）: 应用启动时若 gameinfo.gi 含注入行且 CS2 未运行 → 自动恢复（覆盖"播放中途关闭应用"场景，恢复定时器随进程消失的漏洞）+ 清理残留 dsh-play.cfg。
- **README 更新**: 功能表「游戏内悬浮层」→「游戏内语音 HUD」；跳转标注需工具模式；"不改游戏文件"表述修正（可选注入退出自动恢复）；快速开始更新。
- typecheck ✅ build ✅；注入器回归测试全通过（注入/顺序/幂等/恢复一致/清理/备份）。
- 待用户真机验证（设置开语音 HUD → 播放 → CS2 内说话者显示）。## 本轮十三（游戏内语音 HUD：VPK 注入实现）✅ 待真机验证
- **方案定稿**（findings.md §19）: 普通模式播放 + VPK 注入 Panorama（SwiftDemoUIPro 同款机制，全部自研实现）。
- **实现完成**:
  - `services/vpk.ts`: VPK v1 多文件 writer + vjs_c 资源生成 + crc32（纯字节，已用自解析验证: sig/树/CRC/数据区与 Rust 参考一致）。
  - `services/voiceIndex.ts`: deadem 提取 SVC_VOICE_DATA → {tick, entity→slot, xuid}（实测 92152 demo: 25676 包/7 说话者/0 malformed）。
  - `services/injector.ts`: gameinfo.gi 备份/注入/恢复（保留缩进/换行/BOM）+ VPK 部署；**端到端测试通过**（注入 2 行 SearchPath 顺序正确、幂等、恢复后与原文完全一致、VPK 清理、备份保留）。
  - `assets/panorama/`: huddemocontroller.xml（Valve 原生控件骨架 + DshVoice* 面板）、dsh_voice.css/js/data.js（自研说话者 HUD：50ms 轮询 GetDemoControllerState().nTick + pulsesBySlot 二分 + GameStateAPI 玩家信息）。
  - `scripts/build-panorama.mjs`: resourcecompiler 编译（-game/-i/-f/-nop4/-v）→ 静态 VPK 入库（assets/panorama/dsh_voice_override.vpk 18KB/4 文件，vxml_c/vcss_c/vjs_c 条目名已验证）。
  - `live.ts`: 普通模式播放支持 voiceHud —— 提取语音 → 会话 VPK → 注入 → `-insecure -novid +exec dsh-play.cfg`（cfg: demo_ui_mode 2 + cl_demo_predict 0 + tv_listen_voice_indices -1/-h -1 + playdemo）→ CS2 退出自动恢复（scheduleSessionCleanup）。
  - 设置页「游戏内语音 HUD」开关（工具模式禁用）+ i18n 中英 + Toggle disabled 支持。
- 测试脚本: scripts/test-session-vpk.mjs / test-inject.mjs / dump-voice-msg.mjs（保留作回归）。
- typecheck ✅ build ✅；**待用户真机验证**: 设置开语音 HUD → 详情页播放 → CS2 左下角显示说话者（名字+阵营色+声波）。
- 风险记录: huddemocontroller 覆盖随游戏更新需同步; -insecure 仅播放会话（与完美/5E 一致）。

## 本轮十二（★视角卡死最终根因：+cl_demo_predict 0）✅ 待用户实机确认
- **复现**: 应用内（完美式 +exec dsh-play.cfg）播放 92152（8/23 新 demo，与完美平台文件 SHA1 一致）→ 时间走但镜头不动; 同一 demo 完美平台播放正常 → 差异只在启动参数。
- **★单变量验证 v10（+cl_demo_predict 0）→ 视角正常（用户实测）**。v9 之前"正常"是因为播的 demo 不同（92086）—— 该 demo 导播数据本身正常，掩盖了参数问题。
- **★最终根因**: CS2 demo 播放预测（cl_demo_predict 默认 1）干扰导播镜头 → **时间走但镜头不动**; `+cl_demo_predict 0` 关闭预测后导播严格按 demo 数据走。
- **应用已改**（live.ts 普通模式）: `+exec dsh-play.cfg +cl_demo_predict 0 -novid`; typecheck ✅ build ✅。
- **最终播放链路（普通模式）**: stage 盘根 dsh-demo → 写 dsh-play.cfg → `cs2.exe +exec dsh-play.cfg +cl_demo_predict 0 -novid` → CS2 退出删 cfg。
- 待用户实机验证应用内「CS2 中播放」视角正常（任意 demo）。## 本轮十（★完美平台机制破解：视角卡死根因）⏳ 验证中
- **用户反馈**: 普通模式（5E 参数 v6）播放**视角卡死依旧** —— 新 demo（8/20-21 完美 demo）、画面在动但镜头固定、平台播放正常 → 问题在启动方式差异，不是 tools/普通模式问题。
- **排除**: 库里 4 个 demo 与完美平台原始 zip 逐字节一致（IDENTICAL）; demo 是 7/28 大更新后新录的（无兼容性问题）。
- **★抓完美平台真实命令行（scripts/capture-cs2-cmdline.mjs + 用户操作）**:
  ```
  cs2.exe +exec pwa.cfg +exec pwa_userconfig76561199446984252.cfg -pwa -condebug
  +tv_listen_voice_indices -1 +cl_demo_predict 0 -consolelog pwa_76561199446984252_20260823.log
  -consolelog_append -worldwide -worldwide -exec autoexec
  ```
- **★pwa.cfg 内容（game/csgo/cfg/pwa.cfg，仅一行）**: `playdemo "D:\csgodemocache\9215247295256571660_0.dem"`
- **★根因结论**: **+playdemo 作为启动参数在引擎早期被静默丢弃**（demo 系统未就绪 → 播放器半初始化 → 时间走但导播镜头不动 = 视角卡死）; **`+exec <cfg>` 有效**（引擎就绪后执行 cfg 内命令）→ cfg 里的 playdemo 正常播放、导播正常。完美平台无 -console/+demoui/-insecure，就是 `+exec pwa.cfg`。5E 的 -console +demoui 形式虽能播但疑似同样视角问题（用户实测 v6 视角卡死）。
- **待用户验证 v9（完美平台式）**: demo 暂存盘根 dsh-demo 目录 → 写 game/csgo/cfg/dsh-play.cfg → `cs2.exe +exec dsh-play.cfg -novid -consolelog dsh_vfy.log`。若视角正常 → 应用实现改为该方案。
- 附带发现: CS2 日志参数是 `-consolelog <file>`（写 game/csgo/），`+con_logfile` cvar 无效（解释了之前证据缺失）; 完美平台日志 pwa_*.log 保留在 game/csgo/（每用户每天一个）。

## 本轮十一（应用改为完美平台式播放）✅ 待用户实机确认
- **★v9 验证成功（用户实测）: 「视角都是正常的」** —— 完美平台式 `+exec dsh-play.cfg` 方案导播正常。
- **应用实现已改（live.ts）**: 普通模式 = stageDemoForPlayNoSpace（盘根 dsh-demo 目录）→ 写 `game/csgo/cfg/dsh-play.cfg`（`playdemo "暂存路径"`）→ spawn `cs2.exe +exec dsh-play.cfg -novid [用户启动项]`; CS2 退出后自动删 dsh-play.cfg（schedulePlayCfgCleanup）; launchCs2 steam:// 回退同步; i18n 提示更新; typecheck ✅ build ✅。
- **最终结论**: 普通模式播放参数 = `+exec dsh-play.cfg`（完美平台同款）; 不需要 -console/+demoui/-insecure; **+playdemo 启动参数 = 视角卡死根因**（引擎早期丢弃 → 半初始化播放器）。
- 待用户实机验证应用内「CS2 中播放」视角正常（详情页按钮 → 秒播 + 导播跟随）。

## 本轮九（方案 A 实施：普通模式播放）✅
- **★v6/v7 验证成功（用户实测，2026-08-26 11:02）**: `-console +demoui +playdemo <无空格路径> -insecure` **秒播、无闪退**（v6 直启 cs2.exe / v7 steam.exe -applaunch 730 均可）; 播放结束退主菜单后 CS2 弹「解析消息失败」（CS2 侧对 demo 消息的兼容提示，不影响播放，记录不处理）; v8（库 demo + 5E 参数）日志正常。
- **方案 A 实施（本轮）**:
  - `live.ts`: `launch()` 新增普通模式分支 —— CS2 运行中直接拒绝（普通模式无注入通道）; `stageDemoForPlayNoSpace()` 把 demo 复制到 **盘根 `\dsh-demo\`**（5E 同款思路: playdemo 路径不能含空格/非 Latin，game/csgo 路径本身含空格不可用）; 启动参数 = `-console +demoui +playdemo <暂存路径> -insecure [-novid] + 用户启动项`; `launchCs2` steam:// 回退同步改为普通模式形式。
  - 详情页: 「CS2 中播放」改读设置（默认普通模式）; **移除「语音悬浮」「大屏面板」按钮**（overlay 入口）; 转写页移除「语音悬浮」按钮; 设置页移除整个 overlay 区块; overlay 主进程代码保留未删（可恢复）。
  - 设置页: useToolsMode Toggle → **「播放模式」分段控件**（普通模式(推荐) / 工具模式(-tools)）; 显示设置（playMode/playResolution）标注仅工具模式生效; 相关 i18n 中英更新; jumpHint 文案改「跳转需工具模式」。
  - 用户 settings.json 已预置 useToolsMode=false。
- 验收: typecheck ✅ / build ✅; 待用户实机验证（详情页播放 → 秒播 + 无 overlay 入口）。
- 遗留: 测试残留文件（game/csgo/dsh-vfy.dem、userdata demos 目录、D:\5EDemocache\dsh-vfy.dem）可用 `node scripts/verify-normal-play.mjs --kill` 清理; 5E demo（324MB）仍在 D:\5EDemocache 未动。## 本轮八（方向决策：普通模式验证）⏳ 进行中
- **任务**: 验证普通模式（无 -tools）+playdemo 能否播放 → 决定方案 A/B/C（用户倾向 A: 放弃 -tools 注入、内置播放器 + 内置语音显示）。
- 已写 `scripts/verify-normal-play.mjs`: 与应用内完全一致的直接 spawn（数组传参、cwd=cs2.exe 目录、stdio ignore）; 前置 canary 写测试（失败不启动）; demo 复制到 game/csgo/dsh-vfy.dem（playdemo 只认该目录文件名）; 启动参数 `-novid +con_logfile dsh_vfy.log +playdemo dsh-vfy.dem`; 轮询 ≤180s 采集: 进程存活 / con_logfile（3 个候选位置）/ GSI 30070 推送; 结果写 scripts/verify-normal-play-result.txt; `--kill` 清理。
- 环境: settings.json installPath = D:\11-Steam\...\Counter-Strike Global Offensive（useToolsMode=true, playMode=borderless）; 库内 5 个 demo（最小 78MB cache\zips\a53d5dce12c32715 用于验证）。
- 踩坑: tasklist 在沙箱下 Access denied（脚本需 danger-full-access 运行）; canary 写测试设计保证沙箱下失败不启动 CS2。
- 参考: cs-demo-manager（akiver）官方文档 [Demo playback](https://cs-demo-manager.com/docs/guides/playback) 确认其用普通模式播放; CS2 的 playdemo 命令在普通模式控制台可用（[命令文档](https://mbsifu.com/library/game/cs2/command/playdemo)、[csgoluck wiki](https://wiki.csgoluck.com/command/playdemo/)），关键在启动参数形式。
- **验证结果待采集**（后台运行中）→ 见 scripts/verify-normal-play-result.txt。
- **测试协作方式（用户拍板）**: 测试/验证类任务由用户自己操作（省 token、更快）; agent 只准备脚本与代码，不代跑。脚本用法: `node scripts/verify-normal-play.mjs`（验证）/ `--kill`（清理 staged 文件与 cs2 进程）/ `--demo <路径>` / `--install <路径>`。
- **★首次验证结论（2026-08-26）**: 普通模式 `cs2.exe -novid +con_logfile dsh_vfy.log +playdemo dsh-vfy.dem`（裸文件名、无 -insecure）→ **停在主菜单**; 进程存活 180s+（启动本身成功）; `+con_logfile` 未生成任何日志文件（game/csgo、game、bin/win64、APPDATA、Documents 全搜过）; cs2_user_convars 无 con_logfile 痕迹 → **该版本直接忽略命令行 +命令**（与此前 tools 模式 "+playdemo 在部分版本不生效" 观察一致）。
- **★逆向 cs-demo-manager 源码**（akiver/cs-demo-manager, src/node/counter-strike/launcher/start-counter-strike.ts）:
  - 真实启动参数 = `"cs2.exe" -insecure -novid +playdemo "<完整路径>" -width/-height/-sw...`（exec shell 形式，完整路径带引号）;
  - **-insecure 是关键差异**（CS2 secure 模式可能限制 playdemo 文件访问/命令执行）;
  - 其 CS2 控制通道 = 自研 DLL 插件（gameinfo.gi 加 SearchPath + 复制二进制到 game\csgo\csdm\bin + `-insecure`），插件连 WebSocket 服务器执行 {tick, cmd} action 文件（如 demo_gototick）; **官方确认 CS2 不支持 VDM 文件，-netconport/VConsole 只存在于 -tools**（普通模式无任何官方远程通道）;
  - 播放前提: demo 路径必须全 Basic Latin 字符（issue #992）。
- **变体矩阵待用户测试**: scripts/verify-normal-play.mjs 升级为 --variant 1..5（v1=cs-dm 原样 -insecure+全路径; v2=-insecure+短名; v3=全路径无 insecure; v4=短名≈上次; v5=官方 demos 目录+insecure）。
- **★v1..v5 全部失败（用户实测，2026-08-26 11:33-10:41）**: 全部停在主菜单; `+con_logfile` 始终未生成文件 → 该 CS2 版本忽略无 -console 时的命令行 +命令。
- **★逆向 5E 客户端 app.asar 得到真实播放链路（决定性发现）**:
  - 5E = Electron 应用（D:\61-5EClient\resources\app.asar）; 混淆代码通过 Node VM 执行 + 解码器调用解出全部关键字符串（scripts/asar-decrypt.mjs，已解出完整字符串表）。
  - 播放流程: playDemo(demoId) → 在 `D:\5EDemocache`（drive root，无空格路径）找/解压 demo → forcePlayDemo → `sendCs2Cmd("-console +demoui +playdemo <完整路径> -insecure <附加>")` → IPC → 主进程 spawn。
  - 启动模块 v2/module/cs2/index.js（明文）: `run(args)=spawn(cs2_exe, args, {detached:true})`; v2/module/steam/index.js 另有 `steam.run(args)=spawn(steam.exe, args)`（-applaunch 备用路径）; 5E 会先检查 CS2 未运行（单实例），getLauncherType() 拒绝类型 0。
  - **关键参数: `-console` + `+demoui` + `+playdemo <路径>` + `-insecure`** —— 我们之前全部测试都缺 -console/+demoui（推测 +命令仅在 console 系统就绪后执行）; 路径必须无空格（5E 用 D:\5EDemocache 规避; 且 demo 路径须 Basic Latin，cs-dm issue #992 同因）。
- **待用户测试（关键一轮 v6/v7/v8）**:
  - v6 = 5E 原样: `cs2.exe -console +demoui +playdemo "D:\5EDemocache\g161-20260705090226006578350_de_inferno.dem" -insecure +con_logfile dsh_vfy.log`（直接用 5E 自己的 demo，保证兼容）
  - v7 = 走 Steam: `steam.exe -applaunch 730 <同上>`
  - v8 = 5E 参数 + 库 demo 暂存到 D:\5EDemocache\dsh-vfy.dem（排除 demo 兼容性变量）

## 2026 首轮（研究 + 决策 + Phase 0）
- 研究 Swift DemoUI Pro / cs2-demoparser / deadem / csgove / VConsole2 / GSI / whisper.cpp（结论入 findings.md）。
- 环境: Node 24 / Python 3.11 / git; 无 rust/msvc。用户决策: 好打包不易出问题 → Electron 纯 JS 栈; 转写快+免费+一键配置 → 本地 Whisper + Groq 双引擎; 注入可接受外部启动（参考 CS Demo Manager）。
- Phase 0 完成: 脚手架、HUD 设计系统（斜切角/噪点/Chakra Petch）、五页面、i18n、截图验收。
- 踩坑: npm ERESOLVE → vite@7; electron 下载失败 → npmmirror; TS7 → 锁 5.9。

## Phase 1（真实解析 + 资料库）✅
- 解析器（deadem）经真实职业 demo 验证: 21 回合/138 击杀/8:13 权威比分/语音 2133s/伪 MVP; 2.3s 解析 197MB。
- CS2 1.41 事件适配: 无 round_start/round_end → round_prestart/round_officially_ended（同 tick）; 胜负 = 炸弹事件+回合最后一杀; 预热过滤（begin_new_match / announce_match_start）; mapName 字段; CCSTeam 实体（类名 CCSTeam 非 CSTeam）; player_team 事件定阵营。
- 库服务: 扫描(chokidar)/index.json 缓存/顺序解析队列/进度事件/详情持久化; 实测渲染正常。
- 踩坑: main 构建静默失败→跑旧包（查 bundle 内容核对）; settings.json UTF-8 BOM 破坏解析（读时剥离）; userData = productName 目录（app.setName 固定）; `electron out/main/index.js` 与 `electron .` 的 app.name 差异。
- 测试 fixture: deadem CDN 下载 IEM Rio 2024 职业 demo（197MB, 不入库, gitignore）。

## Phase 2（语音提取与转写）✅
- sidecar: csgove v3.1.6（2.9MB）+ whisper.cpp v1.9.2 CPU（7.8MB）+ ggml 模型按需（HF/hf-mirror）。
- 下载服务: https 重定向/进度/镜像回退（ghfast.top/gh-proxy/mirror.ghproxy）。
- 提取: csgove split-full（全时长对齐时间轴）; 踩坑: DLL 需从引擎目录 cwd 运行; GitHub URL 拼接不能用 path.join。
- 转写: 本地 whisper-cli（-l auto -oj）+ 云端 OpenAI 兼容（Groq verbose_json）。
- 流水线: WAV → segments → tick/回合映射 → transcript.json 持久化; asr:progress/asr:segment 事件; 取消支持（AbortController）。
- 设置页: 引擎/模型状态 + 一键下载 + 进度条。
- Web 语音解码闭环: ffmpeg.wasm + Ogg Opus muxer（真实 demo 验证）; Electron 壳内 FS error → 桌面走 csgove; COOP/COEP 头。

## 中轮（Web 优先 + UI v2 + 语音 HUD）
- 架构演进: Web 版（浏览器解析 1.3s/76MB + 语音 WASM 解码 + GitHub Pages 可发布）+ Electron 保留 + 本地桥规划。
- UI v2 重设计: 去 AI 模板味（去斜切角/噪点/发光），改 CS2 原生观战语言（近黑蓝底/米白/金蓝阵营色/Rajdhani/1px 细线）。
- 游戏内语音显示: 左下角 CS2 原生语音 HUD（头像+阵营色名字+声波，无字幕）; Steam 头像从 SERVER_AVATAR_OVERRIDES 解析（完美平台 demo 10/11 命中）; 字幕移到大屏底部居中可选。
- 环境: 代理 127.0.0.1:7897 关闭时 GitHub 直连 ETIMEDOUT（curl schannel SEC_E_NO_CREDENTIALS）→ 推送/发布需代理在线。

## 本轮（Phase 3 补齐 + Phase 4 打包）✅
- Phase 3 缺口补齐: `live:launch`（steam://run/730//-tools / +playdemo，shell.openExternal）、`live:installGsi`、`live:locateInstall`、`spec_goto` 指令; preload/types/webmock 同步。
- UI: 设置页「自动检测 / 安装 GSI 配置 / 启动 CS2（-tools）」一键三件套; 实况页「启动 CS2」按钮 + 观战选手 ID 输入; 详情页「CS2 中播放」（Mode B 外部启动 +playdemo）。
- Overlay 实况模式: GSI → overlay.updateLiveGsi（demo sim 优先）; 悬浮层显示地图/比分/回合。
- 验收: typecheck ✅; web:build ✅; `--vcon-mock` 端到端 ✅（VCON 连上 mock、demo_info 回显、LIVE 状态，截图 shot-live-vcon.png）; smoke ✅; 打包 exe 冒烟 ✅。
- 打包: electron-builder 下载 electron 失败 → electronDist 指向本地 node_modules（离线可用）; 依赖瘦身（React/ffmpeg/字体 → devDependencies）+ electronLanguages [en-US, zh-CN]; zip 200MB → 159MB; PS5.1 Add-Type 失败 → Compress-Archive。
- 修复: SettingsPage 两处乱码（'涓浗'→中文、'鉁?'→移除按钮文案）。

## 本轮二（苹果风重设计 + 黑屏 bug + 悬浮层纯语音）✅
- **黑屏 bug 根因**: 主进程 `settings:changed` 事件发裸 settings 对象，renderer 按 `e.settings` 读取 → undefined → App setSettings(undefined) → `return null` 全黑。修复: 事件载荷改为 `{ settings }`; App 侧防御 `e.settings ?? s`; 新增 ErrorBoundary + 加载壳（任何渲染异常不再黑屏）。
- **UI v4 苹果风**: hud.css 全量重写——SF 系系统字体栈（弃 @fontsource Rajdhani）、近黑玻璃底+蓝色氛围光、毛玻璃面板（backdrop-filter blur+saturate）、iOS 蓝 #0a84ff 强调、14px+ 大圆角、macOS 红绿灯窗口按钮（左置）、iOS 分段控件/开关、系统绿红黄状态色、柔影。TitleBar/NavRail/ui 图标/实况页内联样式同步清理（去 uppercase/斜切角/琥珀金）。
- **悬浮层纯语音**: overlay 与大屏面板去掉地图/比分/回合状态条（DE_INFERNO 等不再显示），只保留说话者 HUD + 转写字幕；样式改毛玻璃胶囊。
- **回归测试基建**: 主进程新增 `--eval-js=<code>` 开发钩子（截图前在渲染进程执行 JS）→ 可自动化模拟改设置/切语言。踩坑: 批量截图时带空格的参数被 PowerShell 当单参数（--route=live --vcon-mock 失效）; 残留 electron 进程占单实例锁导致新实例秒退（截图前需清理）。
- 验收: typecheck/build/web:build ✅; 9 张截图全页面视觉验收 ✅（apple-*.png）; 黑屏回归 ×2（切英文/改端口设置，UI 正常英文渲染非黑屏）✅; overlay/fullpanel 无地图比分 ✅; 打包 exe 冒烟 ✅; zip 158.3MB。
- README 截图/文案更新为 v4 主题。

## 本轮三（全屏修复 + 删 Web 版 + 明暗主题 + 打包）✅
- **全屏面板卡死修复**: 卡死主因 = 全屏透明窗口上大面积 backdrop-filter blur 的 GPU 开销。修复: full.css 全部去 blur（改高不透明度纯色胶囊）; overlay.ts tickSim 从固定步进 60fps 改**按真实时间推进**（Date.now delta，帧率 20fps）; 全屏窗口 focusable:false + showInactive 不抢焦点。
- **删除 Web 版**（用户要求只做 exe）: 删 src/web、webmock.ts、renderer/public（opus/ffmpeg/deadem-web）、vite.config.ts、web 脚本、@ffmpeg/@eshaz/字体依赖、README/GUIDE/DEVELOPMENT 的 Web 内容。renderer 包 1.86MB→674KB，zip 158→146.8MB。
- **明暗双主题**: Settings.ui.theme + 标题栏太阳/月亮切换按钮 + 设置页分段；CSS 变量玻璃材质体系（--glass-*/--field-bg/--hover-bg 等）+ `:root[data-theme='light']` 全量覆盖；App 根节点 data-theme 同步。
- **UI 排布再打磨（参考 Mineradio）**: 标题渐变字、卡片 hover 蓝色辉光、背景蓝紫氛围光斑（26s 极慢漂移动画）、按钮蓝色渐变 + 光晕。
- 验收: typecheck/build ✅; 打包 exe 冒烟 ✅; 浅色设置页/浅色资料库/深色资料库/全屏面板截图视觉验收 ✅（v4-*.png）; zip 146.8MB。

## 本轮四（AI 分析功能）✅
- **配置**: Settings.ai 节（baseUrl/apiKey/model，默认 Groq 免费 llama-3.3-70b，与转写共用 Key；DeepSeek/通义等 OpenAI 兼容接口均可填）。
- **主进程** `services/ai.ts`: buildContext 把 demo 数据（选手/回合/击杀/语音转写≤250条/聊天）压缩成带 [mm:ss]+R回合 标注的文本；调 /v1/chat/completions SSE 流式（fetch + reader 逐行解析 delta）→ ai:delta/ai:done/ai:error 事件；AbortController 取消；无 Key/401/404 给可读错误。
- **页面** `AiPage.tsx`: 导航新增「AI 分析」；选 demo（优先有语音）；4 个快捷问题（高光/破防/转折/选手总结）；流式渲染 + Markdown-lite（标题/列表/**粗体**）+ [mm:ss]/R回合 渲染成可点击 chip → live.jumpTick（R 经 rounds 表映射 startTick）；无 Key 时引导去设置。
- **开发模式** `--ai-mock`: 本地规则引擎生成回答（高光选手=击杀最多+高光回合+破防词检测），无网无 Key 可验证全链路。
- 验收: typecheck/build ✅; mock 流式回答截图（时间/回合 chip 渲染）✅; 无 Key 错误气泡+快捷问题 ✅; 设置页 AI 区块 ✅; 打包 exe 冒烟 ✅。

## 下一步
- 发布: 推送提交到 origin（需代理在线）→ GitHub Pages 部署（web-dist, base './' 已配）。
- 后续: Web 版本地桥（Phase B）; 实机 CS2 验证 VConsole 握手/GSI 推送; NSIS 安装器（可选）; 包体继续压缩（<120MB 目标）。

## 本轮五（背景滚动 + 删除 demo + 对话记忆 + 收藏）✅
- **背景随滚动移动**: 氛围渐变从 body 移到 .page-scroll（滚动容器），AI 对话滚动时背景光斑跟着走。
- **删除 demo**: library.remove（移出索引+缓存，源文件不动；路径写入 ignored.json 黑名单，扫描/监视不再自动加回）。
- **对话记忆/多会话**: ai-chats.json 持久化会话（标题=首问）；AiPage 顶部会话下拉 + 新建/删除；多轮对话把最近 12 条历史随上下文发给 LLM。
- **demo 收藏**: favorites 服务把 demo 复制到 <exe 目录>/favorites（打包版）或 userData/favorites（开发）；DEMO 卡片右上角 hover 星标收藏 + 移除按钮；顶部「收藏夹」按钮打开目录；移除收藏只删副本不动原文件。

## 本轮六（语音转写体验 + 5E 解析 + VConsole 注入打通 + 播放显示设置）✅ 主要完成，待收尾验证
- **语音显示修复**: 详情页「语音 · Xs」未转写时回退 meta.voiceSec（累计 tick 去重 /64），不再显示跨度 1706s 假象；卡片 ⋯ 菜单加「重新解析」（force 重解析保留 voice）；语音时长改为真实累计秒数（parser voiceTicks Set）。
- **语音分割按钮**: 转写页「语音分割」（不转写、无需 Key，VAD 切段可逐段播放）→ 转写；按钮顺序：分割在左转写在右；无文字段显示灰色斜体「[语音片段]」。
- **语音播放**: VoicePlayButton（全局单 Audio），主进程 sliceVoiceWav 按时间段切片返回 base64 WAV；修复 IPC Buffer 序列化问题（改 base64）+ CSP media-src blob: data:。
- **overlay 字幕悬浮**: 悬浮层加字幕条（说话人 + 当前转写文字），overlay 按钮改中文「语音悬浮」。
- **页面常驻**: App 五页面 display 显隐切换（不卸载），切换保留状态；TranscriptPage initialDemoId 同步。
- **启动显示 demo 修复**: zip 条目 init 校验不比对指纹（只查缓存存在）——旧公式 id 兼容 scan（legacyId 匹配保留解析状态）；「刷新」按钮改真 rescan（await scan）。
- **5E 平台解析**: USER_INFO 表只有 GOTV → parse 完成后从 CCSPlayerController 实体补玩家（m_iszPlayerName/m_steamID/m_iTeamNum，实体 _index=击杀 userid）；实体玩家 ≥2 时以实体重建玩家表（5E USER_INFO 编号错位不可信）；统计统一完成后按 uid 计算；Steam 头像匹配移到玩家表确定后；过滤 GOTV/5EGOTV。
- **武器皮肤名规范化**: weaponName() 剥 5E 前缀（5e_2024pass5_/5e_xxx_）与后缀（_tx12/_txz12/_vip/_fm/_gold/_prem/_elite/_s\d+ 等），includes 兜底匹配；补 scar20/g3sg1 等缺失武器。
- **CS2 安装路径自定义**: 设置页可填/浏览 CS2 路径；locateCs2Install 优先用指定路径，校验 game/bin/win64/cs2.exe（不是旧 game/csgo/csgo.exe）；live.launch 传 installPath；app:pickDirectory IPC。
- **★VConsole 协议打通（真机逆向验证）**:
  - 发送帧: "CMND" + 2B 版本 00D4 + int32BE 长度(cmdLen+13) + 2B handle 0 + cmd\0（vconsole2.exe 反汇编确认；之前版本/长度字段错位全失败）
  - 接收帧: 4B 类型(AINF/CHAN/PRNT) + int32BE ver + int16BE len + int16BE handle；PRNT 文本在 payload 偏移 0-32 扫描提取
  - **关键**: 连接后 CS2 推缓冲消息（数百条），必须等「=====」分隔线（或 10s 超时兜底）后再发命令，否则命令被淹没；vconsole.ts 实现命令排队（ready 前 pending，markReady 后发送）
  - demo_info/demo_gototick 等无路径命令全部可用
- **★demo 播放链路**: CS2 VConsole 的 playdemo **只认 game/csgo/ 目录下的文件名**（完整路径会被截断成 C.dem/D.dem、pathid 空找不到）→ stageDemoForPlay 复制 demo 到 game/csgo/dsh-<hash>.dem 注入文件名；详情页「CS2 中播放」改 toolsMode:true（普通模式无 VConsole）；启动参数 +playdemo 在部分版本不生效（停主菜单）→ 启动后轮询等 VConsole 连上再注入（waitForConsoleAndPlay 最长 60s）。
- **播放显示设置**: settings.cs2.playMode(auto/fullscreen/borderless/windowed) + playResolution(分辨率下拉 16:9/16:10/4:3/5:4/21:9)；启动前镜像写 cs2_video_tools.txt（备份 .dshbak，CS2 退出后自动恢复）+ -w/-h 启动参数双保险；-noassetbrowser 禁工具模式弹窗（engine2.dll 逆向）；显示配置失败独立 try/catch 不影响启动（修过「只能启动不能播放」bug）。
- **下拉夜间看不清**: .select/.select option 加 color-scheme（夜间 dark、日间 light），Chromium 弹出层正确配色。
- **待用户验证**: 最新构建的播放恢复（修复显示配置 try/catch 后）、播放显示设置生效、夜间下拉配色、5E 重新解析武器名（scar20_txz12 → SCAR-20 等）。

## 用户操作习惯备忘
- 测试由用户操作（不要自动跑测试/截图）；构建用 `npm run build`（沙箱需 danger-full-access，esbuild spawn EPERM）。
- 启动应用: `npx electron out/main/index.js`（先确认无旧实例占单实例锁）。
- 用户 CS2 路径: D:\11-Steam\steamapps\common\Counter-Strike Global Offensive（Steam 注册表可检测）；工具模式 assetbrowser 已用 -noassetbrowser 禁掉。
- 用户 demo 来源: 完美平台 Wmpvp\demo（zip 容器）+ 5E D:\5EDemocache；5E demo 玩家名/武器名特殊（实体补全+皮肤后缀规范化）。

## 本轮七（最新：播放体验问题 + 方向待定）⚠️ 进行中，有重要决策待用户拍板
- **播放"第一次点没生效、需再点一次"已修复（待验证）**: 根因是 CS2 刚启动时 29000 未监听 → connect 3s 降级 → 命令丢失。修复: pendingPlayDemo 机制（点播放先存 demo 名，VConsole 缓冲就绪 onReady 后自动注入 playdemo）+ connect 失败每 3s 自动重试（最长 60s，仅 pendingPlayDemo 时）+ 详情页提示「CS2 启动中，demo 将在控制台就绪后自动播放…」。LaunchResult 加 starting 字段；vconsole.ts 加 onReady 回调；waitForConsoleAndPlay 已删除。
- **播放慢问题**: 完美/5E 秒播是因为它们用**普通模式**启动 CS2 + 内置 demo 播放器（原生、无 -tools）；我们为注入控制用 **-tools 模式**（要等 VConsole 连接+缓冲推送完，慢）。已优化: -novid 参数、CHAN 后不再提前 ready（回退等 ==== 缓冲结束标志，实测时序才可靠）、轮询 500ms。
- **★重要: 用户反馈视角"一闪一闪"**（tools 模式播放 demo 视角卡死/闪烁）——怀疑根因就是 **-tools 工具模式播放 demo 异常**（tools 模式是地图制作环境，demo 播放器摄像机行为异常）。**用户明确提出: 要像完美/5E 一样用普通模式 + 内置显示，不要外挂 overlay（语音显示用 CS2 内置的）**。
- **普通模式 +playdemo 实测**: 用 Start-Process 带引号路径 +playdemo 启动后 CS2 停主菜单（45s 后进程消失/未确认播放）。**结论待定: 普通模式 +playdemo 在此 CS2 版本是否生效未完全确认**（上次测试进程 45s 后 tasklist 无输出，可能启动失败或已退出）。下次可用直接 spawn（数组传参，像应用内那样）再测一次。
- **方向决策（用户拍板）**: 方案A 完全走普通模式 + 内置播放器（放弃 VConsole 注入控制，跳转功能会失效，但播放正常+内置语音显示）；方案B 保留 -tools 注入（控制好用但视角闪烁/慢/外挂显示）；方案C 普通模式播放 + 想办法另建控制通道。**用户倾向 A（"不要外挂的了"）**，待确认后：详情页播放改 toolsMode:false + +playdemo 参数（需验证普通模式能否播）；overlay 悬浮/大屏入口移除或隐藏；转写文字展示保留在应用内（详情页/转写页），跳转按钮在普通模式下列为不可用或提示需 -tools。
- **待办**: ①验证普通模式 +playdemo（直接 spawn 数组传参）能否播放 demo；②若能 → 默认普通模式播放 + 内置显示，移除 overlay 入口；③若不能 → 研究完美/5E 具体怎么让 CS2 加载 demo（可能用 CS2 内置 demos 目录 + 播放器界面引导，或它们的启动参数）。
- **重要参考**: SwiftDemoUIPro（nicedayzhu）用 `-insecure` + VPK 注入 Panorama UI 做游戏内控制；cs-demo-manager 用普通模式 +playdemo；完美/5E 均为普通模式。
