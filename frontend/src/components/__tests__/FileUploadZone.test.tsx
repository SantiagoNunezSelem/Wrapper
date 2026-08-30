import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FileUploadZone } from '../FileUploadZone'
import { shellCopy } from '../../copy/shellCopy'

const copy = shellCopy.es.uploadZone

function zone() {
  return document.querySelector('.file-upload-zone') as HTMLDivElement
}

function fileInput() {
  return document.querySelector('input[type="file"]') as HTMLInputElement
}

function dropEvent(files: File[]) {
  return { dataTransfer: { files, items: [], types: ['Files'] } }
}

describe('FileUploadZone', () => {
  it('muestra la invitación y el botón cuando está en reposo', () => {
    render(<FileUploadZone copy={copy} onFileSelect={vi.fn()} />)

    expect(screen.getByText(copy.idle)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: copy.browse })).toBeInTheDocument()
    expect(screen.getByText(copy.formats)).toBeInTheDocument()
  })

  it('usa los textos del idioma que recibe, no unos fijos', () => {
    render(<FileUploadZone copy={shellCopy.en.uploadZone} onFileSelect={vi.fn()} />)

    expect(screen.getByText(shellCopy.en.uploadZone.idle)).toBeInTheDocument()
    expect(screen.queryByText(copy.idle)).not.toBeInTheDocument()
  })

  it('acepta sólo .txt y .zip en el selector nativo', () => {
    render(<FileUploadZone copy={copy} onFileSelect={vi.fn()} />)

    expect(fileInput()).toHaveAttribute('accept', '.txt,.zip')
  })

  it('durante la carga muestra el mensaje y esconde el botón', () => {
    render(<FileUploadZone copy={copy} onFileSelect={vi.fn()} isLoading loadingMessage="Analizando…" />)

    expect(screen.getByText('Analizando…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: copy.browse })).not.toBeInTheDocument()
    expect(zone()).toHaveClass('is-loading')
  })

  it('marca la zona mientras se arrastra algo encima', () => {
    render(<FileUploadZone copy={copy} onFileSelect={vi.fn()} />)

    fireEvent.dragEnter(zone())
    expect(zone()).toHaveClass('is-active')

    fireEvent.dragLeave(zone())
    expect(zone()).not.toHaveClass('is-active')
  })

  it('mantiene la marca mientras el cursor sigue encima', () => {
    render(<FileUploadZone copy={copy} onFileSelect={vi.fn()} />)

    fireEvent.dragOver(zone())

    expect(zone()).toHaveClass('is-active')
  })

  it('no parpadea al pasar de un hijo a otro dentro de la zona', () => {
    render(<FileUploadZone copy={copy} onFileSelect={vi.fn()} />)
    const child = zone().querySelector('.upload-zone-content') as HTMLElement

    // Entrar a la zona y después a un hijo deja dos "enter" contra un solo "leave":
    // sin el contador de profundidad, ese leave apagaba la marca con el archivo
    // todavía encima.
    fireEvent.dragEnter(zone())
    fireEvent.dragEnter(child)
    fireEvent.dragLeave(zone())

    expect(zone()).toHaveClass('is-active')
  })

  it.each(['chat.txt', 'export.zip', 'WhatsApp Chat con Ana.txt'])(
    'acepta %s soltado en la zona',
    (name) => {
      const onFileSelect = vi.fn()
      render(<FileUploadZone copy={copy} onFileSelect={onFileSelect} />)
      const file = new File(['contenido'], name)

      fireEvent.drop(zone(), dropEvent([file]))

      expect(onFileSelect).toHaveBeenCalledWith(file)
    },
  )

  it.each(['sin-extension', 'chat', '_chat.TXT', 'Chat de WhatsApp.zip.bin'])(
    'entrega %s al parser en vez de descartarlo por el nombre',
    (name) => {
      // El share de WhatsApp entrega el archivo sin extensión o renombrado bastante
      // seguido, y el parser sí olfatea la firma real del .zip: filtrar acá por
      // nombre rechazaba archivos buenos sin decir nada.
      const onFileSelect = vi.fn()
      render(<FileUploadZone copy={copy} onFileSelect={onFileSelect} />)
      const file = new File(['contenido'], name)

      fireEvent.drop(zone(), dropEvent([file]))

      expect(onFileSelect).toHaveBeenCalledWith(file)
    },
  )

  it('quita la marca de arrastre después de soltar', () => {
    render(<FileUploadZone copy={copy} onFileSelect={vi.fn()} />)

    fireEvent.dragEnter(zone())
    fireEvent.drop(zone(), dropEvent([new File(['x'], 'chat.txt')]))

    expect(zone()).not.toHaveClass('is-active')
  })

  it('avisa cuando se suelta algo que no es un archivo, en vez de no hacer nada', () => {
    const onFileSelect = vi.fn()
    render(<FileUploadZone copy={copy} onFileSelect={onFileSelect} />)

    fireEvent.drop(zone(), dropEvent([]))

    expect(onFileSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(copy.rejected)
  })

  it('borra el aviso de rechazo en cuanto llega un archivo', () => {
    render(<FileUploadZone copy={copy} onFileSelect={vi.fn()} />)

    fireEvent.drop(zone(), dropEvent([]))
    expect(screen.getByRole('alert')).toBeInTheDocument()

    fireEvent.drop(zone(), dropEvent([new File(['x'], 'chat.txt')]))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('sólo toma el primer archivo cuando se sueltan varios', () => {
    const onFileSelect = vi.fn()
    render(<FileUploadZone copy={copy} onFileSelect={onFileSelect} />)
    const first = new File(['a'], 'uno.txt')

    fireEvent.drop(zone(), dropEvent([first, new File(['b'], 'dos.txt')]))

    expect(onFileSelect).toHaveBeenCalledTimes(1)
    expect(onFileSelect).toHaveBeenCalledWith(first)
  })

  it('el botón abre el selector nativo', async () => {
    render(<FileUploadZone copy={copy} onFileSelect={vi.fn()} />)
    const clickSpy = vi.spyOn(fileInput(), 'click').mockImplementation(() => {})

    await userEvent.click(screen.getByRole('button', { name: copy.browse }))

    expect(clickSpy).toHaveBeenCalled()
  })

  it('entrega el archivo elegido desde el selector', async () => {
    const onFileSelect = vi.fn()
    render(<FileUploadZone copy={copy} onFileSelect={onFileSelect} />)
    const file = new File(['contenido'], 'chat.txt', { type: 'text/plain' })

    await userEvent.upload(fileInput(), file)

    expect(onFileSelect).toHaveBeenCalledWith(file)
  })

  it('limpia el input para poder volver a elegir el mismo archivo', async () => {
    const onFileSelect = vi.fn()
    render(<FileUploadZone copy={copy} onFileSelect={onFileSelect} />)
    const file = new File(['contenido'], 'chat.txt', { type: 'text/plain' })

    await userEvent.upload(fileInput(), file)

    expect(fileInput().value).toBe('')

    await userEvent.upload(fileInput(), file)
    expect(onFileSelect).toHaveBeenCalledTimes(2)
  })
})
