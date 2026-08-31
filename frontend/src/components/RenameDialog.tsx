import { useState, type FormEvent } from 'react'
import { ModalShell } from './ModalShell'

export interface RenameDialogCopy {
  title: string
  label: string
  placeholder: string
  save: string
  cancel: string
  busy: string
  close: string
}

/**
 * Le pone nombre a un chat guardado.
 *
 * Mismo molde que `ConfirmDialog` (título, una acción a la izquierda, la
 * principal a la derecha) con un campo de texto en el medio en vez de una
 * línea de contexto — es la única diferencia real con una confirmación.
 */
export function RenameDialog({
  copy,
  initialValue,
  isBusy = false,
  onSave,
  onCancel,
}: {
  copy: RenameDialogCopy
  initialValue: string
  isBusy?: boolean
  onSave: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const trimmed = value.trim()

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!trimmed || isBusy) {
      return
    }
    onSave(trimmed)
  }

  return (
    <ModalShell onDismiss={onCancel} label={copy.title} className="confirm-modal" closeLabel={copy.close}>
      <h2>{copy.title}</h2>

      <form onSubmit={handleSubmit} className="rename-form">
        <label className="rename-field">
          <span className="rename-field-label">{copy.label}</span>
          <input
            type="text"
            className="word-search-input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={copy.placeholder}
            maxLength={200}
            autoFocus
            disabled={isBusy}
          />
        </label>

        <div className="free-unlock-actions">
          <button type="button" className="ghost-button" onClick={onCancel} disabled={isBusy}>
            {copy.cancel}
          </button>
          <button type="submit" className="primary-button" disabled={isBusy || !trimmed}>
            {isBusy ? copy.busy : copy.save}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}
