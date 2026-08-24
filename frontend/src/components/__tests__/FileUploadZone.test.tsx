import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FileUploadZone } from '../FileUploadZone'

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
    render(<FileUploadZone onFileSelect={vi.fn()} />)

    expect(screen.getByText('Drag your chat file here')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Browse files' })).toBeInTheDocument()
    expect(screen.getByText(/WhatsApp \.txt or \.zip export/)).toBeInTheDocument()
  })

  it('acepta sólo .txt y .zip en el selector nativo', () => {
    render(<FileUploadZone onFileSelect={vi.fn()} />)

    expect(fileInput()).toHaveAttribute('accept', '.txt,.zip')
  })

  it('durante la carga muestra el mensaje y esconde el botón', () => {
    render(<FileUploadZone onFileSelect={vi.fn()} isLoading loadingMessage="Analizando…" />)

    expect(screen.getByText('Analizando…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Browse files' })).not.toBeInTheDocument()
    expect(zone()).toHaveClass('is-loading')
  })

  it('marca la zona mientras se arrastra algo encima', () => {
    render(<FileUploadZone onFileSelect={vi.fn()} />)

    fireEvent.dragEnter(zone())
    expect(zone()).toHaveClass('is-active')

    fireEvent.dragLeave(zone())
    expect(zone()).not.toHaveClass('is-active')
  })

  it('mantiene la marca mientras el cursor sigue encima', () => {
    render(<FileUploadZone onFileSelect={vi.fn()} />)

    fireEvent.dragOver(zone())

    expect(zone()).toHaveClass('is-active')
  })

  it.each(['chat.txt', 'export.zip', 'WhatsApp Chat con Ana.txt'])(
    'acepta %s soltado en la zona',
    (name) => {
      const onFileSelect = vi.fn()
      render(<FileUploadZone onFileSelect={onFileSelect} />)
      const file = new File(['contenido'], name)

      fireEvent.drop(zone(), dropEvent([file]))

      expect(onFileSelect).toHaveBeenCalledWith(file)
    },
  )

  it.each(['foto.jpg', 'documento.pdf', 'chat.txt.exe', 'sin-extension'])(
    'ignora %s soltado en la zona',
    (name) => {
      const onFileSelect = vi.fn()
      render(<FileUploadZone onFileSelect={onFileSelect} />)

      fireEvent.drop(zone(), dropEvent([new File(['x'], name)]))

      expect(onFileSelect).not.toHaveBeenCalled()
    },
  )

  it('quita la marca de arrastre después de soltar, aunque el archivo se rechace', () => {
    render(<FileUploadZone onFileSelect={vi.fn()} />)

    fireEvent.dragEnter(zone())
    fireEvent.drop(zone(), dropEvent([new File(['x'], 'foto.jpg')]))

    expect(zone()).not.toHaveClass('is-active')
  })

  it('no rompe cuando se suelta algo que no es un archivo', () => {
    const onFileSelect = vi.fn()
    render(<FileUploadZone onFileSelect={onFileSelect} />)

    fireEvent.drop(zone(), dropEvent([]))

    expect(onFileSelect).not.toHaveBeenCalled()
  })

  it('sólo toma el primer archivo cuando se sueltan varios', () => {
    const onFileSelect = vi.fn()
    render(<FileUploadZone onFileSelect={onFileSelect} />)
    const first = new File(['a'], 'uno.txt')

    fireEvent.drop(zone(), dropEvent([first, new File(['b'], 'dos.txt')]))

    expect(onFileSelect).toHaveBeenCalledTimes(1)
    expect(onFileSelect).toHaveBeenCalledWith(first)
  })

  it('el botón abre el selector nativo', async () => {
    render(<FileUploadZone onFileSelect={vi.fn()} />)
    const clickSpy = vi.spyOn(fileInput(), 'click').mockImplementation(() => {})

    await userEvent.click(screen.getByRole('button', { name: 'Browse files' }))

    expect(clickSpy).toHaveBeenCalled()
  })

  it('entrega el archivo elegido desde el selector', async () => {
    const onFileSelect = vi.fn()
    render(<FileUploadZone onFileSelect={onFileSelect} />)
    const file = new File(['contenido'], 'chat.txt', { type: 'text/plain' })

    await userEvent.upload(fileInput(), file)

    expect(onFileSelect).toHaveBeenCalledWith(file)
  })

  it('limpia el input para poder volver a elegir el mismo archivo', async () => {
    const onFileSelect = vi.fn()
    render(<FileUploadZone onFileSelect={onFileSelect} />)
    const file = new File(['contenido'], 'chat.txt', { type: 'text/plain' })

    await userEvent.upload(fileInput(), file)

    expect(fileInput().value).toBe('')

    await userEvent.upload(fileInput(), file)
    expect(onFileSelect).toHaveBeenCalledTimes(2)
  })
})
