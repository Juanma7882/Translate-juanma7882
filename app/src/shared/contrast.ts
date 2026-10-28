// Contraste de color (WCAG 2.x): usado para validar los colores del overlay y para avisar al usuario.

/** Contraste mínimo exigido entre texto y fondo (AA para texto normal). */
export const MIN_CONTRAST = 4.5

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_PATTERN.test(value)
}

/** `#rrggbb` -> [r, g, b] (0 a 255). */
export function parseHex(color: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16)) as [number, number, number]
}

function channel(value: number): number {
  const s = value / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** Luminancia relativa (0 negro, 1 blanco). */
export function luminance(color: string): number {
  const [r, g, b] = parseHex(color)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Razón de contraste entre dos colores `#rrggbb`, de 1 a 21. */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)]
  const [light, dark] = la >= lb ? [la, lb] : [lb, la]
  return (light + 0.05) / (dark + 0.05)
}

/** `true` si texto y fondo cumplen el contraste mínimo. */
export function hasEnoughContrast(text: string, background: string): boolean {
  return contrastRatio(text, background) >= MIN_CONTRAST
}
