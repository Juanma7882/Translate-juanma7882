#!/usr/bin/env node
// Reúne el módulo nativo (napi-rs) en app/build/native para que electron-builder lo copie a
// `resources/native` (extraResources). Incluye: api.js, index.js, los `*.node` y las librerías
// dinámicas que lo acompañen (en crates/tr-bindings, y las de ONNX Runtime que `copy-dylibs` de `ort`
// deja en target/**/release). Falla si no hay ningún `.node`: nunca se empaqueta una app sin motor.
//
// Uso: node scripts/stage-native.mjs [directorio-destino]

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bindings = join(root, 'crates', 'tr-bindings')
const dest = resolve(process.argv[2] ?? join(root, 'app', 'build', 'native'))

const isNode = (name) => name.endsWith('.node')
const isSharedLib = (name) => /\.(dll|dylib)$/i.test(name) || /\.so(\.\d+)*$/.test(name)
const isOnnx = (name) => /onnxruntime/i.test(name) && isSharedLib(name)

function files(dir, accept) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => accept(name) && statSync(join(dir, name)).isFile())
    .map((name) => join(dir, name))
}

const nodes = files(bindings, isNode)
if (nodes.length === 0) {
  console.error(`stage-native: no hay ningún .node en ${bindings}. Compílalo antes: (cd crates/tr-bindings && pnpm run build)`)
  process.exit(1)
}

const releaseDirs = [join(root, 'target', 'release')]
const targetDir = join(root, 'target')
if (existsSync(targetDir)) {
  for (const entry of readdirSync(targetDir)) {
    const dir = join(targetDir, entry, 'release')
    if (existsSync(dir)) releaseDirs.push(dir)
  }
}

const picked = [
  join(bindings, 'api.js'),
  join(bindings, 'index.js'),
  ...nodes,
  ...files(bindings, isSharedLib),
  ...releaseDirs.flatMap((dir) => files(dir, isOnnx)),
]

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
const seen = new Set()
for (const file of picked) {
  if (!existsSync(file)) {
    console.error(`stage-native: falta ${file}`)
    process.exit(1)
  }
  const name = basename(file)
  if (seen.has(name)) continue
  seen.add(name)
  copyFileSync(file, join(dest, name))
  console.log(`stage-native: ${name}`)
}
console.log(`stage-native: ${seen.size} archivos en ${dest}`)
