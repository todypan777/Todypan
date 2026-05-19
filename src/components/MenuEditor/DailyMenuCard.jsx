import { useMemo, useState } from 'react'
import { T } from '../../tokens'
import { fmtCOP } from '../../utils/format'
import {
  CORRIENTE_CATEGORIES, resolveDailyMenu, getCorrienteState,
  copyMenuFromDate, previousDateStr,
} from '../../menu'

// ──────────────────────────────────────────────────────────────
// Tarjeta del menú del día que va ARRIBA de la cola en el tab Hoy.
// Tiene dos estados:
//   1) Empty (sin menú publicado): CTA grande "Agregar menú del día"
//      + atajo "Copiar lo de ayer"
//   2) Published: resumen vertical por categoría + botón "Editar"
//
// Props:
//   dailyMenu, allMenuItems, corrienteConfig → datos en vivo
//   today (YYYY-MM-DD), authUser, publisherName
//   onCreate, onEdit → callbacks que abren wizard / edit overlay
// ──────────────────────────────────────────────────────────────
export default function DailyMenuCard({
  dailyMenu, allMenuItems, corrienteConfig,
  today, authUser, publisherName,
  onCreate, onEdit,
}) {
  const resolved = useMemo(
    () => resolveDailyMenu(dailyMenu, allMenuItems),
    [dailyMenu, allMenuItems]
  )
  const corriente = useMemo(
    () => getCorrienteState(dailyMenu, allMenuItems, corrienteConfig),
    [dailyMenu, allMenuItems, corrienteConfig]
  )
  const hasAny = CORRIENTE_CATEGORIES.some(c => (resolved[c.id] || []).length > 0)
  const specialActive = !!dailyMenu?.special?.active
  const isEmpty = !hasAny && !specialActive

  if (isEmpty) {
    return (
      <EmptyMenuCard
        today={today}
        authUser={authUser}
        publisherName={publisherName}
        onCreate={onCreate}
      />
    )
  }

  return (
    <PublishedMenuCard
      today={today}
      resolved={resolved}
      special={dailyMenu?.special}
      especialItems={resolved.especial || []}
      corriente={corriente}
      onEdit={onEdit}
    />
  )
}

// ──────────────────────────────────────────────────────────────
// Estado vacío: cocinera entra y aún no ha puesto nada.
// Diseñado para ser IMPOSIBLE de no ver — cocineras cegatonas.
// ──────────────────────────────────────────────────────────────
function EmptyMenuCard({ today, authUser, publisherName, onCreate }) {
  const [copying, setCopying] = useState(false)
  const [copyError, setCopyError] = useState(null)

  async function handleCopy() {
    if (copying) return
    setCopying(true); setCopyError(null)
    try {
      const yesterday = previousDateStr(today)
      const ok = await copyMenuFromDate(yesterday, today, {
        publishedBy: authUser?.uid,
        publishedByName: publisherName,
      })
      if (!ok) setCopyError('No hay menú de ayer para copiar.')
    } catch (err) {
      console.error('[menu] copy failed:', err)
      setCopyError('No pudimos copiar el menú. Intenta de nuevo.')
    } finally {
      setCopying(false)
    }
  }

  return (
    <div style={{
      margin: '14px 12px 18px',
      padding: '22px 20px 20px',
      borderRadius: 22,
      background: `linear-gradient(140deg, ${T.copper[50]} 0%, #FFFFFF 100%)`,
      border: `2px solid ${T.copper[200]}`,
      boxShadow: '0 6px 22px rgba(184,122,86,0.15)',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 52, lineHeight: 1, marginBottom: 8 }}>🍽️</div>
      <div style={{
        fontSize: 22, fontWeight: 900, color: T.copper[700],
        letterSpacing: -0.5, lineHeight: 1.2, marginBottom: 6,
      }}>
        Aún no hay menú de hoy
      </div>
      <div style={{
        fontSize: 14, color: T.neutral[600], lineHeight: 1.5,
        marginBottom: 18, maxWidth: 340, marginLeft: 'auto', marginRight: 'auto',
      }}>
        Agrégalo desde aquí para que las cajeras puedan empezar a vender el almuerzo del día.
      </div>

      <button
        onClick={onCreate}
        style={{
          width: '100%', padding: '18px 16px', borderRadius: 16,
          background: T.copper[500], color: '#fff',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 17, fontWeight: 800, letterSpacing: -0.2,
          boxShadow: `0 6px 18px ${T.copper[500]}55`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        }}
      >
        <span style={{ fontSize: 22, lineHeight: 1 }}>+</span>
        Agregar menú del día
      </button>

      <div style={{
        marginTop: 14, paddingTop: 14,
        borderTop: `1px dashed ${T.copper[200]}`,
      }}>
        <div style={{ fontSize: 12.5, color: T.neutral[600], marginBottom: 8 }}>
          ¿Mismo menú que ayer?
        </div>
        <button
          onClick={handleCopy}
          disabled={copying}
          style={{
            padding: '10px 18px', borderRadius: 999,
            background: '#fff', color: T.neutral[700],
            border: `1.5px solid ${T.neutral[200]}`,
            cursor: copying ? 'wait' : 'pointer', fontFamily: 'inherit',
            fontSize: 13, fontWeight: 700,
            opacity: copying ? 0.7 : 1,
          }}
        >
          {copying ? 'Copiando…' : '📋 Copiar lo de ayer'}
        </button>
        {copyError && (
          <div style={{
            marginTop: 10, padding: '8px 10px', borderRadius: 10,
            background: '#FBE9E5', border: `1px solid #F0C8BE`,
            color: T.bad, fontSize: 12, lineHeight: 1.4,
          }}>
            {copyError}
          </div>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Estado publicado: tarjeta compacta de UNA SOLA línea.
// No ocupa espacio valioso de la cola de pedidos.
//   - Tap en el cuerpo → despliega la lista de categorías inline
//   - Botón ✎ Editar → abre MenuEditView (pantalla completa)
// ──────────────────────────────────────────────────────────────
function PublishedMenuCard({ today, resolved, special, especialItems, corriente, onEdit }) {
  const [expanded, setExpanded] = useState(false)
  const [promptCopied, setPromptCopied] = useState(false)
  const [promptError, setPromptError] = useState(null)
  const visibleCategories = CORRIENTE_CATEGORIES.filter(
    c => (resolved[c.id] || []).length > 0
  )

  async function handleCopyPrompt() {
    const prompt = buildMenuImagePrompt({
      resolved, corriente, special, especialItems, today,
    })
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(prompt)
      } else {
        // Fallback: navegadores viejos / contextos sin permisos de clipboard.
        const ta = document.createElement('textarea')
        ta.value = prompt
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setPromptCopied(true)
      setPromptError(null)
      setTimeout(() => setPromptCopied(false), 2400)
    } catch (err) {
      console.error('[menu] copy prompt failed:', err)
      setPromptError('No pudimos copiar. Intenta de nuevo.')
    }
  }

  return (
    <div style={{
      margin: '12px 12px 14px',
      borderRadius: 14,
      background: '#fff',
      border: `1.5px solid ${T.copper[200]}`,
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      overflow: 'hidden',
    }}>
      {/* Barra compacta principal */}
      <div style={{
        display: 'flex', alignItems: 'stretch',
        background: T.copper[50],
      }}>
        {/* Cuerpo tappable → expandir */}
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            flex: 1, padding: '10px 14px',
            background: 'transparent', border: 'none',
            cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 10,
            textAlign: 'left', minWidth: 0,
          }}
          aria-expanded={expanded}
        >
          <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>🍽️</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13, fontWeight: 900, color: T.copper[700],
              letterSpacing: -0.2,
              display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
              lineHeight: 1.2,
            }}>
              <span>Menú activo</span>
              {special?.active && (
                <span style={{
                  fontSize: 9.5, fontWeight: 800, color: T.warn,
                  letterSpacing: 0.4, textTransform: 'uppercase',
                  padding: '2px 6px', borderRadius: 999,
                  background: '#fff', border: `1px solid #F4E0BC`,
                }}>
                  ⭐ Especial
                </span>
              )}
            </div>
            {corriente.priceMesa > 0 && (
              <div style={{
                fontSize: 11, color: T.neutral[600],
                fontVariantNumeric: 'tabular-nums', marginTop: 2,
              }}>
                Mesa {fmtCOP(corriente.priceMesa)} · Llevar {fmtCOP(corriente.priceLlevar)}
              </div>
            )}
          </div>
          <svg
            width="12" height="12" viewBox="0 0 14 14" fill="none"
            style={{
              transition: 'transform 0.2s',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              flexShrink: 0,
            }}
          >
            <path d="M3 5 L7 9 L11 5" stroke={T.copper[700]} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Botón editar — siempre visible */}
        <button
          onClick={onEdit}
          style={{
            padding: '0 14px',
            background: T.copper[500], color: '#fff',
            border: 'none',
            borderLeft: `1px solid ${T.copper[100]}`,
            cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 12.5, fontWeight: 800, letterSpacing: -0.1,
            display: 'flex', alignItems: 'center', gap: 5,
            flexShrink: 0,
          }}
          aria-label="Editar menú del día"
        >
          ✎ Editar
        </button>
      </div>

      {/* Lista desplegada (solo si expanded) */}
      {expanded && (
        <div style={{
          padding: '4px 16px 12px',
          borderTop: `1px solid ${T.copper[100]}`,
        }}>
          {visibleCategories.map((cat, idx) => (
            <CategoryRow
              key={cat.id}
              category={cat}
              items={resolved[cat.id]}
              isLast={idx === visibleCategories.length - 1 && !special?.active}
            />
          ))}
          {special?.active && (
            <SpecialRow special={special} especialItems={especialItems} isLast />
          )}

          {/* Atajo para generar imagen del menú con IA externa.
              Copia un prompt parametrizado con el menú de hoy ya inyectado;
              la cocinera/admin lo pega en ChatGPT / Midjourney / Gemini y
              obtiene la imagen para WhatsApp / redes. */}
          <div style={{
            marginTop: 10, paddingTop: 12,
            borderTop: `1px dashed ${T.copper[100]}`,
          }}>
            <button
              onClick={handleCopyPrompt}
              style={{
                width: '100%', padding: '11px 14px', borderRadius: 12,
                background: promptCopied ? T.copper[100] : '#fff',
                color: promptCopied ? T.copper[700] : T.neutral[700],
                border: `1.5px solid ${promptCopied ? T.copper[400] : T.neutral[200]}`,
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 800, letterSpacing: -0.1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'background 0.15s, border-color 0.15s, color 0.15s',
              }}
              aria-label="Copiar prompt para generar imagen del menú con IA"
            >
              {promptCopied
                ? <>✓ Copiado al portapapeles</>
                : <>🎨 Copiar prompt para imagen IA</>}
            </button>
            <div style={{
              fontSize: 11, color: T.neutral[500], marginTop: 6,
              textAlign: 'center', lineHeight: 1.4,
            }}>
              Pegalo en ChatGPT, Midjourney o Gemini para generar la imagen del día.
            </div>
            {promptError && (
              <div style={{
                marginTop: 8, padding: '6px 10px', borderRadius: 8,
                background: '#FBE9E5', border: `1px solid #F0C8BE`,
                color: T.bad, fontSize: 11.5, lineHeight: 1.4,
                textAlign: 'center',
              }}>
                {promptError}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CategoryRow({ category, items, isLast }) {
  return (
    <div style={{
      padding: '10px 0',
      borderBottom: isLast ? 'none' : `1px solid ${T.neutral[100]}`,
      display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <div style={{
        width: 32, fontSize: 20, lineHeight: 1.2,
        flexShrink: 0, textAlign: 'center',
      }}>
        {category.emoji}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 11.5, fontWeight: 800, color: T.neutral[500],
          letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 3,
        }}>
          {category.label}
        </div>
        <div style={{
          fontSize: 14, color: T.neutral[900], lineHeight: 1.45,
          fontWeight: 600,
        }}>
          {items.map(it => it.name).join(' · ')}
        </div>
      </div>
    </div>
  )
}

function SpecialRow({ special, especialItems, isLast }) {
  // Backward-compat: si no hay items pero hay description (datos viejos),
  // mostramos la description. Datos nuevos usan items.
  const itemsText = (especialItems || []).length > 0
    ? especialItems.map(it => it.name).join(' · ')
    : (special.description || 'Sin plato definido')
  return (
    <div style={{
      padding: '12px 0 4px',
      borderTop: `1px dashed ${T.neutral[200]}`,
      marginTop: 8,
      display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <div style={{
        width: 32, fontSize: 20, lineHeight: 1.2,
        flexShrink: 0, textAlign: 'center',
      }}>
        ⭐
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 11.5, fontWeight: 800, color: T.warn,
          letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 3,
        }}>
          Almuerzo Especial
        </div>
        <div style={{ fontSize: 14, color: T.neutral[900], lineHeight: 1.45, fontWeight: 600 }}>
          {itemsText}
        </div>
        <div style={{
          fontSize: 12, color: T.neutral[600], marginTop: 3,
          fontVariantNumeric: 'tabular-nums',
        }}>
          Mesa {fmtCOP(special.priceMesa || 0)} · Llevar {fmtCOP(special.priceLlevar || 0)}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Prompt builder para imagen IA del menú del día.
// Devuelve un string listo para pegar en ChatGPT / Midjourney /
// Gemini Imagen. La cocinera elige su IA y obtiene la imagen.
// Si en el futuro cambia el número de WhatsApp, actualizar también
// PublicMenu.jsx — son los dos únicos lugares que lo usan.
// ──────────────────────────────────────────────────────────────
const WHATSAPP_DISPLAY = '324 187 8756'

function formatLongDate(dateStr) {
  if (!dateStr) return ''
  const dt = new Date(dateStr + 'T00:00:00')
  const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  return `${days[dt.getDay()]} ${dt.getDate()} de ${months[dt.getMonth()]}`
}

function buildMenuImagePrompt({ resolved, corriente, special, especialItems, today }) {
  const dateLong = formatLongDate(today)
  const cats = CORRIENTE_CATEGORIES.filter(c => (resolved[c.id] || []).length > 0)

  const listLines = cats.map(c => {
    const names = resolved[c.id].map(it => it.name).join(' · ')
    return `${c.emoji} ${c.label.toUpperCase()} · ${names}`
  })

  const hasEspecial = special?.active && (especialItems || []).length > 0
  if (hasEspecial) {
    const names = especialItems.map(it => it.name).join(' · ')
    listLines.push(`⭐ ALMUERZO ESPECIAL · ${names}`)
  }

  // Narrativa para la foto: lista de comida natural para que la IA imagine
  // el flat-lay (sopa, plato principal con sus componentes, jugo).
  const foodNarrative = cats
    .map(c => resolved[c.id].map(it => it.name).join(', '))
    .filter(Boolean)
    .join('; ')

  const mesa = corriente.priceMesa ? fmtCOP(corriente.priceMesa).replace('$ ', '$') : '$—'
  const llevar = (corriente.priceLlevar || corriente.priceMesa)
    ? fmtCOP(corriente.priceLlevar || corriente.priceMesa).replace('$ ', '$')
    : mesa

  const especialPriceLine = hasEspecial && special?.priceMesa
    ? `\n    "⭐ Especial Mesa ${fmtCOP(special.priceMesa).replace('$ ', '$')} · Llevar ${fmtCOP(special.priceLlevar || special.priceMesa).replace('$ ', '$')}"`
    : ''

  return `Tarjeta promocional vertical 9:16 del "Menú del día" para TodyPan, restaurante colombiano de almuerzos caseros. Paleta cálida cobre, crema y marrón terracota (colores de la marca). Fondo de madera clara con sombras suaves de luz natural cenital.

Composición:
- Encabezado superior con el logo "TodyPan" en tipografía manuscrita elegante color cobre oscuro, y debajo en cursiva más pequeña: "${dateLong}".
- En el centro, una fotografía gastronómica cenital tipo flat-lay ESTILO EDITORIAL DE REVISTA GASTRONÓMICA mostrando: ${foodNarrative}. Iluminación cálida apetitosa, sombras suaves, alta resolución.
- Debajo, una lista limpia con íconos pequeños en línea:
${listLines.map(l => '    ' + l).join('\n')}
- Pie de página con dos badges redondeados color cobre:
    "🍽️ En mesa ${mesa}"   "🥡 Para llevar ${llevar}"${especialPriceLine}
- Texto pequeño abajo: "Pedí por WhatsApp 📱 ${WHATSAPP_DISPLAY}"

Estilo: fotografía apetitosa profesional con tipografía moderna sobrepuesta limpia, look acogedor y casero, sensación de hogar colombiano. Sin marcas de agua. Sin manos en cuadro. Texto perfectamente legible y bien tipografiado.`
}
