import type { JSX } from 'react'
import { prefersReducedMotion } from '../lib/prefersReducedMotion'

/**
 * Ilustraciones del tutorial "¿Cómo exporto mi chat?" — SVG original propio
 * (paleta y layout de Vistazo), no una captura de WhatsApp ni de ningún otro
 * sitio. Recrea la disposición real de la UI de exportación (mismos pasos,
 * mismos menús) sólo con fines instructivos.
 *
 * 4 pasos × 2 plataformas = 8 escenas, todas construidas sobre el mismo
 * lienzo de 300×560 (el "teléfono"), para que estático (desktop, con marco)
 * y recortado (mobile, sin marco) compartan las mismas coordenadas.
 */

export type ExportTutorialPlatform = 'ios' | 'android'

const FONT = 'Inter, system-ui, sans-serif'
const GLOW = 'url(#vzglow)'
const ACCENT = 'url(#vzg)'

const CHAT_BG = '#0b1120'
const HEADER_BG = '#0f172a'
const LIST_BG = '#0b1120'
const HEADER_TEXT = '#f8fafc'
const HEADER_SUB = '#94a3b8'
const BUBBLE_IN = '#1f2937'
const BUBBLE_IN_TEXT = '#e2e8f0'
const BUBBLE_OUT_TEXT = '#0f172a'
const TICK_COLOR = '#94a3b8'
const ACCENT_TEXT = '#c084fc'
const AVATAR_BG = '#312244'
const AVATAR_TEXT = '#e9d5ff'
const DIALOG_BG = '#111827'
const DIALOG_BORDER = '#1f2937'
const ROW_BG = '#0f172a'
const ROW_BORDER = '#1f2937'
const ROW_BG_ACTIVE = 'rgba(192,132,252,0.14)'
const TEXT_STRONG = '#f8fafc'
const TEXT_MUTED = '#94a3b8'
const TEXT_FAINT = '#64748b'
const STATUS_ICON = '#e2e8f0'
const NOTCH_BG = '#05070f'
const CHIP_BG = '#1f2937'
const SCRIM = 'rgba(2,6,23,0.6)'
const DANGER = '#f87171'

function Defs() {
  return (
    <defs>
      <linearGradient id="vzg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#c084fc" />
        <stop offset="1" stopColor="#22d3ee" />
      </linearGradient>
      <filter id="vzglow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="6" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  )
}

function Ring({ cx, cy }: { cx: number; cy: number }) {
  return (
    <circle cx={cx} cy={cy} r={14} fill="none" stroke={ACCENT} strokeWidth={2} opacity={0.7}>
      {prefersReducedMotion() ? null : (
        <>
          <animate attributeName="r" values="12;22;12" dur="1.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.7;0;0.7" dur="1.8s" repeatCount="indefinite" />
        </>
      )}
    </circle>
  )
}

function TagLabel({ x, y, text }: { x: number; y: number; text: string }) {
  const w = text.length * 5.8 + 22
  return (
    <>
      <rect x={x - w / 2} y={y - 11} width={w} height={22} rx={11} fill={DIALOG_BG} stroke={ACCENT} strokeWidth={1.4} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={ACCENT_TEXT} fontFamily={FONT}>
        {text}
      </text>
    </>
  )
}

function Avatar({ cx, cy, r, fontSize }: { cx: number; cy: number; r: number; fontSize: number }) {
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill={AVATAR_BG} />
      <text x={cx} y={cy + fontSize * 0.35} textAnchor="middle" fontSize={fontSize} fontWeight={700} fill={AVATAR_TEXT} fontFamily={FONT}>
        GA
      </text>
    </>
  )
}

function StatusBar({ platform }: { platform: ExportTutorialPlatform }) {
  return (
    <>
      <rect x={0} y={0} width={300} height={22} fill={HEADER_BG} />
      <text x={14} y={15} fontSize={11} fontWeight={700} fill={STATUS_ICON} fontFamily={FONT}>
        9:41
      </text>
      <g fill={STATUS_ICON}>
        <rect x={228} y={13} width={3} height={4} rx={1} />
        <rect x={233} y={10} width={3} height={7} rx={1} />
        <rect x={238} y={7} width={3} height={10} rx={1} />
        <rect x={243} y={4} width={3} height={13} rx={1} />
      </g>
      <path d="M254 15 a9 9 0 0 1 13 0" fill="none" stroke={STATUS_ICON} strokeWidth={1.4} strokeLinecap="round" />
      <path d="M257.3 11.8 a5 5 0 0 1 6.4 0" fill="none" stroke={STATUS_ICON} strokeWidth={1.4} strokeLinecap="round" />
      <circle cx={260.5} cy={15} r={1.2} fill={STATUS_ICON} />
      <rect x={272} y={7} width={20} height={10} rx={2.5} fill="none" stroke={STATUS_ICON} strokeWidth={1.2} />
      <rect x={292} y={10} width={2} height={4} rx={1} fill={STATUS_ICON} />
      <rect x={274} y={9} width={15} height={6} rx={1} fill={STATUS_ICON} />
      {platform === 'ios' ? (
        <rect x={118} y={0} width={64} height={18} rx={9} fill={NOTCH_BG} />
      ) : (
        <circle cx={150} cy={10} r={4} fill={NOTCH_BG} />
      )}
    </>
  )
}

function HeaderChat({ platform, highlight }: { platform: ExportTutorialPlatform; highlight: boolean }) {
  const chatTitle = 'Asado del Domingo'

  return (
    <>
      <rect x={0} y={22} width={300} height={62} fill={HEADER_BG} />
      {platform === 'ios' ? (
        <>
          <text x={14} y={58} fontSize={24} fill={HEADER_TEXT} fontFamily={FONT}>
            ‹
          </text>
          <Avatar cx={54} cy={53} r={16} fontSize={12} />
          <text x={78} y={49} fontSize={12.5} fontWeight={700} fill={HEADER_TEXT} fontFamily={FONT}>
            {chatTitle}
          </text>
          <text x={78} y={63} fontSize={9.5} fill={HEADER_SUB} fontFamily={FONT}>
            Tocá para ver los datos
          </text>
          <text x={240} y={58} fontSize={15} fill={HEADER_TEXT}>
            🎥
          </text>
          <text x={270} y={58} fontSize={14} fill={HEADER_TEXT}>
            📞
          </text>
        </>
      ) : (
        <>
          <text x={12} y={58} fontSize={19} fill={HEADER_TEXT} fontFamily={FONT}>
            ←
          </text>
          <Avatar cx={48} cy={53} r={15} fontSize={11} />
          <text x={70} y={49} fontSize={12.5} fontWeight={700} fill={HEADER_TEXT} fontFamily={FONT}>
            {chatTitle}
          </text>
          <text x={70} y={63} fontSize={9.5} fill={HEADER_SUB} fontFamily={FONT}>
            en línea
          </text>
          <text x={196} y={58} fontSize={15} fill={HEADER_TEXT}>
            📹
          </text>
          <text x={222} y={58} fontSize={14} fill={HEADER_TEXT}>
            📞
          </text>
          <text x={256} y={58} fontSize={18} fontWeight={700} fill={HEADER_TEXT}>
            ⋮
          </text>
        </>
      )}

      {highlight ? (
        platform === 'ios' ? (
          <>
            <rect x={38} y={34} width={172} height={38} rx={12} fill="none" stroke={ACCENT} strokeWidth={2.2} filter={GLOW} />
            <Ring cx={124} cy={53} />
          </>
        ) : (
          <>
            <rect x={244} y={38} width={30} height={30} rx={8} fill="none" stroke={ACCENT} strokeWidth={2.2} filter={GLOW} />
            <Ring cx={258} cy={50} />
          </>
        )
      ) : null}
    </>
  )
}

function ChatContent() {
  return (
    <>
      <rect x={0} y={84} width={300} height={476} fill={CHAT_BG} />
      <g>
        <rect x={16} y={104} width={176} height={34} rx={10} fill={BUBBLE_IN} />
        <text x={30} y={125} fontSize={11.5} fill={BUBBLE_IN_TEXT} fontFamily={FONT}>
          Che, ¿quién lleva el hielo? 🧊
        </text>

        <rect x={94} y={150} width={190} height={34} rx={10} fill={ACCENT} />
        <text x={108} y={171} fontSize={11.5} fill={BUBBLE_OUT_TEXT} fontFamily={FONT}>
          Yo llevo todo, tranqui 🙌
        </text>
        <text x={240} y={178} fontSize={8} fill={TICK_COLOR} fontFamily={FONT}>
          22:03 ✓✓
        </text>

        <rect x={16} y={196} width={120} height={34} rx={10} fill={BUBBLE_IN} />
        <text x={30} y={217} fontSize={11.5} fill={BUBBLE_IN_TEXT} fontFamily={FONT}>
          Sos un capo 🔥
        </text>
      </g>
      <rect x={14} y={522} width={238} height={30} rx={15} fill={ROW_BG} stroke={ROW_BORDER} />
      <text x={28} y={541} fontSize={10.5} fill={TEXT_FAINT} fontFamily={FONT}>
        Mensaje
      </text>
      <text x={260} y={542} fontSize={15} fill={ACCENT_TEXT}>
        🎤
      </text>
    </>
  )
}

function SceneInfoIOS() {
  const rows: Array<{ label: string; active?: boolean; danger?: boolean }> = [
    { label: 'Notificaciones' },
    { label: 'Multimedia, enlaces y docs' },
    { label: 'Fondo de pantalla' },
    { label: 'Exportar chat', active: true },
    { label: 'Vaciar chat', danger: true },
  ]

  let y = 236
  const rowEls: JSX.Element[] = rows.map((row) => {
    const rowY = y
    y += 42
    return (
      <g key={row.label}>
        {row.active ? (
          <rect x={14} y={rowY} width={272} height={42} rx={10} fill={ROW_BG_ACTIVE} stroke={ACCENT} strokeWidth={2} filter={GLOW} />
        ) : null}
        <text x={28} y={rowY + 26} fontSize={12} fontWeight={row.active ? 700 : 500} fill={row.danger ? DANGER : TEXT_STRONG} fontFamily={FONT}>
          {row.label}
        </text>
        <text x={272} y={rowY + 26} fontSize={13} fill={TEXT_FAINT}>
          ›
        </text>
        <line x1={14} y1={rowY + 42} x2={286} y2={rowY + 42} stroke={ROW_BORDER} strokeWidth={1} />
        {row.active ? <Ring cx={268} cy={rowY + 21} /> : null}
      </g>
    )
  })

  return (
    <>
      <rect x={0} y={22} width={300} height={62} fill={HEADER_BG} />
      <text x={14} y={58} fontSize={22} fill={HEADER_TEXT} fontFamily={FONT}>
        ‹
      </text>
      <text x={150} y={58} textAnchor="middle" fontSize={13} fontWeight={700} fill={HEADER_TEXT} fontFamily={FONT}>
        Datos del grupo
      </text>

      <rect x={0} y={84} width={300} height={476} fill={LIST_BG} />
      <Avatar cx={150} cy={128} r={36} fontSize={20} />
      <text x={150} y={178} textAnchor="middle" fontSize={14} fontWeight={700} fill={TEXT_STRONG} fontFamily={FONT}>
        Asado del Domingo
      </text>
      <text x={150} y={194} textAnchor="middle" fontSize={10} fill={TEXT_MUTED} fontFamily={FONT}>
        Grupo · 12 integrantes
      </text>
      <TagLabel x={150} y={216} text="Deslizá hasta el final" />

      {rowEls}
    </>
  )
}

function SceneMenuAndroid() {
  const items = ['Ver grupo', 'Multimedia, enlaces y docs', 'Buscar', 'Silenciar notificaciones', 'Más']
  let y = 44
  const itemEls = items.map((label, index) => {
    const rowY = y
    y += 34
    const isMore = index === items.length - 1
    return (
      <g key={label}>
        <text x={128} y={rowY} fontSize={11.5} fill={TEXT_STRONG} fontFamily={FONT}>
          {label}
        </text>
        {isMore ? (
          <text x={272} y={rowY} fontSize={11} fill={TEXT_FAINT}>
            ▸
          </text>
        ) : null}
        <line x1={118} y1={rowY + 10} x2={288} y2={rowY + 10} stroke={ROW_BORDER} strokeWidth={1} />
      </g>
    )
  })

  return (
    <>
      <HeaderChat platform="android" highlight={false} />
      <rect x={0} y={84} width={300} height={476} fill={CHAT_BG} />
      <rect x={0} y={22} width={300} height={538} fill={SCRIM} />

      <rect x={112} y={28} width={176} height={182} rx={8} fill={DIALOG_BG} />
      {itemEls}

      <path d="M228 210 L230 224" stroke={ACCENT} strokeWidth={2} strokeLinecap="round" />
      <rect x={70} y={222} width={176} height={58} rx={8} fill={DIALOG_BG} stroke={ACCENT} strokeWidth={2.2} filter={GLOW} />
      <text x={90} y={256} fontSize={12} fontWeight={700} fill={TEXT_STRONG} fontFamily={FONT}>
        Exportar chat
      </text>
      <Ring cx={230} cy={251} />
      <TagLabel x={158} y={300} text="Tocá acá" />
    </>
  )
}

function SceneDialog({ platform }: { platform: ExportTutorialPlatform }) {
  const bg = (
    <>
      <HeaderChat platform={platform} highlight={false} />
      <ChatContent />
      <rect x={0} y={22} width={300} height={538} fill={SCRIM} />
    </>
  )

  if (platform === 'ios') {
    return (
      <>
        {bg}
        <rect x={40} y={200} width={220} height={190} rx={14} fill={DIALOG_BG} />
        <text x={150} y={230} textAnchor="middle" fontSize={12} fontWeight={700} fill={TEXT_STRONG} fontFamily={FONT}>
          ¿Exportar chat
        </text>
        <text x={150} y={246} textAnchor="middle" fontSize={12} fontWeight={700} fill={TEXT_STRONG} fontFamily={FONT}>
          “Asado del Domingo”?
        </text>
        <text x={150} y={266} textAnchor="middle" fontSize={10} fill={TEXT_MUTED} fontFamily={FONT}>
          Elegí si incluir fotos y videos
        </text>
        <line x1={40} y1={288} x2={260} y2={288} stroke={DIALOG_BORDER} strokeWidth={1} />
        <text x={150} y={312} textAnchor="middle" fontSize={12} fill={ACCENT_TEXT} fontFamily={FONT}>
          Adjuntar multimedia
        </text>
        <line x1={40} y1={324} x2={260} y2={324} stroke={DIALOG_BORDER} strokeWidth={1} />
        <rect x={40} y={324} width={220} height={42} fill={ROW_BG_ACTIVE} />
        <text x={150} y={350} textAnchor="middle" fontSize={12} fontWeight={700} fill={ACCENT_TEXT} fontFamily={FONT}>
          Sin multimedia
        </text>
        <Ring cx={150} cy={345} />
      </>
    )
  }

  return (
    <>
      {bg}
      <rect x={30} y={220} width={240} height={168} rx={6} fill={DIALOG_BG} />
      <text x={50} y={252} fontSize={13} fontWeight={700} fill={TEXT_STRONG} fontFamily={FONT}>
        Exportar chat sin multimedia
      </text>
      <text x={50} y={272} fontSize={10.5} fill={TEXT_MUTED} fontFamily={FONT}>
        ¿Incluir las fotos y videos
      </text>
      <text x={50} y={286} fontSize={10.5} fill={TEXT_MUTED} fontFamily={FONT}>
        del chat en el archivo?
      </text>
      <text x={139} y={374} textAnchor="end" fontSize={10.5} fontWeight={700} fill={TEXT_FAINT} fontFamily={FONT}>
        ADJUNTAR
      </text>
      <rect x={153} y={356} width={103} height={24} rx={5} fill={ROW_BG_ACTIVE} stroke={ACCENT} strokeWidth={1.6} filter={GLOW} />
      <text x={248} y={374} textAnchor="end" fontSize={10.5} fontWeight={700} fill={ACCENT_TEXT} fontFamily={FONT}>
        SIN MULTIMEDIA
      </text>
      <Ring cx={205} cy={368} />
    </>
  )
}

function SceneShareIOS() {
  const chips: Array<{ icon: string; label: string; active?: boolean }> = [
    { icon: '👥', label: 'AirDrop' },
    { icon: '📁', label: 'Archivos', active: true },
    { icon: '✉️', label: 'Mail' },
    { icon: '⋯', label: 'Más' },
  ]

  return (
    <>
      <rect x={0} y={0} width={300} height={560} fill={CHAT_BG} />
      <rect x={0} y={22} width={300} height={538} fill={SCRIM} />
      <rect x={0} y={270} width={300} height={290} rx={18} fill={DIALOG_BG} />
      <rect x={132} y={282} width={36} height={4} rx={2} fill={DIALOG_BORDER} />
      <text x={150} y={308} textAnchor="middle" fontSize={11} fill={TEXT_MUTED} fontFamily={FONT}>
        Compartir “ChatExportado.txt”
      </text>

      {chips.map((chip, index) => {
        const cx = 52 + index * 66
        const cy = 340
        return (
          <g key={chip.label}>
            <rect
              x={cx - 26}
              y={cy - 26}
              width={52}
              height={52}
              rx={14}
              fill={chip.active ? ROW_BG_ACTIVE : CHIP_BG}
              stroke={chip.active ? ACCENT : 'transparent'}
              strokeWidth={2}
              filter={chip.active ? GLOW : undefined}
            />
            <text x={cx} y={cy + 7} textAnchor="middle" fontSize={20}>
              {chip.icon}
            </text>
            <text x={cx} y={cy + 40} textAnchor="middle" fontSize={9} fill={TEXT_MUTED} fontFamily={FONT}>
              {chip.label}
            </text>
            {chip.active ? <Ring cx={cx} cy={cy} /> : null}
          </g>
        )
      })}

      <TagLabel x={94} y={402} text="Tocá acá" />

      <line x1={150} y1={440} x2={150} y2={464} stroke={ACCENT} strokeWidth={2} />
      <path d="M142 456 L150 468 L158 456" fill="none" stroke={ACCENT} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <text x={150} y={494} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={TEXT_STRONG} fontFamily={FONT}>
        Subilo a Vistazo
      </text>
    </>
  )
}

function SceneShareAndroid() {
  const rows: Array<{ icon: string; label: string; active?: boolean }> = [
    { icon: '🗂️', label: 'Drive' },
    { icon: '✉️', label: 'Gmail' },
    { icon: '🔵', label: 'Bluetooth' },
    { icon: '📥', label: 'Guardar en el dispositivo', active: true },
  ]

  let y = 316
  const rowEls = rows.map((row) => {
    const rowY = y
    y += 52
    return (
      <g key={row.label}>
        <circle
          cx={38}
          cy={rowY}
          r={18}
          fill={row.active ? ROW_BG_ACTIVE : CHIP_BG}
          stroke={row.active ? ACCENT : 'transparent'}
          strokeWidth={2}
          filter={row.active ? GLOW : undefined}
        />
        <text x={38} y={rowY + 6} textAnchor="middle" fontSize={15}>
          {row.icon}
        </text>
        <text x={68} y={rowY + 5} fontSize={12} fontWeight={row.active ? 700 : 500} fill={TEXT_STRONG} fontFamily={FONT}>
          {row.label}
        </text>
        {row.active ? <Ring cx={38} cy={rowY} /> : null}
      </g>
    )
  })

  return (
    <>
      <rect x={0} y={0} width={300} height={560} fill={CHAT_BG} />
      <rect x={0} y={22} width={300} height={538} fill={SCRIM} />
      <rect x={0} y={260} width={300} height={300} rx={18} fill={DIALOG_BG} />
      <text x={20} y={292} fontSize={11} fontWeight={700} fill={TEXT_MUTED} fontFamily={FONT}>
        COMPARTIR CHATEXPORTADO.TXT
      </text>
      {rowEls}
      <text x={150} y={536} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={TEXT_STRONG} fontFamily={FONT}>
        → Subilo a Vistazo
      </text>
    </>
  )
}

function SceneInner({ step, platform }: { step: number; platform: ExportTutorialPlatform }) {
  if (step === 0) {
    return (
      <>
        <StatusBar platform={platform} />
        <HeaderChat platform={platform} highlight />
        <ChatContent />
        <TagLabel x={platform === 'ios' ? 150 : 262} y={80} text="Tocá acá" />
      </>
    )
  }
  if (step === 1) {
    return (
      <>
        <StatusBar platform={platform} />
        {platform === 'ios' ? <SceneInfoIOS /> : <SceneMenuAndroid />}
      </>
    )
  }
  if (step === 2) {
    return (
      <>
        <StatusBar platform={platform} />
        <SceneDialog platform={platform} />
      </>
    )
  }
  return (
    <>
      <StatusBar platform={platform} />
      {platform === 'ios' ? <SceneShareIOS /> : <SceneShareAndroid />}
    </>
  )
}

/** Ventana vertical del lienzo de 560px que se muestra en la hoja de mobile
 * (sin marco de teléfono): cada paso recorta la franja donde pasa la acción. */
function cropFor(step: number, platform: ExportTutorialPlatform): [number, number] {
  if (step === 0) return [0, 230]
  if (step === 1) return platform === 'ios' ? [140, 430] : [0, 340]
  if (step === 2) return [195, 410]
  return [270, 560]
}

/**
 * `chrome=true` dibuja el teléfono completo con marco (escritorio, junto a
 * la lista de pasos). `chrome=false` recorta sólo la franja relevante del
 * paso, sin marco, pensado para ir dentro de la hoja de mobile.
 */
export function ExportTutorialArt({
  step,
  platform,
  chrome,
}: {
  step: number
  platform: ExportTutorialPlatform
  chrome: boolean
}) {
  // Primer paso de Android: grabación real en vez de la ilustración SVG —
  // reemplazo gradual, paso a paso, de las demás escenas dibujadas abajo.
  if (step === 0 && platform === 'android') {
    return (
      <video
        src="/tutorial/export-android-step1.mp4"
        className="tutorial-gif"
        aria-label={`Paso ${step + 1}`}
        autoPlay
        loop
        muted
        playsInline
      />
    )
  }

  if (chrome) {
    const clipId = `export-tutorial-clip-${platform}-${step}`
    return (
      <svg viewBox="0 0 340 600" role="img" aria-label={`Paso ${step + 1}`}>
        <Defs />
        <rect x={0} y={0} width={340} height={600} rx={36} fill="#05070f" />
        <rect x={20} y={20} width={300} height={560} rx={22} fill={CHAT_BG} />
        <rect x={132} y={10} width={76} height={14} rx={7} fill="#05070f" />
        <clipPath id={clipId}>
          <rect x={0} y={0} width={300} height={560} rx={22} />
        </clipPath>
        <g transform="translate(20,20)" clipPath={`url(#${clipId})`}>
          <SceneInner step={step} platform={platform} />
        </g>
      </svg>
    )
  }

  const [y0, y1] = cropFor(step, platform)
  return (
    <svg viewBox={`0 ${y0} 300 ${y1 - y0}`} role="img" aria-label={`Paso ${step + 1}`}>
      <Defs />
      <SceneInner step={step} platform={platform} />
    </svg>
  )
}
