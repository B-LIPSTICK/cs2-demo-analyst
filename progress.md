# progress.md — 会话日志

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

## Phase 2（语音提取与转写）进行中
- sidecar: csgove v3.1.6（2.9MB）+ whisper.cpp v1.9.2 CPU（7.8MB）+ ggml 模型按需（HF/hf-mirror）。
- 下载服务: https 重定向/进度/镜像回退（ghfast.top/gh-proxy/mirror.ghproxy）。
- 提取: csgove split-full（全时长对齐时间轴）; 踩坑: DLL 需从引擎目录 cwd 运行; GitHub URL 拼接不能用 path.join。
- 转写: 本地 whisper-cli（-l auto -oj）+ 云端 OpenAI 兼容（Groq verbose_json）。
- 流水线: WAV → segments → tick/回合映射 → transcript.json 持久化; asr:progress/asr:segment 事件; 取消支持（AbortController）。
- 设置页: 引擎/模型状态 + 一键下载 + 进度条。
- 待验证: 全链路端到端转写（--transcribe 开发模式）。

## 下一步
- Phase 2 验收（真实转写结果与回合对齐）→ Phase 3 注入（VConsole2 + GSI + 启动器）。
