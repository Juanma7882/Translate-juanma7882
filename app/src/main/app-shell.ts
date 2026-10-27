// Ensamblaje de la aplicación de producto: bandeja, atajos, overlay, ajustes y flujo de primer uso.
//
// Todo lo que toca al sistema (bandeja, atajos globales, notificaciones, salir) entra por
// `ShellDeps`, de modo que las pruebas de humo pueden sustituirlo y ejercitar el resto de verdad.

import type { MenuItemConstructorOptions } from 'electron'

import type { AppState, Notice } from '../shared/ipc.ts'
import { scopeForMode } from '../shared/mode.ts'
import { AppController } from './app-controller.ts'
import type { EngineHost } from './engine-host.ts'
import { ModelsService } from './models-service.ts'
import { OverlayController } from './overlay-controller.ts'
import { RegionPicker } from './region-picker.ts'
import type { DisplaySource } from './region-picker.ts'
import { registerSettingsIpc } from './settings-ipc.ts'
import type { SettingsStore } from './settings-store.ts'
import { ShortcutManager } from './shortcuts.ts'
import type { GlobalShortcutLike } from './shortcuts.ts'
import { trayTemplate, trayTooltip } from './tray-menu.ts'
import type { TrayActions } from './tray-menu.ts'
import type { WindowManager } from './windows.ts'
import type { EngineOptions } from 'tr-bindings'

export interface TrayLike {
  update(template: MenuItemConstructorOptions[], tooltip: string): void
  destroy(): void
}

export interface ShellDeps {
  host: EngineHost
  windows: WindowManager
  settings: SettingsStore
  displays: DisplaySource
  tray: TrayLike
  shortcuts: GlobalShortcutLike
  /** Muestra un aviso fuera de las ventanas (notificación del sistema). */
  notify: (notice: Notice) => void
  quit: () => void
  /** Opciones extra del motor (manifiesto alternativo, carpeta de modelos…). */
  engineOverrides?: () => EngineOptions
  /** Cuánto se espera para repetir el mismo aviso. */
  noticeCooldownMs?: number
}

export class AppShell {
  readonly controller: AppController
  readonly overlay: OverlayController
  readonly models: ModelsService
  /** Región pendiente de iniciar cuando termine la descarga de modelos (flujo de primer uso). */
  private awaitingModels = false
  private overlayOpen = false
  private readonly recentNotices = new Map<string, number>()
  private readonly shortcutManager: ShortcutManager
  private disposeIpc: (() => void) | null = null
  private readonly deps: ShellDeps

  constructor(deps: ShellDeps) {
    this.deps = deps
    const { host, windows, settings, displays } = deps

    this.models = new ModelsService(host, settings, () => this.controller.state.running, deps.engineOverrides)
    this.controller = new AppController({
      host,
      windows,
      settings,
      picker: new RegionPicker(windows, displays, () => settings.get().lastRegion),
      configure: () => this.models.configure(),
    })
    this.overlay = new OverlayController(windows, settings, displays)
    this.shortcutManager = new ShortcutManager(deps.shortcuts, (notice) => this.announce(notice))

    this.controller.on('text', (text) => this.overlay.show(text))
    this.controller.on('state', (state) => {
      this.syncMode(state)
      void this.syncOverlay(state.running)
      this.refreshTray()
    })
    this.controller.on('notice', (notice) => this.onNotice(notice))
    settings.onChange((s) => {
      this.overlay.setRegion(s.lastRegion)
      this.applyShortcuts()
      this.refreshTray()
    })
    // Al terminar una descarga que se pidió por faltar modelos, se retoma lo que se quería hacer.
    this.models.onDownloaded(() => {
      if (this.awaitingModels) void this.retryWhenReady()
    })
  }

  /** Retoma lo pendiente solo cuando están listos los modelos del ámbito del modo (auto: texto y audio). */
  private async retryWhenReady(): Promise<void> {
    const { from, to, mode } = this.deps.settings.get()
    try {
      const statuses = await this.models.status(from, to, scopeForMode(mode))
      if (statuses.some((s) => s.state !== 'ready')) return // sigue faltando algo: se espera otra descarga
    } catch {
      // Si no se puede consultar, se intenta igual: el arranque informará de lo que falte.
    }
    if (!this.awaitingModels) return
    this.awaitingModels = false
    void this.controller.startSaved()
  }

  /** Último estado enviado al overlay, para borrar el texto solo cuando cambia de verdad el modo. */
  private shownMode: AppState['mode'] = null

  private syncMode(state: AppState): void {
    if (!state.running) {
      this.shownMode = null
      return
    }
    if (state.mode !== this.shownMode) {
      const changed = this.shownMode !== null
      this.shownMode = state.mode
      // El texto anterior no corresponde al modo nuevo.
      if (changed) this.overlay.clear()
    }
    if (state.mode) this.overlay.setMode(state.paused ? 'paused' : state.mode)
  }

  start(): void {
    this.disposeIpc = registerSettingsIpc({ windows: this.deps.windows, settings: this.deps.settings, models: this.models, host: this.deps.host, controller: this.controller })
    this.deps.host.start()
    this.applyShortcuts()
    this.refreshTray()
  }

  dispose(): void {
    this.shortcutManager.dispose()
    this.disposeIpc?.()
    this.deps.tray.destroy()
    this.overlay.close()
  }

  /** Acciones de la bandeja y de los atajos. */
  readonly actions: TrayActions = {
    chooseRegion: () => void this.controller.chooseRegion(),
    translateLast: () => void this.controller.startSaved(),
    togglePause: () => void this.controller.togglePause(),
    setMode: (mode) => this.controller.setMode(mode),
    stop: () => void this.controller.stop(),
    openSettings: () => void this.deps.windows.openSettings(),
    quit: () => this.deps.quit(),
  }

  /** Aviso al usuario: ventana de Ajustes (si está abierta) y notificación del sistema, sin repetirlo. */
  announce(notice: Notice): void {
    const now = Date.now()
    const last = this.recentNotices.get(notice.message)
    if (last !== undefined && now - last < (this.deps.noticeCooldownMs ?? 10_000)) return
    this.recentNotices.set(notice.message, now)
    this.deps.notify(notice)
  }

  private onNotice(notice: Notice): void {
    this.announce(notice)
    if (notice.code === 'models-missing') {
      // Primer uso: se lleva al usuario a Ajustes, donde ve el tamaño y puede descargar.
      this.awaitingModels = true
      void this.deps.windows.openSettings()
    }
  }

  private async syncOverlay(running: boolean): Promise<void> {
    if (running && !this.overlayOpen) {
      this.overlayOpen = true
      await this.overlay.open(this.deps.settings.get().lastRegion)
      const { mode, paused } = this.controller.state
      if (mode) this.overlay.setMode(paused ? 'paused' : mode)
    } else if (!running && this.overlayOpen) {
      this.overlayOpen = false
      this.overlay.close()
    }
  }

  private applyShortcuts(): void {
    this.shortcutManager.apply(this.deps.settings.get().shortcuts, {
      selectRegion: () => this.actions.chooseRegion(),
      togglePause: () => this.actions.togglePause(),
      toggleMode: () => this.controller.cycleMode(),
    })
  }

  private refreshTray(): void {
    const state = this.controller.state
    this.deps.tray.update(trayTemplate(state, this.deps.settings.get().lastRegion !== null, this.actions, this.deps.settings.get().mode), trayTooltip(state))
  }
}
