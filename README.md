<div align="center">

<img src="assets/logo/csicon-512.png" alt="CS2 Demo Analyst Logo" width="150" />

# CS2 Demo Analyst

**CS2电竞级录像分析工具**  
*语音转写 · 游戏内语音显示 · 精准直跳 · 官方双轨回合走势图 · AI 智能复盘*

[![Platform](https://img.shields.io/badge/platform-Windows%2010%2B-blue?logo=windows)](https://github.com/B-LIPSTICK/cs2-demo-analyst/releases)
[![Version](https://img.shields.io/badge/version-v1.0.0-007aff)](https://github.com/B-LIPSTICK/cs2-demo-analyst/releases/tag/v1.0.0)
[![Electron](https://img.shields.io/badge/Electron-43.4-47848F?logo=electron)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

<p>
  <a href="README.en.md">English</a> | <b>简体中文</b>
</p>

</div>

---

## 快速开始

### 下载与运行

前往 [Releases 页面](https://github.com/B-LIPSTICK/cs2-demo-analyst/releases) 获取最新发布包：

- **绿色便携版（推荐）**：
  下载 `CS2-Demo-Analyst-1.0.0-win64-portable.zip`，解压至任意无特殊符号的英文文件夹，双击 `CS2 Demo Analyst.exe` 即可使用，无需安装、开箱即用。

### 基础使用流程

1. **添加录像目录**：首次打开软件，点击顶部「添加目录」或「自动检测平台目录」，一键识别完美世界、5E 或 Steam 录像路径；
2. **极速解析对局**：Demo 载入后自动提取比分、击杀流与走势图，点击卡片即可进入详情页深度复盘；
3. **精准直跳现场**：在击杀流或走势图中点击任意时间戳，CS2 自动精准直跳至交火前 4 秒缓冲区；
4. **原声转写与 AI 复盘**：
   - 在转写页使用本地 Whisper 提取队内原声开麦交流，支持按选手、回合快速过滤；
   - 在 AI 分析页一键生成赛后战术总结，点击回答中的回合与时间点秒级联动游戏。

---

## 界面效果与功能预览

### 1. 官方双轨回合走势图与深度复盘工作台
![Demo 详情页与走势图](docs/screenshots/1.0-detail.png)
*像素级还原 CS:GO / CS2 官方双轨走势图（存活人数槽、5种终局标志、换边比分），联动可直跳击杀流与选手高阶战绩榜（Rating、ADR、KAST、首杀率）。*

### 2. 录像资料库与多平台智能管理
![录像资料库](docs/screenshots/1.0-library.png)
*智能识别完美世界对战平台、5E 对战平台与 Steam 官方录像，本地极速扫描解析，支持按对局日期、地图与收藏状态筛选。*

### 3. 游戏内原声语音转写与逐行直跳
![语音转写](docs/screenshots/1.0-transcript.png)
*本地 Whisper 离线转写队内开麦语音，支持按阵营、选手及回合筛选，点击任意台词秒级跳转回放对应画面。*

### 4. AI 智能复盘与战术战况深度诊断
![AI 智能复盘](docs/screenshots/1.0-ai.png)
*深度关联全场击杀事件与语音交流，免翻墙直连大模型分析残局破防与战术决策，点击输出的时间戳秒级联动游戏。*

---

## 核心特性

### 1. CS:GO / CS2 原生双轨回合走势图 (Match Timeline Bar)
- **100% 像素级还原官方电竞记分板走势设计**：
  - 动态双轨分队（上下半区）与中场换边机制（T 琥珀金 / CT 冰霜蓝）；
  - 动态计算获胜方 **5 格幸存人数槽（Survivor Bars）**，一眼识别 1vX 极限残局翻盘还是 0 伤亡完美歼灭；
  - 5 种官方矢量胜负图标：全歼（Elimination）、引爆（Exploded）、拆包（Defused）、超时（Timeout）与终局奖杯（Trophy）；
  - 任意回合点击联动击杀流与高光事件。

### 2. 4 秒交火提前量极速直跳 (Live Jump with Lead-In)
- **交火缓冲保护**：在击杀流、战术事件或 AI 复盘中点击任意时间戳，自动提前约 256 ticks（4秒），完整观摩架枪、道具预压与对枪全过程；
- **智能双模自适应**：
  - **CS2 运行中**：通过底层管道下发 `demo_gototick` 实时秒切，录像无缝平滑跳转；
  - **CS2 未启动时**：一键自动拉起游戏并精准定位到目标 Tick 开始回放；
  - 选手数据弹窗内点击跳转自动保留在当前页，不被打断跳出。

### 3. CS2 游戏内麦克风语音 HUD 悬浮层 (Panorama Overlay)
- **仿原生队员开麦指示**：
  - 回放时在游戏画面左下角实时呈现当前开麦说话的队员；
  - 官方小圆角方形头像 + 阵营色名字（color-T / color-CT）+ 平滑呼吸发光动效；
  - 基于 Valve 原生 Panorama 引擎静态 VPK（`dsh_voice_override.vpk`）挂载，**无外部注入、不读写游戏内存，安全纯净零封号风险**。

### 4. 国内零门槛 AI 大模型智能复盘 (AI Post-Mortem)
- **国内直连、免梯畅享**：
  - 原生深度集成**智谱 GLM-4-Flash（完全免费、高并发）**、**硅基流动 SiliconFlow（国内大模型广场）**、**DeepSeek**、**Moonshot Kimi**，以及 **Ollama 本地大模型**；
- **智能对话与交互直跳**：
  - AI 战术回答中包含的所有局数（如 `R2`）与时间点（如 `[02:15]`）均**支持点击直接下发游戏内跳转**；
  - 自动集成 OpenCC 与简体中文 Prompt 约束，转写与复盘文本纯正规范。

### 5. 极简苹果风设计系统 (Apple HUD Aesthetic)
- **日夜双主题无缝切换**：
  - **日间模式**：纯白细腻实体卡片、微透灰边框与高对比度文字，柔和微投影；
  - **夜间模式**：近黑毛玻璃基底、冷白细线边框与极光渐变氛围；
- **全矢量图标体系**：
  - 告别系统粗糙卡通 Emoji，统一换装全套定制度细线 SVG 矢量图标（雷达扫描、拆包钳、刻度线）；
  - 重构 Secondary 实体轻质卡片按钮规范，触觉反馈精致高级。

### 6. 平台生态智能兼容
- **自动探测平台目录**：一键智能识别并扫描 Steam 官方、完美世界对战平台、5E 对战平台等常用 Demo 存储路径；
- **武器名称规范化**：自动清洗平台枪皮与特权标识（如 `hkp2000_txz04` → `P2000`），支持 Zeus、CZ75 及各类官方名刀；
- **真实比赛时间提取**：自动从录像文件实体头与压缩元数据中解析对局真实时间，彻底告别被下载时间篡改。

---

## 隐私与安全性保障

- **纯本地私有化**：所有 Demo 录像、击杀数据与转写文本均保存在您的本地电脑上，不会上传至任何不受控的第三方服务器；
- **安全不封号声明**：
  - 游戏内录像跳转通过 CS2 原生控制台通信机制（标准命令行及 netcon / rcon）；
  - 语音 HUD 使用 Valve 原生合规的 Panorama 覆盖机制（VPK 搜索路径优先级），**绝不使用任何 DLL 注入、代码劫持或内存读写**，完全符合 VAC 安全规范。

---

## 本地开发与构建

欢迎开发者共同完善 CS2 Demo Analyst！

```bash
# 1. 克隆代码仓库
git clone https://github.com/B-LIPSTICK/cs2-demo-analyst.git
cd cs2-demo-analyst

# 2. 安装依赖
npm install

# 3. 启动开发模式
npm run dev

# 4. 代码类型检查
npm run typecheck

# 5. 打包生产资源与便携绿色版
npm run build
npm run dist:zip
```

- **技术栈**：Electron + React 19 + TypeScript + Vite + Valve Panorama Engine
- **解析引擎**：[deadem](https://github.com/Igor-Losev/deadem)、csgove、whisper.cpp、OpenCC

---

## 开源许可

本项目基于 [MIT License](LICENSE) 许可协议开源。

