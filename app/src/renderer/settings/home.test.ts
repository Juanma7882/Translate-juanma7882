import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { SessionPhase } from '../../shared/ipc.ts'
import {
  ADVICE_WINDOW_MS,
  audioSourceOf,
  choiceToValue,
  controlsFor,
  createLevelStore,
  levelAdvice,
  levelToPercent,
  phaseLabel,
  phaseOf,
  smoothLevel,
  sourceOptions,
  statusSentence,
  valueToChoice,
  withPending,
} from './home.ts'
import type { LevelSample } from './home.ts'

const PHASES: SessionPhase[] = ['idle', 'starting', 'running', 'paused', 'waiting', 'error']

describe('controlsFor', () => {
  test('Iniciar solo en reposo o error', () => {
    for (const p of PHASES) assert.equal(controlsFor(p).start, p === 'idle' || p === 'error', p)
  })
  test('durante starting solo se puede detener', () => {
    assert.deepEqual(controlsFor('starting'), { start: false, pause: false, restart: false, stop: true, pauseLabel: 'Pausar', pauseAction: 'pause' })
  })
  test('en marcha: pausar, reiniciar y detener', () => {
    const c = controlsFor('running')
    assert.ok(c.pause && c.restart && c.stop && !c.start)
    assert.equal(c.pauseLabel, 'Pausar')
  })
  test('en pausa el botón reanuda y reiniciar sigue disponible', () => {
    const c = controlsFor('paused')
    assert.ok(c.pause && c.restart && c.stop)
    assert.equal(c.pauseLabel, 'Reanudar')
    assert.equal(c.pauseAction, 'resume')
  })
  test('en reposo no hay nada que detener, pausar ni reiniciar', () => {
    const c = controlsFor('idle')
    assert.ok(!c.pause && !c.restart && !c.stop)
  })
  test('esperando: reiniciar y detener', () => {
    const c = controlsFor('waiting')
    assert.ok(c.restart && c.stop && !c.start && !c.pause)
  })
  test('con una orden pendiente solo queda Detener', () => {
    const c = withPending(controlsFor('running'), true)
    assert.ok(c.stop && !c.pause && !c.restart && !c.start)
    assert.equal(withPending(controlsFor('idle'), true).start, false)
    assert.equal(withPending(controlsFor('idle'), false).start, true)
  })
})

describe('fase y texto', () => {
  test('sin fase se deduce de running/paused', () => {
    assert.equal(phaseOf({ running: false, paused: false }), 'idle')
    assert.equal(phaseOf({ running: true, paused: false }), 'running')
    assert.equal(phaseOf({ running: true, paused: true }), 'paused')
    assert.equal(phaseOf({ running: true, paused: false, phase: 'waiting' }), 'waiting')
  })
  test('esperando nombra el programa', () => {
    assert.equal(phaseLabel('waiting', 'firefox.exe'), 'Esperando a firefox.exe')
    assert.match(statusSentence('running', undefined, 'Audio', 'Todo el sistema'), /Traduciendo.*Audio.*Todo el sistema/)
  })
})

describe('fuente de audio', () => {
  test('conversión valor <-> elección', () => {
    assert.equal(choiceToValue({ kind: 'system' }), 'system')
    assert.deepEqual(valueToChoice('app:chrome.exe'), { kind: 'app', program: 'chrome.exe' })
    assert.deepEqual(valueToChoice('system'), { kind: 'system' })
    assert.deepEqual(valueToChoice('app:'), { kind: 'system' })
  })
  test('lista aplicaciones sin duplicar nombres', () => {
    const r = sourceOptions(
      {
        supported: true,
        apps: [
          { id: 1, name: 'a.exe' },
          { id: 2, name: 'a.exe' },
          { id: 3, name: 'b.exe' },
        ],
      },
      { kind: 'system' },
    )
    assert.deepEqual(
      r.options.map((o) => o.value),
      ['system', 'app:a.exe', 'app:b.exe'],
    )
    assert.equal(r.note, null)
  })
  test('la elegida que no suena se conserva', () => {
    const r = sourceOptions({ supported: true, apps: [] }, { kind: 'app', program: 'x.exe' })
    assert.equal(r.options[1]?.label, 'x.exe (no está sonando)')
  })
  test('plataforma sin soporte: solo sistema y motivo', () => {
    const r = sourceOptions({ supported: false, reason: 'macOS 13 no lo permite' }, { kind: 'system' })
    assert.equal(r.options.length, 1)
    assert.match(r.note ?? '', /macOS 13/)
  })
  test('error de consulta', () => {
    assert.equal(sourceOptions(null, { kind: 'system' }, true).note, 'No se pudo consultar las aplicaciones')
  })
  test('ajustes antiguos sin campo son todo el sistema', () => {
    assert.deepEqual(audioSourceOf({}), { kind: 'system' })
    assert.deepEqual(audioSourceOf({ audioSource: { kind: 'app', program: 'z' } }), { kind: 'app', program: 'z' })
  })
})

describe('escala y caída', () => {
  test('dBFS a porcentaje', () => {
    assert.equal(levelToPercent(0), 0)
    assert.equal(levelToPercent(-1), 0)
    assert.equal(levelToPercent(Number.NaN), 0)
    assert.equal(levelToPercent(1), 100)
    assert.equal(levelToPercent(2), 100)
    assert.ok(Math.abs(levelToPercent(0.001)) < 1e-9)
    assert.ok(Math.abs(levelToPercent(0.01) - (20 / 60) * 100) < 1e-9) // -40 dBFS
    assert.ok(levelToPercent(0.1) > levelToPercent(0.01))
  })
  test('sube al instante y baja con el tiempo', () => {
    assert.equal(smoothLevel(10, 60, 16), 60)
    assert.equal(smoothLevel(60, 10, 100, 100), 50)
    assert.equal(smoothLevel(60, 10, 10_000, 100), 10)
    assert.equal(smoothLevel(60, 10, 0), 60)
  })
})

describe('levelAdvice', () => {
  const T = 0.01
  /** Muestras cada 100 ms entre `from` y `to` con el nivel dado. */
  const series = (from: number, to: number, rms: number, peak = rms): LevelSample[] => {
    const out: LevelSample[] = []
    for (let t = from; t <= to; t += 100) out.push({ t, rms, peak })
    return out
  }
  const now = 10_000

  test('sin sesión no hay avisos', () => {
    assert.equal(levelAdvice(series(4000, now, 0), T, now, { running: false }), null)
  })
  test('sin historial no hay avisos', () => {
    assert.equal(levelAdvice([], T, now), null)
  })
  test('nivel cero sostenido: no llega audio', () => {
    assert.equal(levelAdvice(series(4000, now, 0), T, now), 'none')
  })
  test('señal bajo el umbral sostenida: audio bajo', () => {
    assert.equal(levelAdvice(series(4000, now, 0.003, 0.01), T, now), 'low')
  })
  test('voz por encima del umbral: sin aviso', () => {
    assert.equal(levelAdvice(series(4000, now, 0.05), T, now), null)
  })
  test('un pico de voz dentro de la ventana evita el aviso', () => {
    const h = [...series(4000, 7000, 0.003), ...series(7100, 7200, 0.05), ...series(7300, now, 0.003)]
    assert.equal(levelAdvice(h, T, now), null)
  })
  test('muy poco tiempo observado: aún no se avisa', () => {
    assert.equal(levelAdvice(series(8000, now, 0), T, now), null)
  })
  test('el flujo de niveles cortado no genera aviso', () => {
    assert.equal(levelAdvice(series(0, 6000, 0), T, now), null)
  })
  test('el tiempo es inyectable', () => {
    const h = series(0, 5000, 0)
    assert.equal(levelAdvice(h, T, 5000), 'none')
    assert.equal(levelAdvice(h, T, 20_000), null)
    assert.equal(ADVICE_WINDOW_MS, 5000)
  })
})

describe('createLevelStore', () => {
  test('guarda historial, recorta y se anula si está viejo', () => {
    let t = 0
    const store = createLevelStore(() => t, 1000)
    store.push({ rms: 0.2, peak: 0.3 })
    t = 500
    store.push({ rms: 0.4, peak: 0.5 })
    assert.equal(store.latest(), 0.4)
    t = 2100
    assert.equal(store.latest(), 0)
    store.push({ rms: 0.1, peak: 0.1 })
    assert.equal(store.history().length, 1)
    store.clear()
    assert.equal(store.history().length, 0)
  })
})
