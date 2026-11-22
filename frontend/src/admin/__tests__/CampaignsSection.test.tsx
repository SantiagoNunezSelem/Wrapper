import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adminCopy } from '../../copy/adminCopy'
import type { AdminCampaign } from '../types'

vi.mock('../adminApi', () => ({
  getAdminCampaigns: vi.fn(),
  getAdminCampaignUsers: vi.fn(),
  createAdminCampaign: vi.fn(),
  renameAdminCampaign: vi.fn(),
  resetAdminCampaignVisits: vi.fn(),
  deleteAdminCampaign: vi.fn(),
}))

import * as api from '../adminApi'
import { CampaignsSection } from '../CampaignsSection'

const copy = adminCopy.es

function campaign(overrides: Partial<AdminCampaign>): AdminCampaign {
  return {
    id: 'c1',
    code: 'ab3k9x',
    title: 'Folleto red flags',
    createdAtUtc: '2026-11-01T12:00:00Z',
    visitsResetAtUtc: null,
    visits: 40,
    uniqueVisitors: 30,
    lastVisitAtUtc: '2026-11-20T12:00:00Z',
    signups: 6,
    trials: 3,
    paid: 2,
    revenue: 15600,
    ...overrides,
  }
}

function renderSection() {
  return render(<CampaignsSection token="t" language="es" copy={copy} onOpenUser={vi.fn()} />)
}

describe('Campañas', () => {
  beforeEach(() => {
    vi.mocked(api.getAdminCampaigns).mockResolvedValue([
      campaign({}),
      campaign({ id: 'c2', code: 'zz77qq', title: 'Personalidad de tu pareja', visits: 90, uniqueVisitors: 80, signups: 9, paid: 1 }),
    ])
    vi.mocked(api.getAdminCampaignUsers).mockResolvedValue([])
    vi.mocked(api.resetAdminCampaignVisits).mockResolvedValue()
    vi.mocked(api.deleteAdminCampaign).mockResolvedValue()
  })

  it('compara las campañas y ordena por la columna elegida', async () => {
    renderSection()
    const rows = await screen.findAllByRole('row')

    // Por defecto, la que más pagos trajo arriba.
    expect(within(rows[1]).getByText('Folleto red flags')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^Visitas/ }))
    expect(within(screen.getAllByRole('row')[1]).getByText('Personalidad de tu pareja')).toBeInTheDocument()
  })

  it('muestra el link fijo de la campaña', async () => {
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'Folleto red flags' }))

    expect(screen.getByText(`${window.location.origin}/q/ab3k9x`)).toBeInTheDocument()
  })

  it('reiniciar las visitas pide confirmación antes de hacer nada', async () => {
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'Folleto red flags' }))

    await userEvent.click(screen.getByRole('button', { name: copy.campaigns.resetVisits }))
    expect(api.resetAdminCampaignVisits).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toHaveTextContent('40 visitas')

    await userEvent.click(screen.getByRole('button', { name: copy.campaigns.confirm }))
    await waitFor(() => expect(api.resetAdminCampaignVisits).toHaveBeenCalledWith('t', 'c1'))
  })

  it('borrar pide confirmación y se puede volver atrás', async () => {
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'Folleto red flags' }))

    await userEvent.click(screen.getByRole('button', { name: copy.campaigns.delete }))
    await userEvent.click(screen.getByRole('button', { name: copy.campaigns.back }))
    expect(api.deleteAdminCampaign).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: copy.campaigns.delete }))
    await userEvent.click(screen.getByRole('button', { name: copy.campaigns.confirm }))
    await waitFor(() => expect(api.deleteAdminCampaign).toHaveBeenCalledWith('t', 'c1'))
  })
})
