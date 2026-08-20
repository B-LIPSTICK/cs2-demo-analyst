/**
 * Preload：以 contextBridge 暴露类型化 API（见 @shared/types ApiWithEvents）。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { ApiWithEvents, MainEvent, MainEventType, Settings } from '@shared/types'

const api: ApiWithEvents = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:set', patch)
  },
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    detail: (id: string) => ipcRenderer.invoke('library:detail', id),
    addRoot: () => ipcRenderer.invoke('library:addRoot'),
    removeRoot: (root: string) => ipcRenderer.invoke('library:removeRoot', root),
    rescan: () => ipcRenderer.invoke('library:rescan')
  },
  voice: {
    detect: (id: string) => ipcRenderer.invoke('voice:detect', id),
    extract: (id: string) => ipcRenderer.invoke('voice:extract', id)
  },
  asr: {
    transcribe: (id: string, opts?: { players?: string[] }) =>
      ipcRenderer.invoke('asr:transcribe', id, opts),
    cancel: () => ipcRenderer.invoke('asr:cancel')
  },
  live: {
    getStatus: () => ipcRenderer.invoke('live:getStatus'),
    connect: () => ipcRenderer.invoke('live:connect'),
    sendCommand: (cmd: string) => ipcRenderer.invoke('live:sendCommand', cmd),
    jumpTick: (tick: number) => ipcRenderer.invoke('live:jumpTick', tick),
    pause: () => ipcRenderer.invoke('live:pause'),
    resume: () => ipcRenderer.invoke('live:resume'),
    setTimescale: (x: number) => ipcRenderer.invoke('live:setTimescale', x),
    specNext: () => ipcRenderer.invoke('live:specNext'),
    specPrev: () => ipcRenderer.invoke('live:specPrev'),
    specGoto: (userid: number) => ipcRenderer.invoke('live:specGoto', userid),
    launch: (opts?: { toolsMode?: boolean; playDemoPath?: string }) =>
      ipcRenderer.invoke('live:launch', opts),
    installGsi: () => ipcRenderer.invoke('live:installGsi'),
    locateInstall: () => ipcRenderer.invoke('live:locateInstall')
  },
  overlay: {
    setEnabled: (enabled: boolean, demoId?: string) =>
      ipcRenderer.invoke('overlay:setEnabled', enabled, demoId),
    setPosition: (pos: string) => ipcRenderer.invoke('overlay:setPosition', pos),
    setClickThrough: (on: boolean) => ipcRenderer.invoke('overlay:setClickThrough', on),
    getState: () => ipcRenderer.invoke('overlay:getState'),
    setFullPanel: (enabled: boolean, demoId?: string) =>
      ipcRenderer.invoke('overlay:setFullPanel', enabled, demoId),
    command: (cmd: string, arg?: number) => ipcRenderer.invoke('overlay:command', cmd, arg)
  },
  engines: {
    status: () => ipcRenderer.invoke('engines:status'),
    ensure: (kind: string) => ipcRenderer.invoke('engines:ensure', kind)
  },
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    revealInFolder: (path: string) => ipcRenderer.invoke('app:revealInFolder', path)
  },
  onEvent: <T extends MainEventType>(
    type: T,
    cb: (e: Extract<MainEvent, { type: T }>) => void
  ) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: Extract<MainEvent, { type: T }>) =>
      cb(payload)
    ipcRenderer.on(type, listener)
    return () => ipcRenderer.removeListener(type, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
