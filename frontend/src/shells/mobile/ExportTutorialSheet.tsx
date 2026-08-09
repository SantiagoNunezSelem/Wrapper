import { useEffect, useState } from 'react'
import type { ExportTutorialCopy } from '../../components/ExportTutorialModal'
import { ExportTutorialArt, type ExportTutorialPlatform } from '../../components/ExportTutorialArt'

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

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const steps = copy.steps[platform]
  const active = steps[step]
  const isLast = step === steps.length - 1

  function selectPlatform(next: ExportTutorialPlatform) {
    setPlatform(next)
    setStep(0)
  }

  function handlePrimary() {
    if (isLast) {
      onPick()
    } else {
      setStep((current) => current + 1)
    }
  }

  return (
    <div className="m-layer" role="dialog" aria-modal="true" aria-label={copy.title}>
      <button type="button" className="m-scrim" onClick={onClose} aria-label={copy.close} />

      <section className="m-sheet">
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
            <ExportTutorialArt step={step} platform={platform} chrome={false} />
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
              {isLast ? copy.pick : copy.next}
            </button>
          </div>
          <p className="m-privacy-note">{copy.privacy}</p>
        </div>
      </section>
    </div>
  )
}
