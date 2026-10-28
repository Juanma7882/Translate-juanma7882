#!/usr/bin/env bash
# Verifica el paquete linux-x64 en modo directorio: lo genera (sin publicar), comprueba que el
# módulo nativo viaja en resources/native y arranca el binario empaquetado con TR_SMOKE=1
# (prueba de humo del motor) usando ESE .node, no el del árbol de desarrollo.
#
# Uso: scripts/verify-package.sh [--skip-build]
# Variables: LD_LIBRARY_PATH se respeta (en WSL: libs de Electron extraídas, ver CLAUDE.md).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/app"

if [ "${1:-}" != "--skip-build" ]; then
  pnpm run build
  pnpm run stage:native
  pnpm exec electron-builder --linux dir --x64 --publish never
fi

unpacked="dist/linux-unpacked"
[ -d "$unpacked" ] || { echo "falta $unpacked" >&2; exit 1; }
ls "$unpacked/resources/native"/*.node >/dev/null || { echo "el paquete no lleva el .node" >&2; exit 1; }
[ -f "$unpacked/resources/native/api.js" ] || { echo "el paquete no lleva api.js" >&2; exit 1; }

# El paquete no debe llevar modelos ni configuración de usuario.
if find "$unpacked" \( -name models -o -name settings.json \) | grep -q .; then
  echo "el paquete contiene modelos o settings.json" >&2
  exit 1
fi

bin="$(find "$unpacked" -maxdepth 1 -type f -perm -u+x ! -name '*.so*' ! -name chrome-sandbox ! -name chrome_crashpad_handler | head -1)"
echo "binario: $bin"
echo "== TR_SMOKE=1 (motor desde resources/native) =="
TR_SMOKE=1 "$bin" --no-sandbox
