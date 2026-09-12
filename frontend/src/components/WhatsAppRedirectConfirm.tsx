import { ModalShell } from './ModalShell'

export interface WhatsAppRedirectConfirmCopy {
  title: string
  body: string
  confirm: string
  cancel: string
  close: string
}

/**
 * Ir a WhatsApp no es una acción destructiva — el `ConfirmDialog` compartido
 * siempre pinta su botón de confirmar como `is-danger`, que acá quedaría mal —
 * así que arma la tarjeta directo sobre `ModalShell`, igual que `PauseConfirmDialog`
 * en `SubscriptionPage` para su propia confirmación no destructiva.
 */
export function WhatsAppRedirectConfirm({
  copy,
  onConfirm,
  onCancel,
}: {
  copy: WhatsAppRedirectConfirmCopy
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <ModalShell onDismiss={onCancel} label={copy.title} className="confirm-modal whatsapp-redirect-modal" closeLabel={copy.close}>
      <h2>{copy.title}</h2>
      <p className="panel-copy">{copy.body}</p>

      <div className="free-unlock-actions">
        <button type="button" className="ghost-button" onClick={onCancel}>
          {copy.cancel}
        </button>
        <button type="button" className="primary-button" onClick={onConfirm}>
          {copy.confirm}
        </button>
      </div>
    </ModalShell>
  )
}
