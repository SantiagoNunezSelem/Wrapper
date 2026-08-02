export function LoadingOverlay({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="loading-overlay" role="alert" aria-live="assertive">
      <div className="loading-overlay-spinner" aria-hidden="true" />
      <p className="loading-overlay-title">{title}</p>
      <p className="loading-overlay-subtitle">{subtitle}</p>
    </div>
  )
}
