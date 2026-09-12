import { useState } from 'react'
import type { ExportTutorialCopy } from '../../components/ExportTutorialModal'
import { ExportTutorialArt, type ExportTutorialPlatform } from '../../components/ExportTutorialArt'
import { useModalDismiss } from '../../components/useModalDismiss'
import { WhatsAppRedirectConfirm } from '../../components/WhatsAppRedirectConfirm'
import { detectDefaultTutorialPlatform } from '../../lib/detectPlatform'
import { usePwaInstall } from '../../lib/usePwaInstall'
import { openWhatsAppApp } from '../../lib/whatsappLink'

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
  const [platform, setPlatform] = useState<ExportTutorialPlatform>(detectDefaultTutorialPlatform)
  const [step, setStep] = useState(0)
  const [isWhatsAppConfirmOpen, setIsWhatsAppConfirmOpen] = useState(false)
  const { canInstall, isInstalled, install } = usePwaInstall()

  // Escape, scroll de fondo y foco: los mismos que el resto de los diálogos.
  const panelRef = useModalDismiss<HTMLElement>(onClose)

  const steps = copy.steps[platform]
  const active = steps[step]
  const isLast = step === steps.length - 1
  const isAndroidGuided = platform === 'android'
  // Mientras el navegador tenga el prompt nativo listo, ese es el CTA principal;
  // apenas se usa (aceptado o no — `install()` limpia `canInstall` en los dos
  // casos), el botón pasa a ofrecer el paso siguiente o las instrucciones manuales.
  const showInstallCta = active.install === true && !isInstalled && canInstall

  function selectPlatform(next: ExportTutorialPlatform) {
    setPlatform(next)
    setStep(0)
  }

  function primaryLabel(): string {
    if (active.install) {
      if (showInstallCta) return copy.installCta
      return isInstalled ? copy.installedNext : copy.installUnavailableNext
    }
    if (isAndroidGuided && isLast) return copy.goToWhatsApp
    return isLast ? copy.pick : copy.next
  }

  function handlePrimary() {
    if (active.install) {
      if (showInstallCta) {
        void install()
        return
      }
      setStep((current) => Math.min(current + 1, steps.length - 1))
      return
    }
    if (isAndroidGuided && isLast) {
      setIsWhatsAppConfirmOpen(true)
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
              {active.install && isInstalled ? <span className="install-app-note">{copy.installDone}</span> : null}
              {active.install && !isInstalled && !canInstall ? (
                <span className="install-app-note">{copy.installUnavailable}</span>
              ) : null}
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
              {primaryLabel()}
            </button>
          </div>
          <p className="m-privacy-note">{copy.privacy}</p>
        </div>
      </section>

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
    </div>
  )
}
