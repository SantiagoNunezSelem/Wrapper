import { useState } from 'react'
import { detectDefaultTutorialPlatform } from '../lib/detectPlatform'
import { usePwaInstall } from '../lib/usePwaInstall'
import { openWhatsAppApp } from '../lib/whatsappLink'
import { ExportTutorialArt, type ExportTutorialPlatform } from './ExportTutorialArt'
import { ModalShell } from './ModalShell'
import { WhatsAppRedirectConfirm } from './WhatsAppRedirectConfirm'

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
  goToWhatsApp: string
  privacy: string
  close: string
  installCta: string
  installDone: string
  installedNext: string
  installUnavailable: string
  installUnavailableNext: string
  whatsappConfirm: { title: string; body: string; confirm: string; cancel: string }
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
  const [platform, setPlatform] = useState<ExportTutorialPlatform>(detectDefaultTutorialPlatform)
  const [step, setStep] = useState(0)
  const [isWhatsAppConfirmOpen, setIsWhatsAppConfirmOpen] = useState(false)
  const { canInstall, isInstalled, install } = usePwaInstall()

  const steps = copy.steps[platform]
  const activeStep = steps[step]
  const isAndroidGuided = platform === 'android'
  const isLastStep = step === steps.length - 1
  // Mientras el navegador tenga el prompt nativo listo, ese es el CTA principal;
  // apenas se usa (aceptado o no — `install()` limpia `canInstall` en los dos
  // casos), el botón pasa a ofrecer el paso siguiente o las instrucciones manuales.
  const showInstallCta = activeStep.install === true && !isInstalled && canInstall

  function selectPlatform(next: ExportTutorialPlatform) {
    setPlatform(next)
    setStep(0)
  }

  function primaryLabel(): string {
    if (activeStep.install) {
      if (showInstallCta) return copy.installCta
      return isInstalled ? copy.installedNext : copy.installUnavailableNext
    }
    if (isAndroidGuided) {
      return isLastStep ? copy.goToWhatsApp : copy.next
    }
    return copy.pick
  }

  function handlePrimaryAction() {
    if (activeStep.install) {
      if (showInstallCta) {
        void install()
        return
      }
      setStep((current) => Math.min(current + 1, steps.length - 1))
      return
    }
    if (isAndroidGuided) {
      if (isLastStep) {
        setIsWhatsAppConfirmOpen(true)
        return
      }
      setStep((current) => current + 1)
      return
    }
    onPick()
  }

  return (
    <ModalShell onDismiss={onClose} label={copy.title} className="export-tutorial-modal" closeLabel={copy.close}>
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
            {isAndroidGuided ? null : (
              <button type="button" className="ghost-button" onClick={onPick}>
                {copy.skip}
              </button>
            )}
            <button type="button" className="primary-button" onClick={handlePrimaryAction}>
              {primaryLabel()}
            </button>
          </div>
        </div>

        {isWhatsAppConfirmOpen ? (
          <WhatsAppRedirectConfirm
            copy={{ ...copy.whatsappConfirm, close: copy.close }}
            onConfirm={() => {
              openWhatsAppApp()
              setIsWhatsAppConfirmOpen(false)
              onClose()
            }}
            onCancel={() => {
              setIsWhatsAppConfirmOpen(false)
              setStep(0)
            }}
          />
        ) : null}
    </ModalShell>
  )
}
