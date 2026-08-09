import type { MascotMood } from './mascotMood'

/**
 * El personaje de Story Mode: un blob que cambia de forma, color y humor
 * según la métrica que se está mirando (ver mascotMood.ts). Vive siempre en
 * la esquina, siempre chico — 100% decorativo, `aria-hidden` porque no suma
 * ningún dato ni acción propia. Si se saca, no se pierde nada funcional.
 */
export function MascotBlob({ mood }: { mood: MascotMood }) {
  return (
    <div className={`m-mascot mood-${mood}`} aria-hidden="true">
      <span className="m-mascot-sparkles">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="m-mascot-blob" />
      <span className="m-mascot-face">
        <span className="m-mascot-eyes">
          <i />
          <i />
        </span>
        <span className="m-mascot-mouth" />
      </span>
    </div>
  )
}
