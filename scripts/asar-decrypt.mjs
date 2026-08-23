/**
 * 5E csgoAddon 模块解码（dev only）
 */
import fs from 'node:fs'
import vm from 'node:vm'

const ASAR = 'D:\\61-5EClient\\resources\\app.asar'
const s = fs.readFileSync(ASAR, 'latin1')

// 文件范围: 旋转 IIFE 起点 → module[...]=... 结束
const start = s.indexOf('(function(_0x477906', 34400000)
const end = s.indexOf('=_0x445ac6;', start) + '=_0x445ac6;'.length
const chunk = s.slice(start, end)
console.log(`[csgoAddon] ${start}..${end} (${chunk.length}B)`)

const sandbox = {
  require: () => new Proxy({}, { get: () => () => ({ then: () => undefined }) }),
  module: { exports: {} },
  exports: {},
  console,
  process: { platform: 'win32', env: {}, versions: {} },
  Buffer,
  setTimeout,
  clearTimeout,
  __dirname: 'D:\\61-5EClient',
  __filename: 'D:\\61-5EClient\\app.asar\\csgoAddon.js'
}
sandbox.module.exports = sandbox.exports
sandbox.global = sandbox

try {
  vm.runInNewContext(chunk, sandbox, { timeout: 8000 })
  console.log('[eval OK]')
} catch (e) {
  console.log('[eval error]', e.message)
}

// sendCs2Cmd 内的解码调用（手动换算）:
//   _0x43a0a7(a,b,c,d) = _0x43c2(a-0x1e9, c)
//   _0x32877c(a,b,c,d) = _0x43c2(a-0x163, d)
//   _0x962bfb(a,b,c,d) = _0x43c2(b-0x135, a)
//   _0x5910c1(a,b,c,d) = _0x43c2(b-0x2be, d)
const calls = [
  // _0x43a0a7(a,b,c,d)=_0x43c2(a+0x1e9, c)
  ['_0x43c2', [-0x5b + 0x1e9, -0x65], 'sendCs2Cmd require 模块名'],
  ['_0x43c2', [-0x58 + 0x1e9, -0x5c], '方法名 A'],
  // _0x32877c(a,b,c,d)=_0x43c2(a+0x163, d)
  ['_0x43c2', [0x32 + 0x163, 0x2e], '方法名 B'],
  // _0x962bfb(a,b,c,d)=_0x43c2(b+0x135, a)
  ['_0x43c2', [0x57 + 0x135, 0x5d], 'export key'],
  // _0x5910c1(a,b,c,d)=_0x43c2(b-0x2be, d)
  ['_0x43c2', [0x448 - 0x2be, 0x44d], 'module.exports key']
]

for (const [fn, args, label] of calls) {
  try {
    const r = sandbox[fn](...args)
    console.log(`DEC [${label}] = ${JSON.stringify(r)}`)
  } catch (e) {
    console.log(`FAIL [${label}]`, e.message)
  }
}
