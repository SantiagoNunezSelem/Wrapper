import { CrossButton } from './IconButton'

export interface FreeUnlockConfirmCopy {
  eyebrow: string
  title: string
  /** `{limit}` and `{n}` are filled in by the caller. */
  body: string
  /** `{metric}` — the card the unlock will be spent on. */
  metricLine: string
  confirm: string
  cancel: string
  close: string
}

/**
 * The stop before an unlock is spent. It exists because the allowance is small and does
 * not come back until tomorrow: opening a detail is one tap, and a resource that scarce
 * should never leave on one.
 *
 * Says which metric it is about by name, since the confirm can be reached from a card
 * that is already scrolled out of view behind the sheet.
 *
 * Confirming closes this immediately rather than sitting in a busy state: the wait that
 * follows belongs to the card's own detail section (see LockedPanel's `isRevealing`),
 * not to this full-screen backdrop.
 */
export function FreeUnlockConfirm({
  copy,
  metricTitle,
  remaining,
  dailyLimit,
  onConfirm,
  onCancel,
}: {
  copy: FreeUnlockConfirmCopy
  metricTitle: string
  remaining: number
  dailyLimit: number
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="modal-card free-unlock-modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <CrossButton label={copy.close} onClick={onCancel} className="close-button" />

        <p className="eyebrow">{copy.eyebrow}</p>
        <h2>{copy.title}</h2>

        <p className="panel-copy">
          {copy.body.replace('{limit}', String(dailyLimit)).replace('{n}', String(remaining))}
        </p>
        <p className="panel-copy free-unlock-metric">{copy.metricLine.replace('{metric}', metricTitle)}</p>

        <div className="free-unlock-actions">
          <button type="button" className="ghost-button" onClick={onCancel}>
            {copy.cancel}
          </button>
          <button type="button" className="primary-button" onClick={onConfirm}>
            {copy.confirm}
          </button>
        </div>
      </section>
    </div>
  )
}
