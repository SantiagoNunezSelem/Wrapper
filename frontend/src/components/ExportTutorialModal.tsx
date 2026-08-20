import { useState } from 'react'
import { usePwaInstall } from '../lib/usePwaInstall'
import { ExportTutorialArt, type ExportTutorialPlatform } from './ExportTutorialArt'
import { CrossButton } from './IconButton'

export interface ExportTutorialCopy {
  eyebrow: string
  title: string
  os: { ios: string; android: string }
  steps: {
    ios: ReadonlyArray<{ title: string; body: string; install?: boolean }>
    android: ReadonlyArray<{ title: string; body: string; install?: boolean }>
  }
  skip: string
  pick: string
  next: string
  privacy: string
  close: string
  installCta: string
  installDone: string
  installUnavailable: string
}

/**
 * El tutorial de exportación, antes de abrir el selector de archivos.
 *
 * Mismo patrón que la sección "How do I export my chat?" de whats-wrapped.com
 * (selector iOS/Android, pasos a la izquierda, teléfono a la derecha), pero
 * con ilustraciones propias — ver `ExportTutorialArt`.
 */
export function ExportTutorialModal({
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

  const steps = copy.steps[platform]
  const activeStep = steps[step]
  // Mientras el navegador tenga el prompt nativo listo, ese es el CTA principal;
  // apenas se usa (aceptado o no — `install()` limpia `canInstall` en los dos
  // casos), el botón vuelve solo a "Elegir archivo", sin salir de esta pantalla.
  const showInstallCta = activeStep.install === true && canInstall

  function selectPlatform(next: ExportTutorialPlatform) {
    setPlatform(next)
    setStep(0)
  }

  function handlePrimaryAction() {
    if (showInstallCta) {
      void install()
      return
    }
    onPick()
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal-card export-tutorial-modal" onClick={(event) => event.stopPropagation()}>
        <CrossButton label={copy.close} onClick={onClose} className="close-button" />

        <p className="eyebrow">{copy.eyebrow}</p>
        <h2>{copy.title}</h2>

        <div className="tutorial-os-toggle" role="tablist" aria-label="OS">
          <button type="button" className={platform === 'ios' ? 'is-active' : ''} onClick={() => selectPlatform('ios')}>
            {copy.os.ios}
          </button>
          <button type="button" className={platform === 'android' ? 'is-active' : ''} onClick={() => selectPlatform('android')}>
            {copy.os.android}
          </button>
        </div>

        <div className="tutorial-body">
          <div className="tutorial-steps">
            {steps.map((item, index) => (
              <button
                type="button"
                key={item.title}
                className={`tutorial-step ${index === step ? 'is-active' : ''}`}
                onClick={() => setStep(index)}
              >
                <span className="tutorial-step-num">{index + 1}</span>
                <span className="tutorial-step-copy">
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="tutorial-art">
            {activeStep.install ? (
              <div className="tutorial-install-panel">
                <img src="/icon-192.png" alt="" className="tutorial-install-icon" width={64} height={64} />
                {isInstalled ? <p className="install-app-note">{copy.installDone}</p> : null}
                {!isInstalled && !canInstall ? <p className="install-app-note">{copy.installUnavailable}</p> : null}
              </div>
            ) : (
              <ExportTutorialArt step={step} platform={platform} chrome />
            )}
          </div>
        </div>

        <div className="tutorial-foot">
          <p>{copy.privacy}</p>
          <div className="tutorial-foot-actions">
            <button type="button" className="ghost-button" onClick={onPick}>
              {copy.skip}
            </button>
            <button type="button" className="primary-button" onClick={handlePrimaryAction}>
              {showInstallCta ? copy.installCta : copy.pick}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
