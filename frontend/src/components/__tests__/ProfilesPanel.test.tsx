import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ParticipantProfile } from '../../types'
import { ProfilesPanel, type ProfilesCopy } from '../ProfilesPanel'

const copy: ProfilesCopy = {
  basedOn: 'Según {count} mensajes',
  aiBadge: 'IA',
  localBadge: 'Análisis local',
  also: 'También',
}

function profile(overrides: Partial<ParticipantProfile> = {}): ParticipantProfile {
  return {
    name: 'Ana',
    color: '#a78bfa',
    labelId: 'curioso',
    label: 'Curioso',
    summary: 'Pregunta todo: siempre quiere saber más.',
    source: 'ai',
    radar: [
      { axis: 'Presencia', value: 50 },
      { axis: 'Iniciativa', value: 100 },
      { axis: 'Rapidez', value: 86 },
      { axis: 'Expresividad', value: 17 },
      { axis: 'Detalle', value: 71 },
      { axis: 'Curiosidad', value: 100 },
    ],
    messageCount: 1234,
    ...overrides,
  }
}

describe('ProfilesPanel', () => {
  it('muestra la persona, su personalidad, la explicación y en cuántos mensajes se apoya', () => {
    render(<ProfilesPanel profiles={[profile()]} copy={copy} />)

    expect(screen.getByRole('heading', { name: 'Ana' })).toBeInTheDocument()
    expect(screen.getByText('Curioso')).toBeInTheDocument()
    expect(screen.getByText('Pregunta todo: siempre quiere saber más.')).toBeInTheDocument()
    expect(screen.getByText(`Según ${(1234).toLocaleString()} mensajes`)).toBeInTheDocument()
  })

  it('dibuja el radar de cada persona', () => {
    const { container } = render(<ProfilesPanel profiles={[profile(), profile({ name: 'Beto' })]} copy={copy} />)

    expect(container.querySelectorAll('.chart-radar')).toHaveLength(2)
    expect(screen.getAllByText('Curiosidad')).toHaveLength(2)
  })

  it('dice quién escribió cada una: la IA, o el análisis local cuando ella falló', () => {
    render(
      <ProfilesPanel
        profiles={[profile({ source: 'ai' }), profile({ name: 'Beto', source: 'local' })]}
        copy={copy}
      />,
    )

    expect(screen.getByText('IA')).toHaveClass('is-ai')
    expect(screen.getByText('Análisis local')).toHaveClass('is-local')
  })

  it('muestra la segunda personalidad solo si hay', () => {
    const { rerender } = render(<ProfilesPanel profiles={[profile()]} copy={copy} />)
    expect(screen.queryByText(/También/)).not.toBeInTheDocument()

    rerender(<ProfilesPanel profiles={[profile({ secondaryLabel: 'Líder', secondaryLabelId: 'lider' })]} copy={copy} />)
    expect(screen.getByText('También: Líder')).toBeInTheDocument()
  })

  it('le pone a cada persona su color, y sin color no pinta nada', () => {
    const { container } = render(
      <ProfilesPanel profiles={[profile(), profile({ name: 'Beto', color: undefined })]} copy={copy} />,
    )

    const dots = container.querySelectorAll<HTMLElement>('.profile-dot')
    expect(dots[0].style.background).not.toBe('')
    expect(dots[1].style.background).toBe('')
  })

  it('el texto va como texto, no como HTML', () => {
    const { container } = render(
      <ProfilesPanel profiles={[profile({ summary: '<img src=x onerror=alert(1)> y listo' })]} copy={copy} />,
    )

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('<img src=x onerror=alert(1)> y listo')).toBeInTheDocument()
  })
})
