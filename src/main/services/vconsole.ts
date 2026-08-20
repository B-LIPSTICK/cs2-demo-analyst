/**
 * VConsole2 客户端（CS2 -tools 模式的远程控制台通道）
 * 协议（自研实现，基于公开协议观察）:
 *  - 发送: "CMND" + 版本 00 D2 00 00 + int16 BE 长度(len+13) + 00 00 + cmd + 00
 *  - 接收: 4B 类型(PRNT/CHAN/CVAR/AINF/ADON/CFGV) + int32 BE 版本 + int16 BE 长度 + int16 BE handle + payload
 *  - PRNT payload: int32 BE channelID + 24B 未知 + 消息文本; CHAN 定义 id→名称/RGBA
 */
import { createConnection, createServer, type Socket } from 'node:net'

export interface VConsoleCallbacks {
  onConnected: () => void
  onDisconnected: (err?: Error) => void
  onLine: (channel: string, text: string) => void
}

interface Channel {
  id: number
  name: string
  rgba: string
}

export class VConsoleClient {
  private sock: Socket | null = null
  private buf = Buffer.alloc(0)
  private channels = new Map<number, Channel>()
  private cb: VConsoleCallbacks
  private host: string
  private port: number
  private retryTimer: NodeJS.Timeout | null = null
  private connecting = false
  private closed = false

  constructor(cb: VConsoleCallbacks, host = '127.0.0.1', port = 29000) {
    this.cb = cb
    this.host = host
    this.port = port
  }

  get connected(): boolean {
    return Boolean(this.sock && !this.sock.destroyed)
  }

  connect(): void {
    if (this.connecting || this.connected || this.closed) return
    this.connecting = true
    const sock = createConnection({ host: this.host, port: this.port })
    this.sock = sock
    sock.on('connect', () => {
      this.connecting = false
      this.buf = Buffer.alloc(0)
      this.cb.onConnected()
    })
    sock.on('data', (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
      this.drain()
    })
    sock.on('error', (err) => {
      this.connecting = false
      this.cb.onDisconnected(err)
    })
    sock.on('close', () => {
      this.connecting = false
      this.sock = null
      this.cb.onDisconnected()
    })
  }

  sendCommand(cmd: string): boolean {
    if (!this.connected) return false
    const payload = Buffer.from(cmd + '\0', 'latin1')
    const len = payload.length + 13
    const frame = Buffer.alloc(12 + payload.length)
    frame.write('CMND', 0, 'latin1')
    frame.writeUInt32BE(0x0000d200, 4)
    frame.writeInt16BE(len, 8)
    frame.writeInt16BE(0, 10)
    payload.copy(frame, 12)
    this.sock!.write(frame)
    return true
  }

  close(): void {
    this.closed = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.sock?.destroy()
    this.sock = null
  }

  private drain(): void {
    // 最小帧 12B
    while (this.buf.length >= 12) {
      const type = this.buf.toString('latin1', 0, 4)
      const length = this.buf.readInt16BE(8)
      const total = 12 + length
      if (this.buf.length < total) return
      const payload = this.buf.subarray(12, total)
      this.buf = this.buf.subarray(total)
      this.handleFrame(type, payload)
    }
  }

  private handleFrame(type: string, payload: Buffer): void {
    switch (type) {
      case 'CHAN': {
        // channel 定义: 逐条解析（每条: id int32 + 未知 + name + rgba...，用启发式切分）
        this.parseChannels(payload)
        break
      }
      case 'PRNT': {
        const channelId = payload.readInt32BE(0)
        const text = payload.subarray(28).toString('utf8').replace(/\0+$/, '')
        const ch = this.channels.get(channelId)
        this.cb.onLine(ch?.name ?? `ch${channelId}`, text)
        break
      }
      default:
        break
    }
  }

  /**
   * CHAN 帧启发式解析（协议无公开文档，按可观测结构）:
   * 多条记录，每条: [int32 id][24B 未知][int16 nameLen][name utf8][int32 rgba]...
   */
  private parseChannels(payload: Buffer): void {
    let off = 0
    while (off + 28 <= payload.length) {
      const id = payload.readInt32BE(off)
      if (id < 0 || id > 4096) break
      const nameLen = payload.readInt16BE(off + 28 - 2) // 24B 未知后的 2B 长度
      if (nameLen <= 0 || nameLen > 64 || off + 30 + nameLen + 4 > payload.length) {
        // 尝试另一偏移：id 后直接 2B 长度
        const len2 = payload.readInt16BE(off + 4)
        if (len2 > 0 && len2 <= 64 && off + 6 + len2 <= payload.length) {
          const name = payload.subarray(off + 6, off + 6 + len2).toString('utf8')
          if (name) this.channels.set(id, { id, name, rgba: '' })
          off += 6 + len2
          continue
        }
        break
      }
      const name = payload.subarray(off + 30, off + 30 + nameLen).toString('utf8')
      if (name) this.channels.set(id, { id, name, rgba: '' })
      off += 30 + nameLen + 4
    }
  }
}

/**
 * 开发用 VConsole Mock 服务端：模拟 CS2 的控制台通道，便于无游戏环境验证注入逻辑。
 * 监听 127.0.0.1:<port>；收到 CMND 命令后回显 PRNT 帧（如 demo_gototick 回显 "demo_gototick <tick>"）。
 */
export function startVConsoleMock(port = 29000): { close: () => void } {
  const server = createServer((sock) => {
    // 发送 CHAN 定义
    const chan = (id: number, name: string): Buffer => {
      const nameBuf = Buffer.from(name, 'utf8')
      const b = Buffer.alloc(4 + 24 + 2 + nameBuf.length + 4)
      b.writeInt32BE(id, 0)
      b.writeInt16BE(nameBuf.length, 28)
      nameBuf.copy(b, 30)
      return b
    }
    const chans = Buffer.concat([chan(0, 'Console'), chan(1, 'VConComm')])
    const head = (type: string, payload: Buffer): Buffer => {
      const h = Buffer.alloc(12)
      h.write(type, 0, 'latin1')
      h.writeInt32BE(0x0100, 4)
      h.writeInt16BE(payload.length, 8)
      h.writeInt16BE(0, 10)
      return Buffer.concat([h, payload])
    }
    sock.write(head('CHAN', chans))
    sock.on('data', (data: Buffer) => {
      const type = data.toString('latin1', 0, 4)
      if (type !== 'CMND') return
      const cmd = data.subarray(12).toString('utf8').replace(/\0+$/, '').trim()
      if (!cmd) return
      const echo = Buffer.from(`exec: ${cmd}\n`, 'utf8')
      const payload = Buffer.alloc(28 + echo.length)
      payload.writeInt32BE(0, 0)
      echo.copy(payload, 28)
      sock.write(head('PRNT', payload))
      // 对 demo 指令回显额外状态
      if (cmd.startsWith('demo_gototick')) {
        const tick = cmd.split(' ')[1]
        const info = Buffer.from(`\n[demo] jumped to tick ${tick}\n`, 'utf8')
        const p2 = Buffer.alloc(28 + info.length)
        p2.writeInt32BE(0, 0)
        info.copy(p2, 28)
        sock.write(head('PRNT', p2))
      }
    })
  })
  server.listen(port, '127.0.0.1')
  return { close: () => server.close() }
}
