/**
 * 游戏内语音 HUD 纯逻辑单测（与 assets/panorama/scripts/hud/dsh_voice.js 同步）
 * 验证: 脉冲二分查找 / 说话者判定（holdTicks 窗口）/ 排序
 * 用法: node scripts/test-hud-logic.mjs
 */
import assert from 'node:assert'

// ─── 与 dsh_voice.js 相同的纯逻辑（同步维护） ───

function _LatestAtOrBefore(ticks, tick) {
  if (!ticks || ticks.length === 0) return -1
  var lo = 0, hi = ticks.length - 1, result = -1
  while (lo <= hi) {
    var mid = (lo + hi) >> 1
    if (Number(ticks[mid]) <= tick) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return result
}

function _SpeakingSlots(state, data) {
  var result = []
  if (!state || !data || !isFinite(Number(state.nTick))) return result
  var tick = Math.floor(Number(state.nTick))
  var hold = Math.max(1, Math.floor(Number(data.holdTicks || 30)))
  for (var key in data.pulsesBySlot) {
    if (!data.pulsesBySlot.hasOwnProperty(key)) continue
    var slot = Number(key)
    if (!isFinite(slot) || slot < 0 || slot >= 64) continue
    var ticks = data.pulsesBySlot[key]
    var idx = _LatestAtOrBefore(ticks, tick)
    if (idx < 0) continue
    var age = tick - Number(ticks[idx])
    if (age >= 0 && age <= hold) result.push(slot)
  }
  result.sort(function (a, b) { return a - b })
  return result
}

// ─── 测试 ───

const data = {
  holdTicks: 30,
  pulsesBySlot: {
    '0': [100, 200, 300],
    '4': [150, 160, 170],
    '12': [500]
  }
}

// 1) 二分查找边界
assert.strictEqual(_LatestAtOrBefore([100, 200, 300], 99), -1, 'tick 前无脉冲')
assert.strictEqual(_LatestAtOrBefore([100, 200, 300], 100), 0, '恰好命中首个')
assert.strictEqual(_LatestAtOrBefore([100, 200, 300], 250), 1, '中间命中')
assert.strictEqual(_LatestAtOrBefore([100, 200, 300], 999), 2, '最后脉冲')
assert.strictEqual(_LatestAtOrBefore([], 100), -1, '空列表')
console.log('✓ 二分查找 5/5')

// 2) 说话者判定：窗口内/外
let s = _SpeakingSlots({ nTick: 100 }, data)
assert.deepStrictEqual(s, [0], 'tick=100 仅 slot0')
s = _SpeakingSlots({ nTick: 130 }, data)
assert.deepStrictEqual(s, [0], 'tick=130 仍在 hold 窗口(100+30)')
s = _SpeakingSlots({ nTick: 131 }, data)
assert.deepStrictEqual(s, [], 'tick=131 超出窗口')
s = _SpeakingSlots({ nTick: 160 }, data)
assert.deepStrictEqual(s, [4], 'tick=160 仅 slot4')
s = _SpeakingSlots({ nTick: 165 }, data)
assert.deepStrictEqual(s, [4], 'slot4 连续脉冲 165-170 窗口内')
s = _SpeakingSlots({ nTick: 290 }, data)
assert.deepStrictEqual(s, [], 'slot0 300 未到，200 已超窗口')
s = _SpeakingSlots({ nTick: 500 }, data)
assert.deepStrictEqual(s, [12], 'slot12 首脉冲')
s = _SpeakingSlots({ nTick: 530 }, data)
assert.deepStrictEqual(s, [12], 'slot12 窗口内')
console.log('✓ 说话者判定 8/8')

// 3) 多人同时说话排序
const multi = { holdTicks: 30, pulsesBySlot: { '12': [200], '0': [205], '4': [210] } }
s = _SpeakingSlots({ nTick: 210 }, multi)
assert.deepStrictEqual(s, [0, 4, 12], '同时说话按 slot 升序')
console.log('✓ 多人排序 1/1')

// 4) 边界：tick 为 0 / 负数 / NaN
assert.deepStrictEqual(_SpeakingSlots({ nTick: 0 }, data), [], 'tick=0')
assert.deepStrictEqual(_SpeakingSlots({ nTick: -5 }, data), [], '负数 tick')
assert.deepStrictEqual(_SpeakingSlots({}, data), [], '无 state')
assert.deepStrictEqual(_SpeakingSlots({ nTick: 100 }, null), [], '无 data')
console.log('✓ 边界 4/4')

console.log('\n=== HUD 纯逻辑测试全部通过 ===')
