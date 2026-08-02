import { useRef, useState } from 'react'

interface FileUploadZoneProps {
  onFileSelect: (file: File) => void
  isLoading?: boolean
  loadingMessage?: string
}

export function FileUploadZone({ onFileSelect, isLoading = false, loadingMessage }: FileUploadZoneProps) {
  const [isDragActive, setIsDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function handleDrag(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (event.type === 'dragenter' || event.type === 'dragover') {
      setIsDragActive(true)
    } else if (event.type === 'dragleave') {
      setIsDragActive(false)
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDragActive(false)

    const file = event.dataTransfer.files?.[0]
    if (file && (file.name.endsWith('.txt') || file.name.endsWith('.zip'))) {
      onFileSelect(file)
    }
  }

  function handleFileInput(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) {
      onFileSelect(file)
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div
      className={`file-upload-zone ${isDragActive ? 'is-active' : ''} ${isLoading ? 'is-loading' : ''}`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.zip"
        onChange={handleFileInput}
        className="hidden-file-input"
      />

      <div className="upload-zone-content">
        <div className="upload-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width={48} height={48} fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>

        <div className="upload-text">
          <p className="upload-heading">
            {isLoading ? loadingMessage : 'Drag your chat file here'}
          </p>
          <p className="upload-subtext">
            {isLoading ? '' : 'or click the button below'}
          </p>
        </div>

        {!isLoading && (
          <button
            type="button"
            className="primary-button"
            onClick={() => fileInputRef.current?.click()}
          >
            Browse files
          </button>
        )}

        {!isLoading && (
          <p className="upload-hint">
            Supported formats: WhatsApp .txt or .zip export
          </p>
        )}
      </div>

      <div className="upload-zone-border" aria-hidden="true" />
    </div>
  )
}
