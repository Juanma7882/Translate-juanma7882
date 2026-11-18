// Validación de la carpeta donde se guarda la transcripción: ruta absoluta, existente, carpeta y con
// permiso de escritura. Solo lee metadatos; no crea ni escribe nada.

import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

export type TranscriptDirFailure = 'not-absolute' | 'missing' | 'not-a-folder' | 'not-writable'

export type TranscriptDirCheck = { ok: true } | { ok: false; reason: TranscriptDirFailure }

export async function checkTranscriptDir(path: string): Promise<TranscriptDirCheck> {
  if (!isAbsolute(path)) return { ok: false, reason: 'not-absolute' }
  try {
    if (!(await stat(path)).isDirectory()) return { ok: false, reason: 'not-a-folder' }
  } catch {
    return { ok: false, reason: 'missing' }
  }
  try {
    await access(path, constants.W_OK)
  } catch {
    return { ok: false, reason: 'not-writable' }
  }
  return { ok: true }
}
