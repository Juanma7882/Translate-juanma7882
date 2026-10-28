// Canales del modo "mover overlay". Solo se atienden mensajes de la ventana correspondiente y el
// arrastre solo vale mientras el modo está activo (el overlay normal no puede enviar nada útil).

import { ipcMain } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'

import { Channel } from '../shared/ipc.ts'
import type { OverlayController } from './overlay-controller.ts'
import type { WindowManager } from './windows.ts'

export interface OverlayIpcDeps {
  windows: WindowManager
  overlay: OverlayController
  /** `true` si hay una traducción en marcha (el overlay entonces ya forma parte de la sesión). */
  isRunning: () => boolean
}

export function registerOverlayIpc({ windows, overlay, isRunning }: OverlayIpcDeps): () => void {
  const fromOverlay = (event: IpcMainEvent): boolean => {
    const window = windows.get('overlay')
    return window !== undefined && event.sender === window.webContents
  }
  const fromSettings = (event: IpcMainInvokeEvent): boolean => {
    const window = windows.get('settings')
    return window !== undefined && event.sender === window.webContents
  }

  /** Termina el modo y, si el overlay solo estaba abierto para moverlo, lo cierra. */
  const finish = (): void => {
    overlay.endMove()
    if (overlay.consumeOpenedForMove() && !isRunning()) overlay.close()
  }

  ipcMain.handle(Channel.overlayMove, async (event, active: unknown) => {
    if (!fromSettings(event)) throw new Error('unauthorized sender')
    if (active === true) await overlay.beginMove()
    else finish()
    return overlay.moving
  })
  ipcMain.on(Channel.overlayDrag, (event, dx: unknown, dy: unknown) => {
    if (fromOverlay(event) && typeof dx === 'number' && typeof dy === 'number') overlay.moveBy(dx, dy)
  })
  ipcMain.on(Channel.overlayMoveDone, (event) => {
    if (fromOverlay(event)) finish()
  })
  const onMoving = (active: boolean): void => {
    windows.get('settings')?.webContents.send(Channel.overlayMoveState, active)
  }
  overlay.on('moving', onMoving)

  return () => {
    ipcMain.removeHandler(Channel.overlayMove)
    ipcMain.removeAllListeners(Channel.overlayDrag)
    ipcMain.removeAllListeners(Channel.overlayMoveDone)
    overlay.off('moving', onMoving)
  }
}
