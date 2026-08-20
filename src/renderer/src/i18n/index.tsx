import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { zh } from './zh'
import { en } from './en'

export type Lang = 'zh' | 'en'
export type TKey = keyof typeof zh

const dicts: Record<Lang, Record<TKey, string>> = { zh, en }

interface I18nCtx {
  lang: Lang
  t: (key: TKey) => string
  tf: (key: TKey, vars: Record<string, string | number>) => string
  setLang: (l: Lang) => void
}

const Ctx = createContext<I18nCtx>({
  lang: 'zh',
  t: (k) => zh[k],
  tf: (k) => zh[k],
  setLang: () => {}
})

export function I18nProvider({
  lang,
  onLangChange,
  children
}: {
  lang: Lang
  onLangChange: (l: Lang) => void
  children: ReactNode
}) {
  const [localLang, setLocalLang] = useState<Lang>(lang)
  const active = lang ?? localLang
  const value = useMemo<I18nCtx>(
    () => ({
      lang: active,
      t: (k) => dicts[active][k] ?? zh[k] ?? k,
      tf: (k, vars) => {
        let s = dicts[active][k] ?? zh[k] ?? k
        for (const [key, val] of Object.entries(vars)) {
          s = s.replaceAll(`{${key}}`, String(val))
        }
        return s
      },
      setLang: (l) => {
        setLocalLang(l)
        onLangChange(l)
      }
    }),
    [active, onLangChange]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useT(): I18nCtx {
  return useContext(Ctx)
}

export function useTKey(): (key: TKey) => string {
  return useContext(Ctx).t
}
