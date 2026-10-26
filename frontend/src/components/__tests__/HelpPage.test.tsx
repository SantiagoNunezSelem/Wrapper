import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shellCopy } from '../../copy/shellCopy'
import { ApiError, sendSupportReport } from '../../lib/api'
import type { UserProfile } from '../../types'
import { HelpPage } from '../HelpPage'

// Sólo se reemplaza el envío: lo que importa es qué se manda y qué se ve después.
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  sendSupportReport: vi.fn(),
}))

const copy = shellCopy.es.help

const user: UserProfile = {
  id: 'u1',
  email: 'santi@example.com',
  displayName: 'Santi',
  avatarUrl: null,
  isAdmin: false,
  hasUsedTrial: false,
  hasVipAccess: false,
  subscriptionState: 'inactiva',
  hasAiConsent: false,
  aiEnabled: true,
  paymentsEnabled: true,
  checkoutTestPayerEmail: null,
  preferredLanguage: 'es',
}

function renderHelp(props: Partial<Parameters<typeof HelpPage>[0]> = {}) {
  const handlers = { onBack: vi.fn(), onLanguageToggle: vi.fn(), onSignIn: vi.fn(), onOpenTerms: vi.fn() }
  render(<HelpPage language="es" copy={copy} user={user} token="token" {...handlers} {...props} />)
  return handlers
}

async function fillForm(description = 'Pagué y la app me sigue mostrando el plan gratis.') {
  await userEvent.selectOptions(screen.getByLabelText(copy.categoryLabel), copy.categories.pagos)
  await userEvent.type(screen.getByLabelText(copy.descriptionLabel), description)
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('HelpPage', () => {
  it('sin sesión no muestra el formulario: pide iniciarla', async () => {
    const handlers = renderHelp({ user: null, token: null })

    expect(screen.queryByLabelText(copy.descriptionLabel)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: copy.signInCta }))
    expect(handlers.onSignIn).toHaveBeenCalled()
  })

  it('arranca con el mail de la cuenta, que se puede cambiar', () => {
    renderHelp()

    expect(screen.getByLabelText(copy.emailLabel)).toHaveValue('santi@example.com')
  })

  it('manda el reporte con el mail elegido, el tema, la descripción y la pantalla', async () => {
    vi.mocked(sendSupportReport).mockResolvedValue({ id: 'r1', ticketCode: 'K7M2QX', createdAtUtc: '2026-10-25T12:00:00Z' })
    renderHelp()

    const email = screen.getByLabelText(copy.emailLabel)
    await userEvent.clear(email)
    await userEvent.type(email, 'otro@example.com')
    await fillForm()
    await userEvent.click(screen.getByRole('button', { name: copy.submit }))

    expect(sendSupportReport).toHaveBeenCalledWith('token', {
      contactEmail: 'otro@example.com',
      category: 'pagos',
      description: 'Pagué y la app me sigue mostrando el plan gratis.',
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      language: 'es',
    })
    expect(await screen.findByText(copy.sentTitle)).toBeInTheDocument()
    expect(screen.getByText(copy.sentBody.replace('{email}', 'otro@example.com'))).toBeInTheDocument()
  })

  it('al enviar le da un código de seguimiento, bien a la vista, y no un número de ticket', async () => {
    vi.mocked(sendSupportReport).mockResolvedValue({ id: 'r1', ticketCode: 'K7M2QX', createdAtUtc: '2026-10-25T12:00:00Z' })
    renderHelp()

    await fillForm()
    await userEvent.click(screen.getByRole('button', { name: copy.submit }))

    expect(await screen.findByText('K7M2QX')).toBeInTheDocument()
    expect(screen.getByText(copy.sentTicket)).toBeInTheDocument()
    expect(screen.getByText(copy.sentTicketHint)).toBeInTheDocument()
    expect(screen.queryByText(/ticket/i)).not.toBeInTheDocument()
    // Con el reporte enviado la única salida es volver: no hay "enviar otro".
    expect(screen.queryByRole('button', { name: /enviar otro/i })).not.toBeInTheDocument()
    const card = screen.getByRole('status')
    expect(within(card).getAllByRole('button')).toHaveLength(1)
    expect(within(card).getByRole('button', { name: copy.backToApp })).toBeInTheDocument()
  })

  it.each([
    ['daily_limit', 'nuevo', copy.errors.daily_limit, copy.errors.ticketOpen],
    ['weekly_limit', 'nuevo', copy.errors.weekly_limit, copy.errors.ticketOpen],
    ['daily_limit', 'resuelto', copy.errors.daily_limit, copy.errors.ticketResolved],
  ])('en el tope (%s, ticket %s) dice cuál es su ticket y que se está monitoreando', async (code, status, limitText, ticketText) => {
    vi.mocked(sendSupportReport).mockRejectedValue(
      new ApiError('Tope.', 429, code, { ticketCode: 'R4T9WB', ticketStatus: status }),
    )
    renderHelp()

    await fillForm()
    await userEvent.click(screen.getByRole('button', { name: copy.submit }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(limitText)
    expect(alert).toHaveTextContent(ticketText.replace('{code}', 'R4T9WB'))
    // El formulario sigue ahí con lo que escribió: no se pierde el texto por haber llegado al tope.
    expect(screen.getByLabelText(copy.descriptionLabel)).toHaveValue('Pagué y la app me sigue mostrando el plan gratis.')
  })

  it('un tope sin ticket en la respuesta igual dice cuál es el límite', async () => {
    vi.mocked(sendSupportReport).mockRejectedValue(new ApiError('Tope.', 429, 'weekly_limit'))
    renderHelp()

    await fillForm()
    await userEvent.click(screen.getByRole('button', { name: copy.submit }))

    expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.weekly_limit)
  })

  it('no manda nada sin elegir de qué se trata', async () => {
    renderHelp()

    await userEvent.type(screen.getByLabelText(copy.descriptionLabel), 'Una descripción suficientemente larga.')
    await userEvent.click(screen.getByRole('button', { name: copy.submit }))

    expect(sendSupportReport).not.toHaveBeenCalled()
  })

  it('si mandó demasiados seguidos, lo dice', async () => {
    vi.mocked(sendSupportReport).mockRejectedValue(new ApiError('Too many', 429))
    renderHelp()

    await fillForm()
    await userEvent.click(screen.getByRole('button', { name: copy.submit }))

    expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.rate_limited)
  })

  it('un rechazo con código muestra el texto propio de ese código', async () => {
    vi.mocked(sendSupportReport).mockRejectedValue(new ApiError('x', 400, 'invalid_email'))
    renderHelp()

    await fillForm()
    await userEvent.click(screen.getByRole('button', { name: copy.submit }))

    expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.invalid_email)
  })

  it('tiene un acceso a los términos', async () => {
    const handlers = renderHelp()

    await userEvent.click(screen.getByRole('button', { name: copy.termsLink }))

    expect(handlers.onOpenTerms).toHaveBeenCalled()
  })
})
