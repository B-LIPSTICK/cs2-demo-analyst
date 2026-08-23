/**
 * VConsole2 客户端（CS2 -tools 模式的远程控制台通道）
 *
 * 协议（已用真机验证，2026-08-21）：
 *  - 连接建立后 CS2 主动推送：AINF（应用信息）+ CHAN（通道定义）+ 数百条缓冲 PRNT（控制台历史输出）
 *  - 帧头：4B 类型(ASCII) + int32BE 版本 + int16BE 长度 + int16BE handle + payload
 *  - 发送命令：写 "CMND" + int32BE 0x0000D200 + int16BE (cmdLen+13) + int16BE 0 + cmd + \0
 *    ※ 必须等缓冲消息推完（出现 "=====" 分隔线或超时兜底）再发命令，否则命令被淹没不执行
 *  - PRNT payload 前部为二进制头，文本需在 payload 内偏移扫描提取
 */
import { createConnection, createServer, type Socket } from 'node:net'

export interface VConsoleCallbacks {
  onConnected: () => void
  onReady: () => void
  onDisconnected: (err?: Error) => void
  onLine: (channel: string, text: string) => void
}

interface Channel {
  id: number
  name: string
}

/** 缓冲结束标志：CS2 推完缓冲后用一串 = 分隔 */
const BUFFER_END_RE = /^={5,}$/
const READY_FALLBACK_MS = 10000 // 缓冲迟迟不结束时强制就绪

export class VConsoleClient {
  private sock: Socket | null = null
  private buf = Buffer.alloc(0)
  private scanPos = 0
  private cb: VConsoleCallbacks
  private host: string
  private port: number
  private channels = new Map<number, Channel>()
  private isConnected = false
  private ready = false
  private closed = false
  private pending: string[] = []
  private readyTimer: NodeJS.Timeout | null = null
  private chanTimer: NodeJS.Timeout | null = null

  constructor(cb: VConsoleCallbacks, host = '127.0.0.1', port = 29000) {
    this.cb = cb
    this.host = host
    this.port = port
  }

  get connected(): boolean {
    return this.isConnected
  }

  connect(): void {
    if (this.isConnected || this.closed) return
    const sock = createConnection({ host: this.host, port: this.port })
    this.sock = sock
    sock.on('connect', () => {
      this.buf = Buffer.alloc(0)
      this.scanPos = 0
      // TCP 已通：先报告连接（live 状态灯变绿），命令等缓冲结束后再发
      this.isConnected = true
      this.cb.onConnected()
      // 兜底：10 秒内缓冲没结束也强制就绪
      this.readyTimer = setTimeout(() => this.markReady(), READY_FALLBACK_MS)
    })
    sock.on('data', (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
      this.drain()
    })
    sock.on('error', (err) => {
      this.isConnected = false
      this.ready = false
      this.cb.onDisconnected(err)
    })
    sock.on('close', () => {
      this.isConnected = false
      this.ready = false
      if (this.readyTimer) clearTimeout(this.readyTimer)
      if (this.chanTimer) clearTimeout(this.chanTimer)
      this.sock = null
      this.cb.onDisconnected()
    })
  }

  /** 缓冲推完（或超时）→ 就绪，发送排队命令并通知上层 */
  private markReady(): void {
    if (this.ready) return
    this.ready = true
    if (this.readyTimer) clearTimeout(this.readyTimer)
    if (this.chanTimer) clearTimeout(this.chanTimer)
    for (const cmd of this.pending.splice(0)) {
      this.sendRaw(cmd)
    }
    this.cb.onReady()
  }

  sendCommand(cmd: string): boolean {
    if (!this.isConnected) return false
    if (!this.ready) {
      // 缓冲未推完：排队，就绪后自动发送
      this.pending.push(cmd)
      return true
    }
    return this.sendRaw(cmd)
  }

  private sendRaw(cmd: string): boolean {
    if (!this.sock) return false
    // 发送帧（真机反汇编 vconsole2.exe 确认，与接收帧头布局不同！）:
    //   offset 0:  "CMND" (4B)
    //   offset 4:  00 D4 (2B 版本)
    //   offset 6:  int32BE (cmd长度+13)  ← 长度是 4 字节
    //   offset 10: 00 00 (2B handle)
    //   offset 12: cmd + \0
    const payload = Buffer.from(cmd + '\0', 'latin1')
    const len = payload.length + 12 // 即 cmd 长度 + 13（12B 头 + 1B 结尾 \0）
    const frame = Buffer.alloc(12 + payload.length)
    frame.write('CMND', 0, 'latin1')
    frame.writeUInt16BE(0x00d4, 4) // 版本 2 字节
    frame.writeUInt32BE(len, 6) // 长度 4 字节大端
    frame.writeUInt16BE(0, 10) // handle
    payload.copy(frame, 12)
    this.sock.write(frame)
    return true
  }

  close(): void {
    this.closed = true
    if (this.readyTimer) clearTimeout(this.readyTimer)
    this.sock?.destroy()
    this.sock = null
    this.isConnected = false
    this.ready = false
  }

  /**
   * 流式解析：缓冲里可能是"帧 + 裸数据"混合，采用魔数扫描——
   * 找到 PRNT/CHAN/AINF/ADON 魔数后按帧头解析，解析失败则跳过 1 字节继续找。
   */
  private drain(): void {
    let idx = this.scanPos
    while (idx + 12 <= this.buf.length) {
      const four = this.buf.toString('latin1', idx, idx + 4)
      if (four === 'PRNT' || four === 'CHAN' || four === 'AINF' || four === 'ADON') {
        const len = this.buf.readInt16BE(idx + 8)
        if (len <= 0 || len > 1 << 20) {
          idx += 1
          continue
        }
        const total = idx + 12 + len
        if (this.buf.length < total) break // 等更多数据
        const payload = this.buf.subarray(idx + 12, total)
        this.handleFrame(four, payload)
        idx = total
        continue
      }
      idx += 1
    }
    // 消耗已处理部分（保留尾部未完成的 12 字节）
    if (idx > 4096) {
      this.buf = this.buf.subarray(idx - 4096)
      this.scanPos = 4096
    } else {
      this.scanPos = idx
    }
  }

  private handleFrame(type: string, payload: Buffer): void {
    switch (type) {
      case 'CHAN': {
        this.parseChannels(payload)
        // 缓冲早期：什么都不做，等缓冲结束标志（=====）才就绪（实测该时序命令才生效）
        break
      }
      case 'PRNT': {
        const text = extractText(payload)
        if (!text) return
        // 缓冲结束标志 → 立即就绪
        if (BUFFER_END_RE.test(text.trim())) {
          this.markReady()
          return
        }
        this.cb.onLine('Console', text)
        break
      }
      case 'AINF':
      case 'ADON':
      default:
        break
    }
  }

  /** CHAN 通道定义：启发式解析（id + 名称），解析失败不阻塞 */
  private parseChannels(payload: Buffer): void {
    let off = 0
    while (off + 28 <= payload.length) {
      const id = payload.readInt32BE(off)
      if (id < 0 || id > 4096) break
      const nameLen = payload.readInt16BE(off + 28 - 2)
      if (nameLen > 0 && nameLen <= 64 && off + 30 + nameLen <= payload.length) {
        const name = payload.subarray(off + 30, off + 30 + nameLen).toString('utf8')
        if (name) this.channels.set(id, { id, name })
        off += 30 + nameLen + 4
        continue
      }
      // 备选布局：id 后直接 2B 长度
      const len2 = payload.readInt16BE(off + 4)
      if (len2 > 0 && len2 <= 64 && off + 6 + len2 <= payload.length) {
        const name = payload.subarray(off + 6, off + 6 + len2).toString('utf8')
        if (name) this.channels.set(id, { id, name })
        off += 6 + len2
        continue
      }
      break
    }
  }
}

/** PRNT payload 文本提取：跳过二进制头，找可读串（真机验证的偏移扫描） */
function extractText(payload: Buffer): string | null {
  for (const off of [0, 4, 8, 12, 16, 20, 24, 28, 32]) {
    if (off >= payload.length) break
    const s = payload.subarray(off).toString('utf8')
    const m = s.match(/[\x20-\x7e\u4e00-\u9fff]{3,}/)
    if (m) return m[0]
  }
  return null
}

/**
 * 开发用 VConsole Mock 服务端：模拟 CS2 的通道（AINF + CHAN + 缓冲 PRNT + CMND 执行）
 * 监听 127.0.0.1:<port>，供无游戏环境验证注入逻辑。
 */
export function startVConsoleMock(port = 29000): { close: () => void } {
  const server = createServer((sock) => {
    const frame = (type: string, payload: Buffer): Buffer => {
      const h = Buffer.alloc(12)
      h.write(type, 0, 'latin1')
      h.writeUInt32BE(0x0000d400, 4)
      h.writeInt16BE(payload.length, 8)
      h.writeInt16BE(0, 10)
      return Buffer.concat([h, payload])
    }
    const prnt = (text: string): Buffer => {
      const b = Buffer.from(text + '\n', 'utf8')
      const payload = Buffer.alloc(28 + b.length)
      payload.writeInt32BE(0, 0)
      b.copy(payload, 28)
      return frame('PRNT', payload)
    }
    const chan = (id: number, name: string): Buffer => {
      const nb = Buffer.from(name, 'utf8')
      const b = Buffer.alloc(4 + 24 + 2 + nb.length + 4)
      b.writeInt32BE(id, 0)
      b.writeInt16BE(nb.length, 28)
      nb.copy(b, 30)
      return b
    }

    // AINF（应用信息）
    const ainf = Buffer.alloc(64)
    ainf.write('cs2', 0, 'latin1')
    sock.write(frame('AINF', ainf))
    // CHAN 定义
    sock.write(frame('CHAN', Buffer.concat([chan(0, 'Console'), chan(1, 'VConComm')])))
    // 缓冲消息 + 结束标志
    sock.write(prnt('mock vconsole buffered line 1'))
    sock.write(prnt('mock vconsole buffered line 2'))
    sock.write(prnt('='.repeat(60)))

    let buf = Buffer.alloc(0)
    sock.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      while (buf.length >= 12) {
        if (buf.toString('latin1', 0, 4) !== 'CMND') {
          buf = buf.subarray(1)
          continue
        }
        const len = buf.readInt16BE(8)
        const total = 12 + len
        if (buf.length < total) return
        const payload = buf.subarray(12, total)
        buf = buf.subarray(total)
        const cmd = payload.toString('utf8').replace(/\0+$/, '').trim()
        if (!cmd) continue
        sock.write(prnt(`exec: ${cmd}`))
        if (cmd.startsWith('demo_gototick')) {
          const tick = cmd.split(' ')[1]
          sock.write(prnt(`[demo] jumped to tick ${tick}`))
        }
      }
    })
  })
  server.listen(port, '127.0.0.1')
  return { close: () => server.close() }
}
