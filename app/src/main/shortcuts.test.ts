import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Notice } from '../shared/ipc.ts'
import { defaultSettings } from '../shared/settings.ts'
import { ShortcutManager } from './shortcuts.ts'
import type { GlobalShortcutLike } from './shortcuts.ts'

function fake(options: { taken?: string[]; invalid?: string[] } = {}) {
  const active = new Map<string, () => void>()
  const api: GlobalShortcutLike = {
    register(accelerator, callback) {
      if (options.invalid?.includes(accelerator)) throw new Error('bad accelerator')
      if (options.taken?.includes(accelerator)) return false
      active.set(accelerator, callback)
      return true
    },
    unregister: (accelerator) => void active.delete(accelerator),
  }
  return { api, active }
}

const handlers = (calls: string[]) => ({ selectRegion: () => calls.push('select'), togglePause: () => calls.push('pause'), toggleMode: () => calls.push('mode') })

test('registra ambos atajos y los invoca', () => {
  const { api, active } = fake()
  const notices: Notice[] = []
  const calls: string[] = []
  const manager = new ShortcutManager(api, (n) => notices.push(n))
  const { shortcuts } = defaultSettings()
  assert.deepEqual(manager.apply(shortcuts, handlers(calls)), [])
  active.get(shortcuts.selectRegion)!()
  active.get(shortcuts.togglePause)!()
  active.get(shortcuts.toggleMode)!()
  assert.deepEqual(calls, ['select', 'pause', 'mode'])
  assert.equal(notices.length, 0)
})

test('un registro fallido se informa con el atajo y qué hacer', () => {
  const { shortcuts } = defaultSettings()
  const { api } = fake({ taken: [shortcuts.togglePause] })
  const notices: Notice[] = []
  const failed = new ShortcutManager(api, (n) => notices.push(n)).apply(shortcuts, handlers([]))
  assert.deepEqual(failed, ['togglePause'])
  assert.equal(notices.length, 1)
  assert.equal(notices[0]!.level, 'warning')
  assert.match(notices[0]!.message, /CommandOrControl\+Shift\+P/)
  assert.match(notices[0]!.message, /Ajustes/)
})

test('una combinación que el sistema rechaza con una excepción también se informa', () => {
  const { shortcuts } = defaultSettings()
  const { api } = fake({ invalid: [shortcuts.selectRegion] })
  const notices: Notice[] = []
  const failed = new ShortcutManager(api, (n) => notices.push(n)).apply(shortcuts, handlers([]))
  assert.deepEqual(failed, ['selectRegion'])
  assert.match(notices[0]!.message, /válida/)
})

test('el mismo atajo para dos acciones se informa en lugar de pisarse', () => {
  const { api } = fake()
  const notices: Notice[] = []
  const failed = new ShortcutManager(api, (n) => notices.push(n)).apply({ selectRegion: 'Alt+X', togglePause: 'alt+x', toggleMode: 'Alt+Y' }, handlers([]))
  assert.deepEqual(failed, ['togglePause'])
  assert.match(notices[0]!.message, /repite/)
})

test('volver a aplicar libera los atajos anteriores', () => {
  const { api, active } = fake()
  const manager = new ShortcutManager(api, () => {})
  manager.apply({ selectRegion: 'Alt+A', togglePause: 'Alt+B', toggleMode: 'Alt+E' }, handlers([]))
  manager.apply({ selectRegion: 'Alt+C', togglePause: 'Alt+D', toggleMode: 'Alt+F' }, handlers([]))
  assert.deepEqual([...active.keys()].sort(), ['Alt+C', 'Alt+D', 'Alt+F'])
  manager.dispose()
  assert.equal(active.size, 0)
})
