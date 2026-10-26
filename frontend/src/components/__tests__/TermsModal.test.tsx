import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { shellCopy } from '../../copy/shellCopy'
import { TERMS_SECTIONS } from '../../copy/termsText'
import { TermsModal } from '../TermsModal'

const copy = shellCopy.es.terms

function renderModal(props: Partial<Parameters<typeof TermsModal>[0]> = {}) {
  const handlers = { onAccept: vi.fn(), onSignOut: vi.fn() }
  render(<TermsModal copy={copy} isBusy={false} error="" {...handlers} {...props} />)
  return handlers
}

describe('TermsModal', () => {
  it('al principio es sólo el aviso: el texto de los términos no está', () => {
    renderModal()

    expect(screen.getByRole('button', { name: copy.viewTerms })).toHaveAttribute('aria-expanded', 'false')
    for (const section of TERMS_SECTIONS) {
      expect(screen.queryByRole('heading', { name: section.title })).not.toBeInTheDocument()
    }
  })

  it('el link despliega el texto entero en el mismo cartel y se puede volver a ocultar', async () => {
    renderModal()

    await userEvent.click(screen.getByRole('button', { name: copy.viewTerms }))

    for (const section of TERMS_SECTIONS) {
      expect(await screen.findByRole('heading', { name: section.title })).toBeInTheDocument()
    }
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: copy.hideTerms }))

    expect(screen.queryByRole('heading', { name: TERMS_SECTIONS[0].title })).not.toBeInTheDocument()
  })

  it('no deja aceptar sin marcar la casilla, sin haber abierto el texto', async () => {
    const handlers = renderModal()
    const accept = screen.getByRole('button', { name: copy.accept })

    expect(accept).toBeDisabled()
    await userEvent.click(screen.getByLabelText(copy.checkbox))
    expect(accept).toBeEnabled()

    await userEvent.click(accept)
    expect(handlers.onAccept).toHaveBeenCalledTimes(1)
  })

  it('no se cierra con Escape: las salidas son aceptar o cerrar sesión', async () => {
    const handlers = renderModal()

    await userEvent.keyboard('{Escape}')

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(handlers.onAccept).not.toHaveBeenCalled()
    expect(handlers.onSignOut).not.toHaveBeenCalled()
  })

  it('quien no acepta puede cerrar la sesión', async () => {
    const handlers = renderModal()

    await userEvent.click(screen.getByRole('button', { name: copy.signOut }))

    expect(handlers.onSignOut).toHaveBeenCalled()
  })

  it('muestra el error si no se pudo guardar', () => {
    renderModal({ error: copy.acceptError })

    expect(screen.getByRole('alert')).toHaveTextContent(copy.acceptError)
  })
})
