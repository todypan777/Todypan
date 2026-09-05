// ─────────────────────────────────────────────────────────────────────────────
// PDFKIT — piezas para armar un informe en PDF con jsPDF
//
// jsPDF dibuja rectángulos y escribe texto; no sabe de "gráficas". Aquí están
// las piezas que sí: barras, anillo, tabla, tarjetas de cifra y el armazón de
// la página (título, pie, salto automático). El informe se escribe entonces
// como una lista de secciones, no como cientos de coordenadas sueltas.
//
// Todo va en MILÍMETROS sobre A4 vertical (210 × 297). El eje Y crece hacia
// abajo, como en pantalla.
//
// ── Por qué no se usa una librería de gráficas ───────────────────────────────
// Las librerías de gráficas dibujan en <canvas> y se pegan al PDF como imagen:
// el texto deja de ser texto (no se puede buscar ni copiar), se ve borroso al
// imprimir y suma megas al archivo. Dibujarlas en vectores es más código una
// sola vez y un PDF nítido para siempre. jsPDF ya estaba en el proyecto.
//
// ── Sobre los acentos ────────────────────────────────────────────────────────
// Las fuentes que jsPDF trae de fábrica solo cubren Latin-1. Las tildes y la ñ
// están ahí y salen bien; la raya larga, las comillas curvas y los emojis NO —
// y en vez de fallar, imprimen basura. Por eso TODO el texto pasa por latin1().
// ─────────────────────────────────────────────────────────────────────────────

import { jsPDF } from 'jspdf'

export const PAGE_W = 210
export const PAGE_H = 297
export const MARGIN = 15
export const CONTENT_W = PAGE_W - MARGIN * 2
const FOOTER_H = 14

// ── Colores ──────────────────────────────────────────────────────────────────
// La paleta de la app es cálida y de poco croma: preciosa en pantalla, pero
// como colores de gráfica no se distinguen entre sí (un daltónico protán ve el
// cobre y el salvia como el mismo color). Estos cuatro están verificados: se
// separan a la vista normal Y con los tres tipos de daltonismo, y todos pasan
// 3:1 de contraste contra el papel. El ORDEN importa: se asignan siempre en
// esta secuencia, nunca en rueda.
export const CAT = [
  [14, 143, 92],    // #0E8F5C  verde
  [45, 110, 168],   // #2D6EA8  azul
  [208, 106, 22],   // #D06A16  naranja
  [155, 58, 110],   // #9B3A6E  ciruela
]

export const INK = [23, 22, 19]
export const BODY = [58, 53, 46]
export const MUTED = [110, 102, 90]
export const FAINT = [150, 141, 128]
export const LINE = [223, 215, 204]
export const SURFACE = [250, 247, 242]
export const WHITE = [255, 255, 255]

export const VENTAS = CAT[0]       // lo que entra
export const GASTOS = CAT[3]       // lo que sale
export const BAD = [178, 59, 46]
export const WARN = [166, 116, 40]

// ── Texto ────────────────────────────────────────────────────────────────────

const DASHES = /[‐-―−]/g
const SINGLE_QUOTES = /[‘’‚‛]/g
const DOUBLE_QUOTES = /[“”„‟]/g

/** Deja el texto en Latin-1: lo que la fuente no sabe imprimir, se traduce. */
export function latin1(s) {
  return String(s ?? '')
    .replace(DASHES, '-')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(/…/g, '...')
    .replace(/[•●▪]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x20-\xFF\n]/g, '')
    .trim()
}

/** $ 1.234.567 — sin el signo menos tipográfico, que Latin-1 no tiene. */
export function money(n) {
  const v = Math.round(Number(n) || 0)
  return (v < 0 ? '-$ ' : '$ ') + Math.abs(v).toLocaleString('es-CO')
}

/** $ 1,2M / $ 340k — para ejes y etiquetas donde no cabe la cifra entera. */
export function moneyShort(n) {
  const v = Math.round(Number(n) || 0)
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000) return sign + '$' + (abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace('.', ',') + 'M'
  if (abs >= 1_000) return sign + '$' + Math.round(abs / 1_000) + 'k'
  return sign + '$' + abs
}

/** Recorta a lo ancho que haya, con puntos suspensivos si no cabe. */
function clip(doc, text, maxW) {
  let s = latin1(text)
  if (doc.getTextWidth(s) <= maxW) return s
  while (s.length > 1 && doc.getTextWidth(s + '...') > maxW) s = s.slice(0, -1)
  return s + '...'
}

// ─────────────────────────────────────────────────────────────────────────────
// HOJA
//
// Lleva el cursor vertical y parte la página sola cuando lo que sigue no cabe.
// Sin esto, cada sección tendría que saber en qué página va — y basta con que
// un día haya un gasto más para que todo el informe quede corrido.
// ─────────────────────────────────────────────────────────────────────────────

export class Sheet {
  constructor({ footerLeft = '', title = '' } = {}) {
    this.doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
    this.doc.setFont('helvetica', 'normal')
    this.doc.setProperties({ title: latin1(title) })
    this.footerLeft = latin1(footerLeft)
    this.y = MARGIN
  }

  // ── Armazón ───────────────────────────────────────────────────────────────

  newPage() {
    this.doc.addPage()
    this.y = MARGIN
    return this
  }

  /** Salta de página si no quedan `h` milímetros útiles. */
  need(h) {
    if (this.y + h > PAGE_H - FOOTER_H) this.newPage()
    return this
  }

  gap(h = 6) {
    this.y += h
    return this
  }

  /**
   * Pie con la paginación. Se estampa AL FINAL, cuando ya se sabe cuántas
   * páginas hay: "página 3 de 9" no se puede escribir mientras se escribe la 3.
   */
  stampFooters() {
    const { doc } = this
    const total = doc.getNumberOfPages()
    for (let i = 1; i <= total; i++) {
      doc.setPage(i)
      doc.setDrawColor(...LINE)
      doc.setLineWidth(0.2)
      doc.line(MARGIN, PAGE_H - 11, PAGE_W - MARGIN, PAGE_H - 11)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...FAINT)
      doc.text(this.footerLeft, MARGIN, PAGE_H - 7)
      doc.text(`Pagina ${i} de ${total}`, PAGE_W - MARGIN, PAGE_H - 7, { align: 'right' })
    }
    return this
  }

  // ── Texto ─────────────────────────────────────────────────────────────────

  /** Banda de portada: título grande sobre fondo oscuro. */
  cover({ eyebrow, title, lines = [] }) {
    const { doc } = this
    const h = 52 + lines.length * 5.4
    doc.setFillColor(...INK)
    doc.rect(0, 0, PAGE_W, h, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(212, 168, 132)
    doc.text(latin1(eyebrow).toUpperCase(), MARGIN, 20)

    doc.setFontSize(26)
    doc.setTextColor(255, 255, 255)
    doc.text(latin1(title), MARGIN, 34)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    let ly = 45
    for (const l of lines) {
      doc.setTextColor(226, 220, 212)
      doc.text(latin1(l), MARGIN, ly)
      ly += 5.4
    }
    this.y = h + 10
    return this
  }

  /**
   * Título de sección, con una regla debajo.
   *
   * `keep` es el alto aproximado de lo que va justo detrás. Sin eso, un título
   * cae al final de una página y su gráfica arranca en la siguiente: el lector
   * pasa la hoja para saber de qué le estaban hablando.
   */
  h2(text, sub, { keep = 24 } = {}) {
    this.need((sub ? 22 : 17) + keep)
    const { doc } = this
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...INK)
    doc.text(latin1(text), MARGIN, this.y + 4)
    this.y += 6.5
    if (sub) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(...MUTED)
      doc.text(latin1(sub), MARGIN, this.y + 2.5)
      this.y += 4.5
    }
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, this.y + 1.5, PAGE_W - MARGIN, this.y + 1.5)
    this.y += 6
    return this
  }

  /** Párrafo con salto de línea automático. */
  p(text, { size = 9, color = BODY, bold = false, gap = 3.5 } = {}) {
    const { doc } = this
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...color)
    const lines = doc.splitTextToSize(latin1(text), CONTENT_W)
    const lh = size * 0.45
    this.need(lines.length * lh + gap)
    for (const l of lines) {
      this.y += lh
      doc.text(l, MARGIN, this.y)
    }
    this.y += gap
    return this
  }

  /** Recuadro de aviso o de explicación. */
  callout(text, { tone = 'neutral', titleText } = {}) {
    const { doc } = this
    const accent = tone === 'warn' ? WARN : tone === 'bad' ? BAD : CAT[1]
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    const lines = doc.splitTextToSize(latin1(text), CONTENT_W - 12)
    const h = 7 + (titleText ? 5 : 0) + lines.length * 4
    this.need(h + 4)

    doc.setFillColor(...SURFACE)
    doc.roundedRect(MARGIN, this.y, CONTENT_W, h, 1.6, 1.6, 'F')
    doc.setFillColor(...accent)
    doc.rect(MARGIN, this.y, 1.4, h, 'F')

    let ty = this.y + 5
    if (titleText) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...INK)
      doc.text(latin1(titleText), MARGIN + 6, ty)
      ty += 5
    }
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...BODY)
    for (const l of lines) {
      doc.text(l, MARGIN + 6, ty)
      ty += 4
    }
    this.y += h + 5
    return this
  }

  /** "Sin registros" — para que un apartado vacío se lea como dato, no como error. */
  empty(text) {
    const { doc } = this
    this.need(16)
    doc.setFillColor(...SURFACE)
    doc.roundedRect(MARGIN, this.y, CONTENT_W, 13, 1.6, 1.6, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...MUTED)
    doc.text(latin1(text), PAGE_W / 2, this.y + 8, { align: 'center' })
    this.y += 18
    return this
  }

  // ── Cifras ────────────────────────────────────────────────────────────────

  /** La cifra protagonista: una sola, grande, con su explicación. */
  hero({ label, value, help, positive = true }) {
    const { doc } = this
    this.need(34)
    doc.setFillColor(...INK)
    doc.roundedRect(MARGIN, this.y, CONTENT_W, 30, 2.2, 2.2, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(212, 168, 132)
    doc.text(latin1(label).toUpperCase(), MARGIN + 8, this.y + 10)

    doc.setFontSize(24)
    if (positive) doc.setTextColor(255, 255, 255)
    else doc.setTextColor(240, 168, 152)
    doc.text(latin1(value), MARGIN + 8, this.y + 21)

    if (help) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(200, 193, 184)
      const w = CONTENT_W - 16
      const lines = doc.splitTextToSize(latin1(help), w * 0.5)
      let ty = this.y + 13
      for (const l of lines) {
        doc.text(l, PAGE_W - MARGIN - 8, ty, { align: 'right' })
        ty += 4
      }
    }
    this.y += 35
    return this
  }

  /** Rejilla de tarjetas con una cifra cada una. */
  kpis(items, { cols = 3 } = {}) {
    const { doc } = this
    const gapX = 4
    const w = (CONTENT_W - gapX * (cols - 1)) / cols
    const h = 20
    const rows = Math.ceil(items.length / cols)
    this.need(rows * (h + 4))

    items.forEach((it, i) => {
      const r = Math.floor(i / cols)
      const c = i % cols
      const x = MARGIN + c * (w + gapX)
      const yy = this.y + r * (h + 4)

      doc.setFillColor(...WHITE)
      doc.setDrawColor(...LINE)
      doc.setLineWidth(0.3)
      doc.roundedRect(x, yy, w, h, 1.8, 1.8, 'FD')
      if (it.accent) {
        doc.setFillColor(...it.accent)
        doc.rect(x, yy, 1.2, h, 'F')
      }

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...MUTED)
      doc.text(clip(doc, it.label, w - 8), x + 4.5, yy + 6.5)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(it.small ? 11 : 13)
      doc.setTextColor(...(it.color || INK))
      doc.text(clip(doc, it.value, w - 8), x + 4.5, yy + 13.5)

      if (it.note) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(6.8)
        doc.setTextColor(...FAINT)
        doc.text(clip(doc, it.note, w - 8), x + 4.5, yy + 17.5)
      }
    })
    this.y += rows * (h + 4) + 3
    return this
  }

  // ── Gráficas ──────────────────────────────────────────────────────────────

  /**
   * Barras verticales, una serie. `data`: [{ label, value, note? }].
   *
   * Se etiqueta el valor ENCIMA de cada barra siempre que quepa: en un informe
   * impreso no hay forma de pasar el mouse por encima, así que la cifra tiene
   * que estar a la vista o el lector queda midiendo alturas a ojo.
   */
  barsV({ data, color = VENTAS, height = 46, valueFmt = moneyShort, footnote }) {
    const { doc } = this
    if (!data.length) return this.empty('Sin datos para graficar')
    const axisH = 9
    const labelH = 6
    const total = height + axisH + labelH + 4
    this.need(total)

    const top = this.y + 4
    const base = top + height
    const max = Math.max(...data.map(d => d.value), 1)

    // Rejilla discreta: tres líneas de referencia, sin números que compitan
    // con las etiquetas de cada barra.
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.2)
    for (let i = 1; i <= 3; i++) {
      const gy = base - (height * i) / 3
      doc.line(MARGIN, gy, PAGE_W - MARGIN, gy)
    }

    const slot = CONTENT_W / data.length
    const barW = Math.min(slot * 0.62, 16)
    data.forEach((d, i) => {
      const cx = MARGIN + slot * i + slot / 2
      const x = cx - barW / 2
      const h = Math.max((d.value / max) * height, d.value > 0 ? 0.8 : 0)
      if (h > 0) {
        doc.setFillColor(...color)
        const r = Math.min(1.2, barW / 2, h / 2)
        doc.roundedRect(x, base - h, barW, h, r, r, 'F')
        // El pie de la barra tiene que apoyarse plano en el eje: redondeado
        // parece que flotara.
        if (h > r) doc.rect(x, base - r, barW, r, 'F')
      }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.6)
      doc.setTextColor(...BODY)
      const vTxt = valueFmt(d.value)
      if (doc.getTextWidth(vTxt) <= slot - 1) {
        doc.text(vTxt, cx, base - h - 1.8, { align: 'center' })
      }
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...MUTED)
      doc.text(clip(doc, d.label, slot - 1), cx, base + 4.5, { align: 'center' })
      if (d.note) {
        doc.setFontSize(6.2)
        doc.setTextColor(...FAINT)
        doc.text(clip(doc, d.note, slot - 1), cx, base + 8.2, { align: 'center' })
      }
    })

    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.4)
    doc.line(MARGIN, base, PAGE_W - MARGIN, base)

    this.y = base + axisH + (data.some(d => d.note) ? 3 : 0)
    if (footnote) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...MUTED)
      doc.text(latin1(footnote), MARGIN, this.y + 1)
      this.y += 4
    }
    this.y += 3
    return this
  }

  /**
   * Barras horizontales, ordenadas de mayor a menor. Es la forma correcta
   * cuando lo que se compara son NOMBRES (productos, categorías de gasto):
   * el nombre se lee de corrido a la izquierda y no hay que ladear la cabeza.
   */
  barsH({ data, color = VENTAS, labelW = 52, valueFmt = money, footnote }) {
    const { doc } = this
    if (!data.length) return this.empty('Sin datos para graficar')
    const rowH = 7.6
    this.need(data.length * rowH + 8)

    const max = Math.max(...data.map(d => d.value), 1)
    const valueW = 26
    const trackX = MARGIN + labelW
    const trackW = CONTENT_W - labelW - valueW

    data.forEach((d, i) => {
      const yy = this.y + i * rowH
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...BODY)
      doc.text(clip(doc, d.label, labelW - 3), MARGIN, yy + 4)

      doc.setFillColor(...SURFACE)
      doc.roundedRect(trackX, yy + 1, trackW, 4.6, 1, 1, 'F')
      const w = Math.max((d.value / max) * trackW, d.value > 0 ? 1 : 0)
      if (w > 0) {
        doc.setFillColor(...(d.color || color))
        doc.roundedRect(trackX, yy + 1, w, 4.6, 1, 1, 'F')
      }

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.6)
      doc.setTextColor(...INK)
      doc.text(valueFmt(d.value), PAGE_W - MARGIN, yy + 4.6, { align: 'right' })
    })
    this.y += data.length * rowH + 3
    if (footnote) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...MUTED)
      doc.text(latin1(footnote), MARGIN, this.y)
      this.y += 4
    }
    this.y += 2
    return this
  }

  /**
   * Anillo con leyenda al lado. `data`: [{ label, value }] en orden fijo.
   *
   * El arco se aproxima con un polígono de muchos lados: a este tamaño la
   * curva sale limpia y jsPDF no necesita saber dibujar arcos.
   */
  donut({ data, centerLabel, centerValue, footnote }) {
    const { doc } = this
    const shown = data.filter(d => d.value > 0)
    if (!shown.length) return this.empty('Sin datos para graficar')

    const size = 44
    const need = Math.max(size + 8, shown.length * 7 + 10)
    this.need(need)

    const cx = MARGIN + size / 2
    const cy = this.y + size / 2
    const rOut = size / 2
    const rIn = rOut * 0.58
    const total = shown.reduce((s, d) => s + d.value, 0)

    // Un hueco fino de papel entre porciones: separa dos colores contiguos sin
    // depender de que el lector distinga los tonos.
    const GAP = 0.022
    let a0 = -Math.PI / 2
    shown.forEach((d, i) => {
      const frac = d.value / total
      const sweep = frac * Math.PI * 2
      const pad = shown.length > 1 ? Math.min(GAP, sweep / 4) : 0
      const from = a0 + pad
      const to = a0 + sweep - pad
      if (to > from) {
        const steps = Math.max(4, Math.ceil((to - from) / 0.12))
        const pts = []
        for (let s = 0; s <= steps; s++) {
          const a = from + ((to - from) * s) / steps
          pts.push([cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut])
        }
        for (let s = steps; s >= 0; s--) {
          const a = from + ((to - from) * s) / steps
          pts.push([cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn])
        }
        const deltas = []
        for (let k = 1; k < pts.length; k++) {
          deltas.push([pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]])
        }
        doc.setFillColor(...(d.color || CAT[i % CAT.length]))
        doc.lines(deltas, pts[0][0], pts[0][1], [1, 1], 'F', true)
      }
      a0 += sweep
    })

    if (centerValue) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      doc.setTextColor(...INK)
      doc.text(latin1(centerValue), cx, cy + (centerLabel ? 0 : 1.5), { align: 'center' })
    }
    if (centerLabel) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(...MUTED)
      doc.text(latin1(centerLabel), cx, cy + 4.5, { align: 'center' })
    }

    // Leyenda: color, nombre, monto y porcentaje. Nunca solo el color.
    const lx = MARGIN + size + 10
    let ly = this.y + 4
    data.forEach((d, i) => {
      const pct = total > 0 ? (d.value / total) * 100 : 0
      doc.setFillColor(...(d.color || CAT[i % CAT.length]))
      doc.roundedRect(lx, ly - 2.6, 3.2, 3.2, 0.6, 0.6, 'F')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.4)
      doc.setTextColor(...BODY)
      doc.text(clip(doc, d.label, 40), lx + 6, ly)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...INK)
      doc.text(money(d.value), PAGE_W - MARGIN - 16, ly, { align: 'right' })
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...MUTED)
      doc.text(pct.toFixed(0) + '%', PAGE_W - MARGIN, ly, { align: 'right' })
      ly += 7
    })

    this.y += need
    if (footnote) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...MUTED)
      doc.text(latin1(footnote), MARGIN, this.y)
      this.y += 4
    }
    this.y += 3
    return this
  }

  // ── Tabla ─────────────────────────────────────────────────────────────────

  /**
   * `columns`: [{ key, title, width (fracción), align, bold, color(row) }]
   * `rows`:    [{ ...celdas }]
   *
   * El encabezado se repite al cambiar de página: una tabla larga sin
   * encabezado repetido obliga a devolverse a la página anterior a ver qué
   * significaba cada columna.
   */
  table({ columns, rows, zebra = true, totalRow, maxRows, moreLabel }) {
    const { doc } = this
    if (!rows.length) return this.empty('Sin registros en este periodo')

    const shown = maxRows ? rows.slice(0, maxRows) : rows
    const sumW = columns.reduce((s, c) => s + c.width, 0)
    const widths = columns.map(c => (c.width / sumW) * CONTENT_W)
    const xs = []
    let acc = MARGIN
    for (const w of widths) { xs.push(acc); acc += w }
    const rowH = 6.2

    const header = () => {
      doc.setFillColor(...INK)
      doc.rect(MARGIN, this.y, CONTENT_W, 6.6, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.3)
      doc.setTextColor(255, 255, 255)
      columns.forEach((c, i) => {
        const tx = c.align === 'right' ? xs[i] + widths[i] - 2 : xs[i] + 2
        doc.text(clip(doc, c.title, widths[i] - 4), tx, this.y + 4.5, { align: c.align || 'left' })
      })
      this.y += 6.6
    }

    this.need(6.6 + rowH * 3)
    header()

    shown.forEach((r, ri) => {
      if (this.y + rowH > PAGE_H - FOOTER_H) {
        this.newPage()
        header()
      }
      if (zebra && ri % 2 === 1) {
        doc.setFillColor(...SURFACE)
        doc.rect(MARGIN, this.y, CONTENT_W, rowH, 'F')
      }
      columns.forEach((c, i) => {
        const raw = r[c.key]
        if (raw === undefined || raw === null || raw === '') return
        doc.setFont('helvetica', c.bold ? 'bold' : 'normal')
        doc.setFontSize(7.6)
        doc.setTextColor(...(c.color ? c.color(r) : BODY))
        const tx = c.align === 'right' ? xs[i] + widths[i] - 2 : xs[i] + 2
        doc.text(clip(doc, raw, widths[i] - 4), tx, this.y + 4.3, { align: c.align || 'left' })
      })
      this.y += rowH
    })

    if (totalRow) {
      if (this.y + rowH > PAGE_H - FOOTER_H) { this.newPage(); header() }
      doc.setDrawColor(...INK)
      doc.setLineWidth(0.4)
      doc.line(MARGIN, this.y, PAGE_W - MARGIN, this.y)
      columns.forEach((c, i) => {
        const raw = totalRow[c.key]
        if (raw === undefined || raw === null || raw === '') return
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.8)
        doc.setTextColor(...INK)
        const tx = c.align === 'right' ? xs[i] + widths[i] - 2 : xs[i] + 2
        doc.text(clip(doc, raw, widths[i] - 4), tx, this.y + 4.6, { align: c.align || 'left' })
      })
      this.y += rowH + 1
    }

    if (maxRows && rows.length > maxRows) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(7.4)
      doc.setTextColor(...FAINT)
      doc.text(latin1(moreLabel || `y ${rows.length - maxRows} mas`), MARGIN, this.y + 4)
      this.y += 5
    }
    this.y += 5
    return this
  }

  /** Descarga el archivo. */
  save(filename) {
    this.stampFooters()
    this.doc.save(latin1(filename))
    return this
  }
}
