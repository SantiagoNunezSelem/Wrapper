interface LoadingOverlayProps {
  title: string
  subtitle: string
  /** Presence (not just value) is the switch: only the chat-analyzing phase ever
   * passes a number here, which is what swaps in the blob spinner + progress bar.
   * Every other busy state (upload parsing, saving, login, the AI pass) omits it
   * and keeps the plain ring spinner. */
  progress?: number | null
}

export function LoadingOverlay({ title, subtitle, progress }: LoadingOverlayProps) {
  const isAnalyzing = progress !== null && progress !== undefined
  const progressPercent = Math.round((progress ?? 0) * 100)

  return (
    <div className="loading-overlay" role="alert" aria-live="assertive">
      {isAnalyzing ? (
        <div className="loading-blob-wrap" aria-hidden="true">
          <div className="loading-blob" />
        </div>
      ) : (
        <div className="loading-overlay-spinner" aria-hidden="true" />
      )}

      <p className="loading-overlay-title">{title}</p>
      <p className="loading-overlay-subtitle">{subtitle}</p>

      {isAnalyzing ? (
        <div className="loading-progress-track" aria-hidden="true">
          <div className="loading-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
      ) : null}
    </div>
  )
}
