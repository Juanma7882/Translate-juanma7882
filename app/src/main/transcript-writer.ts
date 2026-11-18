// Guardado opcional de la transcripción (spec `transcript-saving`, ADR 0011).
//
// Es el ÚNICO módulo que escribe contenido (texto reconocido y traducciones) a disco, y solo con
// `transcript.enabled` activo y una sesión en marcha. Escribe en la carpeta elegida por el usuario
// un `.txt` (siempre) y un `.srt` (opcional) por sesión, línea a línea, con streams asíncronos para no
// bloquear el proceso principal. Nunca registra el texto ni la ruta en logs ni avisos.

import { EventEmitter } from 'node:events'
import type { WriteStream } from 'node:fs'
import { open, unlink } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import type { OverlayText } from '../shared/ipc.ts'
import type { Settings } from '../shared/settings.ts'
import { formatSrtEntry, formatTxtEntry, normalizeForDedupe, sessionFileName, srtEnd, txtHeader } from '../shared/transcript-format.ts'
import type { TranscriptEntry } from '../shared/transcript-format.ts'

export interface TranscriptSettingsSource {
  get(): Settings
  onChange(listener: (settings: Settings) => void): () => void
}

export interface TranscriptWriterDeps {
  settings: TranscriptSettingsSource
  /** Reloj monótono en ms (las pruebas lo sustituyen). */
  now?: () => number
  /** Fecha de inicio para el nombre de los archivos (las pruebas la fijan). */
  clock?: () => Date
}

interface WriterEvents {
  /** Cambia si se está guardando (archivos abiertos o abriéndose). */
  saving: [boolean]
  /** Falló una escritura: se dejó de guardar durante el resto de la sesión. */
  failed: []
}

/** Intentos de nombre antes de rendirse (`-2`, `-3`…). */
const MAX_NAME_ATTEMPTS = 100

/** Los archivos de una apertura, con el estado de su `.srt`. */
class Files {
  /** La entrada del `.srt` se escribe al conocer la siguiente (su fin es el inicio de ésta). */
  private pendingSrt: TranscriptEntry | null = null
  private srtIndex = 0

  readonly dir: string
  private readonly txt: WriteStream
  private readonly srt: WriteStream | null

  constructor(dir: string, txt: WriteStream, srt: WriteStream | null) {
    this.dir = dir
    this.txt = txt
    this.srt = srt
  }

  onError(listener: () => void): void {
    this.txt.on('error', listener)
    this.srt?.on('error', listener)
  }

  header(startedAt: Date): void {
    this.txt.write(txtHeader(startedAt))
  }

  write(entry: TranscriptEntry): void {
    this.txt.write(formatTxtEntry(entry))
    if (!this.srt) return
    if (this.pendingSrt) this.srt.write(formatSrtEntry(++this.srtIndex, this.pendingSrt, srtEnd(this.pendingSrt.atMs, entry.atMs)))
    this.pendingSrt = entry
  }

  /** Escribe la última entrada del `.srt` y espera a que todo esté en disco (o a que falle). */
  async close(): Promise<void> {
    if (this.srt && this.pendingSrt) this.srt.write(formatSrtEntry(++this.srtIndex, this.pendingSrt, srtEnd(this.pendingSrt.atMs, null)))
    this.pendingSrt = null
    await Promise.all([endStream(this.txt), this.srt ? endStream(this.srt) : Promise.resolve()])
  }

  destroy(): void {
    this.txt.destroy()
    this.srt?.destroy()
  }
}

export class TranscriptWriter extends EventEmitter<WriterEvents> {
  private readonly settings: TranscriptSettingsSource
  private readonly now: () => number
  private readonly clock: () => Date
  private readonly disposeSettings: () => void

  private running = false
  /** Inicio de la sesión en el reloj monótono; la hora de cada línea es relativa a él. */
  private sessionStart = 0
  /** Falló una escritura en esta sesión: no se vuelve a abrir hasta la siguiente. */
  private failed = false

  private phase: 'closed' | 'opening' | 'open' = 'closed'
  /** Cambia en cada apertura y en cada fallo: una apertura que termina tarde sabe que ya no manda. */
  private generation = 0
  private files: Files | null = null
  /** Apertura en curso o última (resuelve con sus archivos, o `null` si falló). */
  private opening: Promise<Files | null> = Promise.resolve(null)
  /** Cola de la apertura en curso: las líneas que llegan antes de tener los archivos. */
  private queue: TranscriptEntry[] = []
  /** Cierre en curso o último: una apertura nueva espera a que termine. */
  private closing: Promise<void> = Promise.resolve()

  private lastKey: string | null = null
  private lastAt = -1

  constructor(deps: TranscriptWriterDeps) {
    super()
    this.settings = deps.settings
    this.now = deps.now ?? (() => performance.now())
    this.clock = deps.clock ?? (() => new Date())
    this.disposeSettings = this.settings.onChange(() => this.sync())
  }

  /** `true` mientras hay archivos abiertos (o abriéndose) para esta sesión. */
  get saving(): boolean {
    return this.phase !== 'closed'
  }

  /** Empieza una sesión: si el guardado está activo se crean archivos nuevos. */
  sessionStarted(): void {
    this.running = true
    this.failed = false
    this.sessionStart = this.now()
    this.lastKey = null
    this.lastAt = -1
    this.sync()
  }

  /** Termina la sesión: se escriben las entradas pendientes y se cierran los archivos. */
  sessionEnded(): Promise<void> {
    this.running = false
    return this.closeFiles()
  }

  /** Línea de la sesión. Solo se guardan las finales, y no se repite una igual a la anterior. */
  line(text: OverlayText): void {
    if (!text.final || this.phase === 'closed') return
    const key = normalizeForDedupe(text.original)
    if (!key || key === this.lastKey) return
    this.lastKey = key
    // Tiempos estrictamente crecientes: dos líneas en el mismo milisegundo no deben empatar en el `.srt`.
    const atMs = Math.max(Math.round(this.now() - this.sessionStart), this.lastAt + 1)
    this.lastAt = atMs
    const entry: TranscriptEntry = { atMs, lang: text.lang, original: text.original, translations: text.translations }
    if (this.phase === 'opening') this.queue.push(entry)
    else this.files?.write(entry)
  }

  /** Cierra todo y deja de escuchar los ajustes. */
  async dispose(): Promise<void> {
    this.disposeSettings()
    this.running = false
    await this.closeFiles()
  }

  // ------------------------------------------------------------------------------- interno

  private wanted(): { dir: string; srt: boolean } | null {
    const { enabled, dir, srt } = this.settings.get().transcript
    return this.running && enabled && dir !== null && !this.failed ? { dir, srt } : null
  }

  /** Abre o cierra según los ajustes y la sesión (también al activarlo o desactivarlo en plena sesión). */
  private sync(): void {
    const want = this.wanted()
    if (!want) {
      if (this.phase !== 'closed') void this.closeFiles()
      return
    }
    if (this.phase === 'closed') this.openFiles(want.dir, want.srt)
    else if (this.files && this.files.dir !== want.dir) {
      // Otra carpeta: se cierran los archivos actuales y se empiezan otros en la nueva.
      void this.closeFiles()
      this.sync()
    }
  }

  private setPhase(phase: 'closed' | 'opening' | 'open'): void {
    const was = this.saving
    this.phase = phase
    if (was !== this.saving) this.emit('saving', this.saving)
  }

  private openFiles(dir: string, withSrt: boolean): void {
    const generation = ++this.generation
    const queue: TranscriptEntry[] = []
    this.queue = queue
    this.setPhase('opening')
    const previousClose = this.closing
    this.opening = (async (): Promise<Files | null> => {
      // Si aún se están cerrando los archivos anteriores, se espera (así no se pisan los nombres).
      await previousClose
      let handles: { txt: FileHandle; srt: FileHandle | null }
      try {
        handles = await openUnique(dir, this.clock(), withSrt)
      } catch {
        if (generation === this.generation) this.fail()
        return null
      }
      const files = new Files(dir, handles.txt.createWriteStream({ encoding: 'utf8' }), handles.srt?.createWriteStream({ encoding: 'utf8' }) ?? null)
      files.onError(() => this.fail(files))
      files.header(this.clock())
      // Lo recibido mientras se abría pertenece a esta apertura, aunque ya se haya pedido cerrarla.
      for (const entry of queue) files.write(entry)
      queue.length = 0
      if (generation === this.generation && this.phase === 'opening') {
        this.files = files
        this.setPhase('open')
      }
      return files
    })()
  }

  /** Error de escritura: se descartan los archivos y no se reabre en esta sesión. */
  private fail(files?: Files): void {
    files?.destroy()
    if (files && files !== this.files && this.phase !== 'opening') {
      // Error de unos archivos que ya se estaban cerrando: se avisa igual, la sesión sigue sin guardar.
      if (!this.failed) {
        this.failed = true
        this.emit('failed')
      }
      return
    }
    if (this.failed) return
    this.failed = true
    this.generation++
    this.files?.destroy()
    this.files = null
    this.setPhase('closed')
    this.emit('failed')
  }

  /** Cierra los archivos actuales (esperando a que termine de abrirlos, si se estaban abriendo). */
  private closeFiles(): Promise<void> {
    if (this.phase === 'closed') return this.closing
    const opening = this.opening
    this.files = null
    this.setPhase('closed')
    this.closing = opening.then((files) => files?.close())
    return this.closing
  }
}

/** Termina un stream y espera a que se cierre (o a que falle: el fallo ya se avisó). */
function endStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.destroyed) return resolve()
    stream.once('close', () => resolve())
    stream.once('error', () => resolve())
    stream.end()
  })
}

const exists = (error: unknown): boolean => (error as NodeJS.ErrnoException | null)?.code === 'EEXIST'

/** Crea `.txt` (y `.srt`) con el mismo nombre libre; nunca abre un archivo que ya exista (`wx`). */
async function openUnique(dir: string, startedAt: Date, withSrt: boolean): Promise<{ txt: FileHandle; srt: FileHandle | null }> {
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
    const base = join(dir, sessionFileName(startedAt, attempt))
    let txt: FileHandle
    try {
      txt = await open(`${base}.txt`, 'wx')
    } catch (error) {
      if (exists(error)) continue
      throw error
    }
    if (!withSrt) return { txt, srt: null }
    try {
      return { txt, srt: await open(`${base}.srt`, 'wx') }
    } catch (error) {
      // El `.txt` lo acabamos de crear vacío: se quita para no dejar restos y se prueba otro nombre.
      await txt.close().catch(() => undefined)
      await unlink(`${base}.txt`).catch(() => undefined)
      if (exists(error)) continue
      throw error
    }
  }
  throw new Error('no free transcript name')
}
