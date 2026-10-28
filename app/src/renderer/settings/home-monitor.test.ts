// Qué dice y qué hace la barra de nivel de Inicio según la sesión, el modo y la escucha previa.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { AudioSourceChoice, MonitorState, SessionPhase } from '../../shared/ipc.ts'
import type { Mode } from '../../shared/mode.ts'
import { meterLive, meterNote, meterStatus } from './home.ts'

const SYSTEM: AudioSourceChoice = { kind: 'system' }
const PHASES: SessionPhase[] = ['idle', 'starting', 'running', 'paused', 'waiting', 'error']

function status(phase: SessionPhase, monitor: MonitorState, mode: Mode = 'auto', source: AudioSourceChoice = SYSTEM) {
  return meterStatus({ phase, mode, monitor, source })
}

describe('meterStatus', () => {
  test('con la sesión traduciendo manda la sesión, sea cual sea la escucha', () => {
    for (const monitor of [{ phase: 'idle' }, { phase: 'listening' }, { phase: 'error', reason: 'x' }] as MonitorState[]) {
      assert.deepEqual(status('running', monitor), { kind: 'session' })
    }
  })

  test('iniciando, en pausa o esperando la sesión es la dueña de la barra: no hay nada que decir', () => {
    for (const phase of ['starting', 'paused', 'waiting'] as SessionPhase[]) {
      assert.deepEqual(status(phase, { phase: 'listening' }), { kind: 'idle' }, phase)
    }
  })

  test('en reposo y escuchando dice qué fuente se escucha', () => {
    assert.deepEqual(status('idle', { phase: 'listening' }), { kind: 'listening', source: 'Todo el sistema' })
    assert.deepEqual(status('idle', { phase: 'listening' }, 'audio', { kind: 'app', program: 'firefox.exe' }), { kind: 'listening', source: 'firefox.exe' })
  })

  test('una sesión que terminó en error deja la barra como en reposo', () => {
    assert.deepEqual(status('error', { phase: 'listening' }), { kind: 'listening', source: 'Todo el sistema' })
  })

  test('refleja el resto de estados de la escucha', () => {
    assert.deepEqual(status('idle', { phase: 'starting' }), { kind: 'starting' })
    assert.deepEqual(status('idle', { phase: 'waiting', program: 'firefox.exe' }), { kind: 'waiting', program: 'firefox.exe' })
    assert.deepEqual(status('idle', { phase: 'error', reason: 'sin dispositivo' }), { kind: 'error', reason: 'sin dispositivo' })
    assert.deepEqual(status('idle', { phase: 'idle' }), { kind: 'idle' })
  })

  test('en «Solo texto» la barra explica que el audio no se usa, aunque llegue un estado viejo de la escucha', () => {
    for (const monitor of [{ phase: 'idle' }, { phase: 'listening' }, { phase: 'error', reason: 'x' }] as MonitorState[]) {
      assert.deepEqual(status('idle', monitor, 'text'), { kind: 'text-mode' })
    }
  })

  test('«Solo texto» con la sesión traduciendo sigue siendo la sesión (la barra queda a cero porque no llegan niveles)', () => {
    assert.deepEqual(status('running', { phase: 'idle' }, 'text'), { kind: 'session' })
  })
})

describe('meterLive', () => {
  test('la barra se anima con la sesión traduciendo o con la escucha previa, y nunca en otro caso', () => {
    assert.equal(meterLive({ kind: 'session' }), true)
    assert.equal(meterLive({ kind: 'listening', source: 'Todo el sistema' }), true)
    for (const s of [{ kind: 'starting' }, { kind: 'waiting', program: 'a' }, { kind: 'error', reason: 'x' }, { kind: 'text-mode' }, { kind: 'idle' }] as const) {
      assert.equal(meterLive(s), false, s.kind)
    }
  })

  test('en ninguna fase de la sesión salvo «traduciendo» la sesión anima la barra por sí sola', () => {
    for (const phase of PHASES) {
      assert.equal(meterLive(status(phase, { phase: 'idle' })), phase === 'running', phase)
    }
  })
})

describe('meterNote', () => {
  test('escuchando: nombra la fuente y deja claro que no se guarda ni se traduce nada hasta Iniciar', () => {
    const note = meterNote({ kind: 'listening', source: 'firefox.exe' })
    assert.match(note, /Escuchando/)
    assert.match(note, /firefox\.exe/)
    assert.match(note, /no se guarda ni se traduce/i)
    assert.match(note, /Iniciar/)
  })

  test('esperando, con error y en «Solo texto» cada uno dice lo suyo', () => {
    assert.match(meterNote({ kind: 'waiting', program: 'firefox.exe' }), /firefox\.exe/)
    assert.match(meterNote({ kind: 'error', reason: 'capture error: sin dispositivo' }), /No se pudo escuchar.*sin dispositivo/)
    assert.match(meterNote({ kind: 'text-mode' }), /Solo texto/)
    assert.match(meterNote({ kind: 'starting' }), /Abriendo/)
  })

  test('con la sesión o sin nada que decir no hay nota', () => {
    assert.equal(meterNote({ kind: 'session' }), '')
    assert.equal(meterNote({ kind: 'idle' }), '')
  })
})
