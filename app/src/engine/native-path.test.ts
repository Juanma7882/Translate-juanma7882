import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { resolveNativeEntry } from './native-path.ts'

const packaged = join('/res', 'native', 'api.js')

test('TR_NATIVE_DIR tiene prioridad', () => {
  const entry = resolveNativeEntry({ env: { TR_NATIVE_DIR: '/x' }, resourcesPath: '/res', exists: () => true })
  assert.equal(entry, join('/x', 'api.js'))
})

test('app empaquetada: usa resources/native', () => {
  const entry = resolveNativeEntry({ env: {}, resourcesPath: '/res', exists: (p) => p === packaged })
  assert.equal(entry, packaged)
})

test('desarrollo: sin resources/native usa tr-bindings', () => {
  assert.equal(resolveNativeEntry({ env: {}, resourcesPath: '/res', exists: () => false }), null)
  assert.equal(resolveNativeEntry({ env: {}, resourcesPath: undefined, exists: () => true }), null)
})
