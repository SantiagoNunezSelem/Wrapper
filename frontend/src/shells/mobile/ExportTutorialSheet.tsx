import { useState } from 'react'
import type { ExportTutorialCopy } from '../../components/ExportTutorialModal'
import { ExportTutorialArt, type ExportTutorialPlatform } from '../../components/ExportTutorialArt'
import { useModalDismiss } from '../../components/useModalDismiss'
import { usePwaInstall } from '../../lib/usePwaInstall'

/**
 * El tutorial de exportación, como hoja — se abre al tocar "Subir chat" sin
 * tener todavía un análisis cargado. Mismo contenido que `ExportTutorialModal`
 * (desktop), con navegación de a un paso por vez en vez de una lista fija:
 * en una pantalla de teléfono, steps + imagen no entran juntos.
 */
export function ExportTutorialSheet({
  copy,
  onClose,
  onPick,
}: {
  copy: ExportTutorialCopy
  onClose: () => void
  onPick: () => void
}) {
  const [platform, setPlatform] = useState<ExportTutorialPlatform>('ios')
  const [step, setStep] = useState(0)
  const { canInstall, isInstalled, install } = usePwaInstall()

  // Escape, scroll de fondo y foco: los mismos que el resto de los diálogos.
  const panelRef = useModalDismiss<HTMLElement>(onClose)

  const steps = copy.steps[platform]
  const active = steps[step]
  const isLast = step === steps.length - 1
  // Mientras el navegador tenga el prompt nativo listo, ese es el CTA principal;
  // apenas se usa (aceptado o no — `install()` limpia `canInstall` en los dos
  // casos), el botón vuelve solo a "Elegir archivo", sin salir de esta pantalla.
  const showInstallCta = active.install === true && canInstall

  function selectPlatform(next: ExportTutorialPlatform) {
    setPlatform(next)
    setStep(0)
  }

  function handlePrimary() {
    if (showInstallCta) {
      void install()
      return
    }
    if (isLast) {
      onPick()
    } else {
      setStep((current) => current + 1)
    }
  }

  return (
    <div className="m-layer" role="dialog" aria-modal="true" aria-label={copy.title}>
      <button type="button" className="m-scrim" onClick={onClose} aria-label={copy.close} />

      <section className="m-sheet" ref={panelRef}>
        <span className="m-grabber" aria-hidden="true" />

        <header className="m-sheet-head">
          <div className="m-sheet-title">
            <p className="eyebrow">{copy.eyebrow}</p>
            <h2>{copy.title}</h2>
          </div>
          <button type="button" className="m-sheet-close" onClick={onClose} aria-label={copy.close}>
            ✕
          </button>
        </header>

        <div className="m-sheet-body">
          <div className="m-tutorial-os-toggle" role="tablist" aria-label="OS">
            <button type="button" className={platform === 'ios' ? 'is-active' : ''} onClick={() => selectPlatform('ios')}>
              {copy.os.ios}
            </button>
            <button type="button" className={platform === 'android' ? 'is-active' : ''} onClick={() => selectPlatform('android')}>
              {copy.os.android}
            </button>
          </div>

          <div className="m-tutorial-art">
            {active.install ? (
              <div className="m-tutorial-install-panel">
                <img src="/icon-192.png" alt="" className="tutorial-install-icon" width={64} height={64} />
                {isInstalled ? <p className="install-app-note">{copy.installDone}</p> : null}
                {!isInstalled && !canInstall ? <p className="install-app-note">{copy.installUnavailable}</p> : null}
              </div>
            ) : (
              <ExportTutorialArt step={step} platform={platform} chrome={false} />
            )}
          </div>

          <div className="m-tutorial-step-copy">
            <span className="m-step-n">{step + 1}</span>
            <span className="m-step-body">
              <strong>{active.title}</strong>
              <span>{active.body}</span>
            </span>
          </div>

          <div className="m-tutorial-dots">
            {steps.map((item, index) => (
              <span key={item.title} className={`m-tutorial-dot ${index === step ? 'is-active' : ''}`} />
            ))}
          </div>
        </div>

        <div className="m-tutorial-foot">
          <div className="m-tutorial-foot-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              disabled={step === 0}
            >
              ‹
            </button>
            <button type="button" className="primary-button" onClick={handlePrimary}>
              {showInstallCta ? copy.installCta : isLast ? copy.pick : copy.next}
            </button>
          </div>
          <p className="m-privacy-note">{copy.privacy}</p>
        </div>
      </section>
    </div>
  )
}
