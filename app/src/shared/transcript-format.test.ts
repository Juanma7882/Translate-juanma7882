import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { clockTime, formatSrtEntry, formatTxtEntry, normalizeForDedupe, sessionFileName, srtEnd, srtTime, txtHeader } from './transcript-format.ts'

const entry = {
  atMs: 83_250,
  lang: 'en',
  original: 'Good morning',
  translations: [
    { lang: 'es', text: 'Buenos días' },
    { lang: 'fr', text: 'Bonjour' },
  ],
}

describe('tiempos', () => {
  test('HH:MM:SS y HH:MM:SS,mmm', () => {
    assert.equal(clockTime(83_250), '00:01:23')
    assert.equal(srtTime(83_250), '00:01:23,250')
    assert.equal(srtTime(3_723_004), '01:02:03,004')
    assert.equal(srtTime(-5), '00:00:00,000')
  })

  test('el fin se acota entre 1 y 7 s y nunca pisa la siguiente', () => {
    assert.equal(srtEnd(0, 3000), 3000)
    assert.equal(srtEnd(0, 20_000), 7000)
    assert.equal(srtEnd(0, 1500), 1500)
    assert.equal(srtEnd(0, 400), 400, 'si la siguiente empieza antes de 1 s, termina ahí')
    assert.equal(srtEnd(5000, null), 12_000, 'la última dura 7 s')
  })
})

describe('.txt', () => {
  test('hora, original con idioma y traducciones en orden', () => {
    assert.equal(formatTxtEntry(entry), '[00:01:23] [en] Good morning\n           [es] Buenos días\n           [fr] Bonjour\n\n')
  })

  test('sin traducciones guarda solo el original', () => {
    assert.equal(formatTxtEntry({ ...entry, translations: [] }), '[00:01:23] [en] Good morning\n\n')
  })

  test('los saltos de línea del texto se aplanan', () => {
    assert.equal(formatTxtEntry({ ...entry, original: 'Good\nmorning ', translations: [{ lang: 'es', text: '' }] }), '[00:01:23] [en] Good morning\n\n')
  })

  test('la cabecera solo lleva la fecha', () => {
    assert.equal(txtHeader(new Date(2026, 10, 17, 18, 30, 5)), 'Transcripción · inicio 2026-11-17 18:30:05\n\n')
  })
})

describe('.srt', () => {
  test('entrada numerada con tiempos y una línea por idioma', () => {
    assert.equal(formatSrtEntry(1, entry, 86_000), '1\n00:01:23,250 --> 00:01:26,000\nGood morning\nBuenos días\nBonjour\n\n')
  })

  test('una línea en blanco dentro del texto no corta la entrada', () => {
    const text = formatSrtEntry(2, { ...entry, original: 'a\n\nb', translations: [] }, 90_000)
    assert.equal(text.trimEnd().split('\n\n').length, 1)
  })
})

describe('nombres y dedupe', () => {
  test('nombre con fecha y hora locales y sufijo en reintentos', () => {
    const date = new Date(2026, 10, 17, 18, 30, 5)
    assert.equal(sessionFileName(date), 'transcripcion-2026-11-17_18-30-05')
    assert.equal(sessionFileName(date, 3), 'transcripcion-2026-11-17_18-30-05-3')
  })

  test('la normalización ignora espacios y saltos de línea', () => {
    assert.equal(normalizeForDedupe('  Hello\n  world '), normalizeForDedupe('Hello world'))
  })
})
