/** 地图代号 → 界面展示名。仅收录常用竞技图，未知值原样返回。 */
const MAP_DISPLAY_NAMES: Record<string, string> = {
  de_dust2: 'Dust II',
  dust2: 'Dust II',
  de_mirage: 'Mirage',
  mirage: 'Mirage',
  de_inferno: 'Inferno',
  inferno: 'Inferno',
  de_anubis: 'Anubis',
  anubis: 'Anubis',
  de_nuke: 'Nuke',
  nuke: 'Nuke',
  de_ancient: 'Ancient',
  ancient: 'Ancient',
  de_train: 'Train',
  train: 'Train',
  de_vertigo: 'Vertigo',
  vertigo: 'Vertigo',
  de_overpass: 'Overpass',
  overpass: 'Overpass'
}

/**
 * 把 demo 中的地图代号格式化为展示名。
 * 例：de_dust2 / dust2 → Dust II；de_mirage / mirage → Mirage。
 * 未收录的值（含自定义地图）保持原样，避免破坏数据层原始语义。
 */
export function formatMapName(raw?: string | null): string {
  if (!raw) return ''
  const key = raw.trim().toLowerCase()
  return MAP_DISPLAY_NAMES[key] ?? raw
}
