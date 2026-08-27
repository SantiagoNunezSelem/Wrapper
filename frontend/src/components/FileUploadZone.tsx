import { useRef, useState } from 'react'

/** Los textos de la zona de subida. Antes estaban escritos en inglés adentro del
 * componente, así que la landing en español mostraba "Drag your chat file here"
 * en su elemento más importante. Viven en `shellCopy` como todo el resto. */
export interface FileUploadZoneCopy {
  idle: string
  hint: string
  browse: string
  formats: string
  rejected: string
}

interface FileUploadZoneProps {
  copy: FileUploadZoneCopy
  onFileSelect: (file: File) => void
  isLoading?: boolean
  loadingMessage?: string
}

export function FileUploadZone({ copy, onFileSelect, isLoading = false, loadingMessage }: FileUploadZoneProps) {
  const [isDragActive, setIsDragActive] = useState(false)
  const [wasRejected, setWasRejected] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  /* `dragleave` también se dispara al cruzar de un hijo a otro dentro de la zona,
     así que contar entradas y salidas es lo que evita que el recuadro parpadee
     mientras el archivo sigue encima. */
  const dragDepth = useRef(0)

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current += 1
    setIsDragActive(true)
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    // Respaldo por si el `dragenter` no llegó (pasa en algunos navegadores cuando el
    // arrastre entra por un borde): la marca se enciende igual.
    setIsDragActive(true)
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) {
      setIsDragActive(false)
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current = 0
    setIsDragActive(false)

    const file = event.dataTransfer.files?.[0]

    /* Antes acá se filtraba por extensión y todo lo demás se descartaba sin decir
       nada — aunque el parser sí olfatea la firma real del .zip, justamente porque
       el share de WhatsApp a veces entrega el archivo sin extensión o renombrado.
       Ese filtro rechazaba archivos buenos en silencio. Ahora el archivo va derecho
       al parser, que ya sabe explicar qué pasó (y muestra el nombre, el tipo y una
       vista previa del contenido cuando no encuentra mensajes). Lo único que se
       responde acá es que no haya llegado ningún archivo —texto seleccionado, un
       link, una carpeta vacía—, donde el parser no tendría nada que mirar. */
    if (!file) {
      setWasRejected(true)
      return
    }

    setWasRejected(false)
    onFileSelect(file)
  }

  function handleFileInput(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) {
      setWasRejected(false)
      onFileSelect(file)
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div
      className={`file-upload-zone ${isDragActive ? 'is-active' : ''} ${isLoading ? 'is-loading' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
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
          <p className="upload-heading">{isLoading ? loadingMessage : copy.idle}</p>
          <p className="upload-subtext">{isLoading ? '' : copy.hint}</p>
        </div>

        {!isLoading && (
          <button type="button" className="primary-button" onClick={() => fileInputRef.current?.click()}>
            {copy.browse}
          </button>
        )}

        {!isLoading && <p className="upload-hint">{copy.formats}</p>}

        {/* Anunciado, no sólo dibujado: soltar algo y que no pase nada es
            exactamente el caso en el que hace falta que la app diga por qué. */}
        {wasRejected && !isLoading ? (
          <p className="upload-rejected" role="alert">
            {copy.rejected}
          </p>
        ) : null}
      </div>

      <div className="upload-zone-border" aria-hidden="true" />
    </div>
  )
}
