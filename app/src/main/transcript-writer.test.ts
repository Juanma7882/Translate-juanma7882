import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import type { OverlayText } from '../shared/ipc.ts'
import { applyPatch, defaultSettings } from '../shared/settings.ts'
import type { Settings, SettingsPatch } from '../shared/settings.ts'
import { TranscriptWriter } from './transcript-writer.ts'

const START = new Date(2026, 10, 17, 18, 30, 5)
const BASE = 'transcripcion-2026-11-17_18-30-05'

/** Ajustes en memoria con suscriptores, como `SettingsStore` pero sin disco. */
function fakeSettings(initial: SettingsPatch) {
  let current: Settings = defaultSettings()
  const listeners = new Set<(s: Settings) => void>()
  const store = {
    get: () => structuredClone(current),
    onChange(listener: (s: Settings) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update(patch: SettingsPatch) {
      const result = applyPatch(current, patch)
      if (!result.ok) throw new Error(result.errors.join())
      current = result.settings
      for (const l of listeners) l(store.get())
    },
  }
  store.update(initial)
  return store
}

function setup(transcript: Partial<Settings['transcript']> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tr-transcript-'))
  const settings = fakeSettings({ transcript: { enabled: true, dir, ...transcript } })
  let now = 0
  const writer = new TranscriptWriter({ settings, now: () => now, clock: () => START })
  const failures: number[] = []
  writer.on('failed', () => failures.push(now))
  return {
    dir,
    settings,
    writer,
    failures,
    at(ms: number) {
      now = ms
    },
    files: () => readdirSync(dir).sort(),
    read: (name: string) => readFileSync(join(dir, name), 'utf8'),
  }
}

const line = (original: string, es: string, final = true): OverlayText => ({ original, lang: 'en', translations: [{ lang: 'es', text: es }], final })

/** Espera a que los archivos estén abiertos (la apertura es asíncrona). */
async function opened(writer: TranscriptWriter): Promise<void> {
  for (let i = 0; i < 50 && (writer as unknown as { phase: string }).phase === 'opening'; i++) await new Promise((resolve) => setTimeout(resolve, 5))
}

describe('TranscriptWriter', () => {
  test('desactivado no crea ningún archivo', async () => {
    const t = setup({ enabled: false })
    t.writer.sessionStarted()
    t.writer.line(line('Hello', 'Hola'))
    await t.writer.sessionEnded()
    assert.deepEqual(t.files(), [])
    assert.equal(t.writer.saving, false)
  })

  test('guarda solo las líneas finales, sin repetir, en .txt y .srt', async () => {
    const t = setup()
    t.writer.sessionStarted()
    assert.equal(t.writer.saving, true)
    t.at(500)
    t.writer.line(line('Hello', '', false)) // parcial: no se guarda
    t.at(1000)
    t.writer.line(line('Hello everyone', 'Hola a todos'))
    t.at(1200)
    t.writer.line(line('Hello  everyone', 'Hola a todos')) // repetida: no se guarda
    t.at(4000)
    t.writer.line(line('Good morning', 'Buenos días'))
    await t.writer.sessionEnded()

    assert.deepEqual(t.files(), [`${BASE}.srt`, `${BASE}.txt`])
    assert.equal(
      t.read(`${BASE}.txt`),
      'Transcripción · inicio 2026-11-17 18:30:05\n\n' +
        '[00:00:01] [en] Hello everyone\n           [es] Hola a todos\n\n' +
        '[00:00:04] [en] Good morning\n           [es] Buenos días\n\n',
    )
    assert.equal(
      t.read(`${BASE}.srt`),
      '1\n00:00:01,000 --> 00:00:04,000\nHello everyone\nHola a todos\n\n' + '2\n00:00:04,000 --> 00:00:11,000\nGood morning\nBuenos días\n\n',
    )
    assert.equal(t.writer.saving, false)
  })

  test('las líneas que llegan mientras se abren los archivos no se pierden', async () => {
    const t = setup()
    t.writer.sessionStarted()
    t.writer.line(line('Uno', 'One'))
    t.at(2000)
    t.writer.line(line('Dos', 'Two'))
    await t.writer.sessionEnded()
    assert.match(t.read(`${BASE}.txt`), /Uno[\s\S]*Dos/)
  })

  test('sin .srt solo se crea el .txt', async () => {
    const t = setup({ srt: false })
    t.writer.sessionStarted()
    t.writer.line(line('Hello', 'Hola'))
    await t.writer.sessionEnded()
    assert.deepEqual(t.files(), [`${BASE}.txt`])
  })

  test('nunca sobrescribe un archivo existente: usa un sufijo', async () => {
    const t = setup()
    writeFileSync(join(t.dir, `${BASE}.srt`), 'de otra persona')
    t.writer.sessionStarted()
    t.writer.line(line('Hello', 'Hola'))
    await t.writer.sessionEnded()
    assert.equal(t.read(`${BASE}.srt`), 'de otra persona')
    assert.deepEqual(t.files(), [`${BASE}-2.srt`, `${BASE}-2.txt`, `${BASE}.srt`], 'no deja un .txt vacío con el nombre ocupado')
  })

  test('cada sesión escribe archivos nuevos', async () => {
    const t = setup()
    t.writer.sessionStarted()
    t.writer.line(line('A', 'A'))
    await t.writer.sessionEnded()
    t.writer.sessionStarted()
    t.writer.line(line('B', 'B'))
    await t.writer.sessionEnded()
    assert.deepEqual(t.files(), [`${BASE}-2.srt`, `${BASE}-2.txt`, `${BASE}.srt`, `${BASE}.txt`])
  })

  test('activar a mitad de sesión guarda solo lo posterior, con la hora desde el inicio', async () => {
    const t = setup({ enabled: false })
    const seen: boolean[] = []
    t.writer.on('saving', (s) => seen.push(s))
    t.writer.sessionStarted()
    t.at(1000)
    t.writer.line(line('Antes', 'Before'))
    t.settings.update({ transcript: { enabled: true } })
    await opened(t.writer)
    t.at(65_000)
    t.writer.line(line('Después', 'After'))
    await t.writer.sessionEnded()
    const txt = t.read(`${BASE}.txt`)
    assert.doesNotMatch(txt, /Antes/)
    assert.match(txt, /\[00:01:05\] \[en\] Después/)
    assert.deepEqual(seen, [true, false])
  })

  test('desactivar a mitad de sesión cierra y no escribe más', async () => {
    const t = setup()
    t.writer.sessionStarted()
    t.writer.line(line('Uno', 'One'))
    await opened(t.writer)
    t.settings.update({ transcript: { enabled: false } })
    assert.equal(t.writer.saving, false)
    t.writer.line(line('Dos', 'Two'))
    await t.writer.sessionEnded()
    const txt = t.read(`${BASE}.txt`)
    assert.match(txt, /Uno/)
    assert.doesNotMatch(txt, /Dos/)
    assert.match(t.read(`${BASE}.srt`), /^1\n00:00:00,000 --> 00:00:07,000\nUno/)
  })

  test('pausa y reanudación siguen en los mismos archivos', async () => {
    const t = setup()
    t.writer.sessionStarted()
    t.writer.line(line('Antes de la pausa', 'x'))
    // Pausar no termina la sesión: el controlador sigue en marcha (running) y no se llama a sessionEnded.
    t.at(30_000)
    t.writer.line(line('Tras reanudar', 'y'))
    await t.writer.sessionEnded()
    assert.deepEqual(t.files(), [`${BASE}.srt`, `${BASE}.txt`])
    assert.match(t.read(`${BASE}.txt`), /\[00:00:30\] \[en\] Tras reanudar/)
  })

  test('si la carpeta desaparece avisa una vez, deja de guardar en la sesión y vuelve en la siguiente', async () => {
    const t = setup()
    rmSync(t.dir, { recursive: true, force: true })
    t.writer.sessionStarted()
    t.writer.line(line('Hello', 'Hola'))
    await opened(t.writer)
    await opened(t.writer)
    assert.equal(t.failures.length, 1)
    assert.equal(t.writer.saving, false)
    t.writer.line(line('Otra', 'Other'))
    t.settings.update({ transcript: { srt: false } }) // un cambio de ajustes no la reabre en esta sesión
    assert.equal(t.writer.saving, false)
    await t.writer.sessionEnded()

    // En la sesión siguiente, con la carpeta de vuelta, se guarda otra vez.
    mkdirSync(t.dir, { recursive: true })
    t.writer.sessionStarted()
    t.writer.line(line('Nueva', 'New'))
    await t.writer.sessionEnded()
    assert.deepEqual(t.files(), [`${BASE}.txt`])
    assert.equal(t.failures.length, 1)
  })
})
