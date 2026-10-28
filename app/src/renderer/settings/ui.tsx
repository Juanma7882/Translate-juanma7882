// Piezas de interfaz reutilizables de Ajustes: pestañas accesibles y campos con error en línea.

import type { ComponentChildren } from 'preact'
import { useRef } from 'preact/hooks'

import { tabForKey } from './form.ts'
import type { Issue, TabSpec } from './form.ts'

// ------------------------------------------------------------------------------------ pestañas

interface TabsProps {
  tabs: readonly TabSpec[]
  active: string
  onChange: (id: string) => void
  children: ComponentChildren
}

/**
 * Pestañas con el patrón WAI-ARIA: `tablist` con una sola pestaña en el orden de tabulación,
 * flechas/Inicio/Fin para moverse y paneles asociados. Los paneles inactivos siguen en el
 * documento pero ocultos (conservan su estado).
 */
export function Tabs({ tabs, active, onChange, children }: TabsProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const onKeyDown = (event: KeyboardEvent) => {
    const next = tabForKey(tabs, active, event.key)
    if (next === null) return
    event.preventDefault()
    onChange(next)
    refs.current[next]?.focus()
  }
  return (
    <>
      <div role="tablist" aria-label="Secciones de Ajustes" class="tablist" onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={tab.id === active}
            aria-controls={`panel-${tab.id}`}
            tabIndex={tab.id === active ? 0 : -1}
            class="tab"
            ref={(el) => {
              refs.current[tab.id] = el
            }}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {children}
    </>
  )
}

export function TabPanel({ id, active, children }: { id: string; active: string; children: ComponentChildren }) {
  return (
    <section role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={id !== active} tabIndex={-1}>
      {children}
    </section>
  )
}

// --------------------------------------------------------------------------- errores en línea

/** Mensaje de error asociado a un control (`aria-describedby`); vacío si no hay error. */
export function FieldError({ id, issues }: { id: string; issues: readonly Issue[] }) {
  const issue = issues.find((i) => i.field === id)
  return (
    <p id={`${id}-error`} class="field-error" hidden={!issue}>
      {issue?.message}
    </p>
  )
}

/** Atributos de accesibilidad de un control según tenga o no error. */
export function fieldProps(id: string, issues: readonly Issue[], hint?: string) {
  const invalid = issues.some((i) => i.field === id)
  const ids = [invalid ? `${id}-error` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ')
  return { id, 'aria-invalid': invalid ? ('true' as const) : undefined, 'aria-describedby': ids || undefined }
}
