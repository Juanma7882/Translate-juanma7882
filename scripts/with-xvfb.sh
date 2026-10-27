#!/usr/bin/env bash
# Ejecuta un comando con un servidor X virtual (Xvfb) como pantalla.
#
# Sirve para probar la captura de pantalla real sin pantalla física: bajo WSLg (Wayland) `xcap` no
# puede capturar, pero sobre Xvfb sí. Uso:
#   scripts/with-xvfb.sh cargo test -p tr-adapters --test xcap_real -- --ignored
#
# Usa el Xvfb del sistema (`sudo apt install xvfb`) o, si no existe, uno extraído en
# ~/.local/xvfb (ver CLAUDE.md), que se arranca sin privilegios con un overlayfs que añade
# `xkbcomp` a /usr/bin dentro de un namespace de usuario.
#
# Variables: XVFB_DISPLAY (por defecto :99) y XVFB_GEOMETRY (por defecto 1280x720x24).
set -euo pipefail

display="${XVFB_DISPLAY:-:99}"
geometry="${XVFB_GEOMETRY:-1280x720x24}"
log="$(mktemp)"
overlay=""

if command -v Xvfb >/dev/null 2>&1; then
  Xvfb "$display" -screen 0 "$geometry" -nolisten tcp >"$log" 2>&1 &
  xvfb_pid=$!
elif [ -x "$HOME/.local/xvfb/usr/bin/Xvfb" ]; then
  root="$HOME/.local/xvfb"
  overlay="$(mktemp -d)"
  mkdir -p "$overlay/upper" "$overlay/work"
  cp "$root/usr/bin/xkbcomp" "$overlay/upper/xkbcomp"
  LD_LIBRARY_PATH="$root/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}" \
    unshare -rm bash -c "
      mount -t overlay overlay -o lowerdir=/usr/bin,upperdir=$overlay/upper,workdir=$overlay/work /usr/bin || exit 97
      exec '$root/usr/bin/Xvfb' '$display' -screen 0 '$geometry' -nolisten tcp -xkbdir '$root/usr/share/X11/xkb'
    " >"$log" 2>&1 &
  xvfb_pid=$!
else
  echo "Xvfb no está instalado: ejecuta 'sudo apt install xvfb'" >&2
  exit 1
fi

cleanup() {
  kill "$xvfb_pid" 2>/dev/null || true
  wait "$xvfb_pid" 2>/dev/null || true
  [ -z "$overlay" ] || rm -rf "$overlay"
  rm -f "$log"
}
trap cleanup EXIT

# Esperar a que el servidor acepte conexiones (el socket aparece en /proc/net/unix).
ready=0
for _ in $(seq 1 50); do
  if ! kill -0 "$xvfb_pid" 2>/dev/null; then
    echo "Xvfb terminó antes de tiempo:" >&2
    tail -5 "$log" >&2
    exit 1
  fi
  if grep -q "X${display#:}\$" /proc/net/unix; then ready=1; break; fi
  sleep 0.1
done
[ "$ready" = 1 ] || { echo "Xvfb no abrió su socket a tiempo" >&2; exit 1; }

export DISPLAY="$display"
unset WAYLAND_DISPLAY
export XDG_SESSION_TYPE=x11
"$@"
