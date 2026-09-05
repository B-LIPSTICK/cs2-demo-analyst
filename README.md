# CS2 Demo Analyst

[English](README.en.md) | 简体中文

CS2 录像复盘工具。把 .dem 拖进来，解析出比分、回合、击杀和选手数据；局内语音可以转写成文字，按回合和时间对齐，点一下就能让 CS2 跳到对应时刻。

Windows 桌面应用。自带 CS2 内置播放器驱动，可选注入游戏内语音 HUD（谁在说话直接显示在画面里），退出后自动还原，不改游戏文件。

## 功能

- 解析 .dem：比分、回合时间轴、击杀（武器/爆头/穿烟）、选手 K/D/HS
- 语音转写：逐位玩家局内语音 → 可搜索文字，时间与回合对齐（本地 whisper 或云端 API 二选一）
- 跳转：点击转写行 / 击杀 / 回合，播放中的 CS2 直接跳过去
- 游戏内语音 HUD：播放 demo 时画面左下角显示正在说话的队友
- AI 提问：整局数据喂给任意 OpenAI 兼容模型，问高光、找转折

## 截图

| 资料库 | Demo 详情 | 语音转写 |
| --- | --- | --- |
| ![library](docs/screenshots/1.0-library.png) | ![detail](docs/screenshots/1.0-detail.png) | ![transcript](docs/screenshots/1.0-transcript.png) |

## 安装

从 Releases 下载其一：

- `CS2-Demo-Analyst-1.0.0-setup.exe`：安装包，可选安装目录，带桌面快捷方式
- `CS2-Demo-Analyst-1.0.0-win64-portable.zip`：绿色版，解压即用

用法：

1. 打开软件，添加包含 .dem 的目录
2. 等待解析完成，进详情页点「在 CS2 中播放」
3. 语音转写需要带语音的 demo（FACEIT、完美平台等第三方录像）；Valve 天梯 demo 不含语音

## 开发

接手的人先读 [AGENTS.md](AGENTS.md)（项目现状、架构、踩坑记录都在里面）。

```bash
npm install
npm run dev          # 开发
npm run build        # 构建
npm run dist:zip     # 绿色 zip 打包
```

技术栈：Electron + React + TypeScript。demo 解析用 [deadem](https://github.com/Igor-Losev/deadem)（纯 JS），语音提取 csgove，转写 whisper.cpp / Groq。

## 许可

MIT。仅支持 Windows。
