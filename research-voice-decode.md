# research-voice-decode.md — CS2 demo 语音「听不清 / 广播幻觉」根因与正确解码方案

> 研究日期：2026-08-20 · 环境：Windows / Node 24 / Electron 项目
> 素材：完美平台 demo `9211588078062082572_0.dem`（Devil' steamid `76561198132865304`，实体 entity=6，2421 帧 → 17 段）；IEM Rio 2024 demo 对照。
> 本文件结论与实测数据一一对应，可直接复现（脚本见文末）。

---

## 1. 结论（TL;DR）

1. **CS2 demo 里的语音帧是合法裸 Opus 帧**（TOC config=14 → 16kHz SILK 单声道），用标准 Opus 解码器（libopus / WASM / ffmpeg）按序逐帧解码即可得到真实游戏语音。**解码路径本身没有任何问题。**
2. **csgove 的解码结果也是正确的**：我们自研 WASM 解码的波形与 csgove 输出的波形包络相关度 **0.999**（样本级 xcorr 0.66，含 10ms 对齐误差），whisper 对两者转写出一致的中文语音。
3. **「广播幻觉」的真正根因在应用侧 `normalizeWav`（src/main/services/asr.ts）**：
   - csgove 写出的 WAV 头是 `fmt=1 PCM bits=32`，数据是**真正的满幅 int32 PCM**（语音有效位在**高 16 位**，`int(v * math.MaxInt32)`）。
   - 原 `normalizeWav` 误以为「32 位头里装的是 16 位数据」，写 `readInt16LE(dataStart + i * 2)`（i 步进 2 → 每 4 字节取**低 2 字节**）——取到的是 int32 的**低 16 位量化残差**（噪声），把语音彻底毁成噪声。
   - whisper 拿到噪声/近静音 → 输出「广播幻觉」（MING PAO CANADA | MING PAO TORONTO、字幕製作:貝爾、你不要再說了、(水) 等）。
4. **修复方法**：`normalizeWav` 改为取 int32 **高 16 位**（`v >> 16`），或直接用完整 32 位缩放；实测修复后 whisper（small / -l zh / -l auto）对同一 demo 输出**清晰中文游戏语音**。
5. **可选优化**：csgove 的 32-bit WAV 其实可以直接喂 whisper-cli（whisper.cpp 支持 32-bit PCM），`normalizeWav` 仅为了与其他消费方（云端 API / 能量检测）兼容；`-mode split-full` 输出的 25 分钟全时长文件绝大多数是静音，whisper 会在静音段继续产生幻觉，建议先做 VAD 裁剪（应用已有 detectSpeech/buildCompactWav，修复 normalizeWav 后即可正常工作）。

---

## 2. 消息结构与帧内容

用 `scripts/dump-voice-full.mjs` 解析 SVC_VOICE_DATA：

```json
audio: {
  "format": "VOICEDATA_FORMAT_OPUS",
  "voiceData": "<base64 裸 Opus 帧>",
  "sequenceBytes": 0,
  "sectionNumber": 2,
  "sampleRate": 48000,          // ← 消息显式声明 48kHz（解码输出）
  "numPackets": 1,
  "packetOffsets": [45,0,0,0],
  "voiceLevel": -0.251
},
entity: 12, xuid: {low,high}, audibleMask: 1
```

帧字节：首字节 `0x70` = TOC，`config=(0x70>>3)&0x1F=14` → **16kHz SILK、单声道**；2421 帧全部 config=14、帧长 51–84 字节 → 与 ~20ms SILK 帧吻合。tick 间隔 0/1（64 tick/s）说明每 tick 收 1~2 帧。

**注意**：Opus 帧的 `config=14` 表示编码器输入是 16kHz SILK，但 **Opus 解码输出恒为 48kHz**（libopus 内部上采样），所以无需按 16kHz 处理；whisper.cpp 也会自行重采样到 16kHz。

---

## 3. 根因分析（逐步定位）

### 3.1 csgove 解码本身是正确的

- csgove 源码（cs2/decoder.go）对 OPUS 格式用**单个持久 libopus 解码器**按序 `DecodeFloat32(segment.Data)`，48kHz、单声道——这是标准做法。
- 自研对照：`scripts/extract-voice-own.mjs` 用 `@deademx/cs2` 提取同一玩家帧序列，`scripts/lib/opus-decoder.js`（eshaz/wasm-audio-decoders 的 WASM libopus）逐帧解码。
  - 波形对比：`compare-own-csgove.mjs` 显示两路输出 100ms 能量包络相关 **0.999**（首段，0.00s 处）；样本级 xcorr 0.66（WASM 与 Go libopus 状态差异 + ~10ms 对齐）。
  - 自研解码 seg0（tick 11114, 2.38s）→ whisper small：`你他们说话呀谁呀` ✅
- csgove 同一 demo 的 split-compact 输出 → whisper small（32 位原始文件直接喂，或正确转 16 位后）：**完整 24.6s 清晰中文**：

```
你他们说话呀,谁呀,你掉呆B,眼里面有枪,眼里面有YK,这是个C5,呆B啊,呆B啊,一堆人,
那个傻B在匪家划刀呢,智障了,人家在匪家了,道心破碎了对面,...我有二楼一把盆子,小坑,别靠别靠别靠
```

### 3.2 应用侧 normalizeWav 是「广播幻觉」的直接根因

对 csgove 32-bit WAV 检查 int32 值分布（`check-int32.mjs`）：

```
min=-1625232768  max=2005754880  meanAbs=50840636   ← 满幅 int32
```

逐样本位布局（`check-bitlayout.mjs`，语音区）：

```
v=0701a388  hi16=1793  lo16=-23672  correct16=1794   ← 高16位==真实音频
v=05c168b0  hi16=1473  lo16=26800   correct16=1473
```

**语音在 int32 的高 16 位，低 16 位是量化残差**。原 `normalizeWav` 的循环：

```js
for (let i = 0; i < newDataSize; i += 2) {
  out.writeInt16LE(buf.readInt16LE(dataStart + i * 2), 44 + i)  // 取低 2 字节！
}
```

`i` 步进 2、偏移 `i*2` → 每 4 字节取**低 2 字节** = 低 16 位残差。复刻该逻辑（`repro-app-bug.mjs`）→ whisper 输出 `(水)`；应用实际产物（voices 目录 144MB 16-bit 文件）语音区 RMS 0.5、但样本级互相关与真实语音 **0.01** → 内容已被噪声化。

### 3.3 修复验证

改为取高 16 位（`fix-normalize.mjs` 或已修复的 asr.ts）：同一窗口 whisper small 输出：

```
173.8s: 你他們說話呀 誰呀
367.8s: 業裡面有槍業裡面有YP
812.5s: 我還沒說
```

### 3.4 之前的「不同时间片段输出重复」解释

- `devil-170/365/520/695.wav`（10s 片段）能量分析：170s 段 RMS≈0（静音）；365/520/695 段 RMS=32768（满幅噪声）——都是从**未修复的噪声化产物**里切的片段，whisper 对噪声/静音输出相同幻觉 → 表现为「内容重复」。
- Devil' 首个语音段在 tick 11114（≈173.7s），tick 170/365/520/695 根本不是他的语音位置。
- IEM Rio 2024 demo 语音极少且幅度极低（REZ int32 峰值仅 0.59% FS，100 倍放大后 whisper 才听出 `(audience applauding)`）——该 demo 不作为主要验证样本。

---

## 4. 正确解码方案（可集成）

### 方案 A（推荐，零依赖改动）：修复 normalizeWav

```ts
for (let i = 0; i < nSamples; i++) {
  const v = buf.readInt32LE(dataStart + i * 4)
  out.writeInt16LE(v >> 16, 44 + i * 2)   // 取高 16 位
}
```

已落地于 `src/main/services/asr.ts`。效果：本地 whisper 与云端 API 均得到清晰语音。

### 方案 B：不转码，直接喂 whisper（已验证可用）

whisper.cpp 支持 32-bit PCM WAV，csgove split-compact 输出直接 `-f xxx.wav` 转写即为清晰中文。仅需在 detectSpeech（要求 16-bit）前保留转换，或让 detectSpeech 支持 32 位。

### 方案 C（完全自研，不依赖 csgove）：extract-voice-own.mjs

从 demo 直接提取 Opus 帧并用 WASM libopus 解码（零原生编译、无 DLL 依赖），输出每玩家分段 WAV。与 csgove 结果一致（包络相关 0.999）。适合要彻底摆脱 sidecar / 或想按 tick 精确对齐的场景。

---

## 5. 复现脚本

| 脚本 | 作用 |
|---|---|
| `scripts/extract-voice-own.mjs` | 提取 + WASM 解码 → 每玩家分段 WAV（`--xuid`/`--entity` 过滤，默认 800ms 静音切段） |
| `scripts/lib/opus-decoder.js` | WASM Opus 解码器（eshaz/wasm-audio-decoders dist，内联 WASM） |
| `scripts/dump-voice-full.mjs` | dump SVC_VOICE_DATA 完整字段（含 sampleRate/packetOffsets） |
| `scripts/decode-wasm-own.mjs` | 把 `.raw` 帧序列（[u32LE len][data]…）解码为 WAV |
| `scripts/wav-convert.mjs` | 任意位深 WAV → 规范 16-bit |
| `scripts/fix-normalize.mjs` | 演示 int32 高 16 位转换 |
| `scripts/repro-app-bug.mjs` | 复刻原 normalizeWav 的取低 16 位错误 |
| `scripts/compare-own-csgove.mjs` | 自研解码 vs csgove 波形包络对比 |
| `scripts/check-int32.mjs` / `check-bitlayout.mjs` | int32 值分布 / 位布局验证 |
| `scripts/wav-energy.mjs` / `find-position.mjs` / `slice-wav.mjs` / `xcorr.mjs` | 能量分析 / 定位 / 切片 / 互相关 |

### 关键命令

```powershell
# 1) 提取并解码 Devil' 全部语音
node scripts/extract-voice-own.mjs test-data\demos\9211588078062082572_0.dem --xuid 76561198132865304 --out test-data\opus-own

# 2) 转写（每段）
& "$env:APPDATA\CS2 Demo Analyst\engines\whisper\whisper-cli.exe" -m "$env:APPDATA\CS2 Demo Analyst\engines\whisper\models\ggml-small.bin" -f <段.wav> -l zh -nt -otxt

# 3) csgove 对照（需在引擎目录运行，DLL 从 CWD 加载）
& "$env:APPDATA\CS2 Demo Analyst\engines\csgove\csgove.exe" -mode split-compact -output <out> <demo.dem>
```

---

## 6. 验证转写样本（whisper small / ggml-small.bin / -l zh，自研 WASM 解码）

```
seg000 t11114: 你他们说话呀谁呀
seg001 t11502: 你挑代必
seg002 t23526: 眼裡面有槍眼裡面有YP
seg003 t33332: 这是个塞物
seg004 t37342: 来逼呀来逼呀一堆人
seg005 t41624: 我在必要
seg006 t44652: 那个傻逼在飞家划刀呢
seg007 t44897: 我执政了
seg008 t48315: 应该在飞脚了
seg009 t48927: 道心破醉了對面
seg010 t51991: 这什么的嘛 足 这脚嘴吗
seg011 t57371: 缺A了缺A了缺A了
seg012 t65394: 非常地非常地
seg013 t69646: 我們下次見
seg014 t71946: 我有二楼一把盆子
seg015 t72342: 小鞋
seg016 t78474: 皮革皮革皮革
```

（少量错字是 whisper small 对 16kHz SILK 低码率语音的正常识别误差；语音内容、节奏、语气均真实可辨，绝非广播幻觉。）

csgove split-compact 同一玩家整轨（24.6s）转写（-l auto）：

```
你他们说话呀,谁呀,你掉呆B,眼里面有枪,眼里面有YK,这是个C5,呆B啊,呆B啊,一堆人,
我呆B啊,那个傻B在匪家划刀呢,智障了,人家在匪家了,道心破碎了对面,这什么的嘛,足,
这脚嘴吗,血液了,血液了,血液了,飞儿都飞儿都,什么自己办法呀,我有二楼一把盆子,小坑,别靠别靠别靠,
```

---

## 7. 附：为什么之前会误判为「解码问题」

- 「按 u16LE-32768 解读有语音特征、按 int16LE 解读是噪声」：这是对**满幅 int32** 数据的误读——u16 偶数偏移恰好命中 int32 高 16 位（真实音频），奇数偏移命中低 16 位残差，因此「看起来像 u16」。真相是 int32 满幅数据，**高 16 位是语音，低 16 位是噪声**。
- 「所有片段解码出相同内容」：whisper 对噪声/静音反复输出同类幻觉所致，不是解码器状态问题；csgove 的单个持久解码器用法与 libopus 官方推荐一致。
