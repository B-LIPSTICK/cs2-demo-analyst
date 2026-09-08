# CS2 Demo Analyst

![CS2 Demo Analyst](assets/logo/csicon-512.png)

[English](README.en.md) | 简体中文

把一场 CS2 Demo 从录像文件变成可以搜索、定位和追问的复盘资料。

CS2 Demo Analyst 是一个 Windows 桌面复盘工具：拖入 `.dem` 后，软件会解析比分、回合、击杀和选手数据；如果录像包含游戏语音，还可以按玩家和时间转写成可搜索文字，并与 CS2 内置播放器联动。

## 你可以用它做什么

- **看懂整场比赛**：查看地图、比分、回合时间轴、击杀详情、选手高阶数据（Rating / ADR / KAST% / 首杀）与回合经济买枪。
- **快速找到关键时刻**：点击回合、击杀或转写内容，让 CS2 跳到对应时间。
- **搜索队内语音**：将 Demo 里的玩家语音转成文字，按玩家、回合和时间查看。
- **在游戏里识别说话者**：可选启用语音 HUD，在播放 Demo 时显示当前说话的玩家和阵营颜色。
- **用 AI 做复盘**：向 OpenAI 兼容模型提问，查找高光、转折和选手表现。

## 工作流程

```text
添加 Demo 文件夹
       ↓
解析比分、回合、击杀和选手数据
       ↓
可选：提取并转写游戏语音
       ↓
在资料库中搜索、定位，并在 CS2 中回放
```

## 截图

| 资料库 | Demo 详情 | 语音转写 |
| --- | --- | --- |
| ![资料库](docs/screenshots/1.0-library.png) | ![Demo 详情](docs/screenshots/1.0-detail.png) | ![语音转写](docs/screenshots/1.0-transcript.png) |

## 安装

从 [Releases](https://github.com/B-LIPSTICK/cs2-demo-analyst/releases) 下载：

- `CS2-Demo-Analyst-1.0.0-setup.exe`：安装版，可选择安装目录，并创建桌面和开始菜单快捷方式。
- `CS2-Demo-Analyst-1.0.0-win64-portable.zip`：绿色版，解压后直接运行。

运行前需要安装 CS2。首次使用时，在设置中添加包含 `.dem` 文件的目录。

## 使用

1. 打开软件，在资料库中添加一个包含 `.dem` 文件的目录。
2. 等待 Demo 解析完成，打开详情页查看回合、击杀和选手数据。
3. 点击「在 CS2 中播放」，使用 CS2 内置播放器回放 Demo。
4. 需要文字复盘时，在转写页选择本地 Whisper 或云端 API，并开始转写。
5. 需要游戏内显示说话者时，在设置中开启语音 HUD，然后从详情页播放 Demo。

## 语音与隐私

语音转写只适用于录像文件中实际包含玩家语音的 Demo。FACEIT、完美平台等第三方录像可能包含语音；Valve 官方匹配 Demo 通常不包含语音。

- **本地 Whisper**：音频留在本机处理，需要下载 csgove、Whisper 和模型文件。
- **云端 API**：音频会上传到你配置的服务商，例如 Groq。请根据服务商的隐私政策选择使用方式。
- **语音 HUD**：会临时注入 CS2 的 Panorama 搜索路径来加载 HUD，播放结束或应用退出时自动恢复相关文件。

## AI 复盘

AI 页面可以把整场比赛的结构化数据提供给任意 OpenAI 兼容 API，用于回答例如：

- 哪些回合改变了比赛走势？
- 哪些击杀或残局最值得复盘？
- 某名选手在进攻和防守阶段的表现如何？

API Key 和服务地址保存在本机设置中。使用云端模型时，发送的数据范围取决于你配置的服务商和模型接口。

## 开发

接手项目前请先阅读 [AGENTS.md](AGENTS.md)，其中记录了当前架构、验证流程和已知问题。

```bash
npm install
npm run dev          # 开发模式
npm run typecheck    # TypeScript 检查
npm run build        # 构建 Electron 资源
npm run dist:zip     # 打包 Windows 绿色版 ZIP
```

技术栈：Electron、React 19、TypeScript。Demo 解析使用 [deadem](https://github.com/Igor-Losev/deadem)，语音提取使用 csgove，转写支持 whisper.cpp 和 Groq。

## 当前限制

- 目前仅支持 Windows。
- Demo 解析依赖 CS2 Demo 格式，CS2 更新可能需要同步适配。
- 普通 Valve 匹配 Demo 通常没有玩家语音，因此无法进行语音转写。
- CS2 游戏内语音 HUD 需要正常安装 Steam 和 CS2，并可能触发 Steam 对游戏文件的校验。

## 许可

MIT。仅支持 Windows。
