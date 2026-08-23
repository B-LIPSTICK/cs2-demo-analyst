/** 找 5E asar 里 playDemo 业务调用与 cmdLine 传参 */
import fs from 'node:fs'

const s = fs.readFileSync('D:\\61-5EClient\\resources\\app.asar', 'latin1')

const patterns = [
  /\.playDemo\(\s*['"]/,
  /playDemo\(\s*['"]/,
  /playDemo\(\s*\w+,\s*['"]/
]
for (const re of patterns) {
  let m, n = 0
  re.lastIndex = 0
  while ((m = re.exec(s)) && n < 8) {
    const at = m.index
    console.log(`=== ${re.source} @${at} ===`)
    console.log(s.slice(Math.max(0, at - 300), at + 500).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ') + '\n')
    n++
    re.lastIndex = at + 10
  }
}

for (const kw of ['fe:play-demo', 'play-demo', 'cmdLine']) {
  let i = 0, n = 0
  while ((i = s.indexOf(kw, i + 1)) >= 0 && n < 8) {
    console.log(`### ${kw} @${i}: ` + JSON.stringify(s.slice(i - 220, i + 260).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ')))
    n++
  }
}
