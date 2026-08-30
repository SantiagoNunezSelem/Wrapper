import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { shellCopy } from '../../copy/shellCopy'
import type { MessageGroup } from '../../types'
import { MessageGroupItem } from '../MessageGroupItem'

const privacyCopy = shellCopy.es.sharedPrivacy

const group: MessageGroup = {
  id: 'msg-1',
  heading: 'Hele tardó 8.7 días en responder',
  bubbles: [
    { sender: 'Ana', text: 'che me contestás?', timestampLabel: '10 mar 14:20', isHighlight: false },
    { sender: 'Hele', text: 'perdón recién veo', timestampLabel: '19 mar 09:12', isHighlight: true },
  ],
}

describe('MessageGroupItem — en la app', () => {
  it('arranca colapsado, mostrando sólo el encabezado', () => {
    render(<MessageGroupItem group={group} />)

    expect(screen.getByText(group.heading)).toBeInTheDocument()
    expect(screen.queryByText('perdón recién veo')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  })

  it('al tocarlo despliega las burbujas reales', async () => {
    render(<MessageGroupItem group={group} />)

    await userEvent.click(screen.getByRole('button'))

    expect(screen.getByText('perdón recién veo')).toBeInTheDocument()
    expect(screen.getByText('che me contestás?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tardó/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('un segundo toque lo vuelve a cerrar', async () => {
    render(<MessageGroupItem group={group} />)

    await userEvent.click(screen.getByRole('button'))
    await userEvent.click(screen.getByRole('button', { name: /tardó/ }))

    expect(screen.queryByText('perdón recién veo')).not.toBeInTheDocument()
  })

  it('marca el grupo recién revelado', () => {
    render(<MessageGroupItem group={group} isNew />)

    expect(document.querySelector('.message-group')).toHaveClass('is-new')
  })
})

describe('MessageGroupItem — en un link compartido', () => {
  it('NUNCA muestra las burbujas, por más que se toque', async () => {
    render(<MessageGroupItem group={group} isSharedStory privacyCopy={privacyCopy} />)

    await userEvent.click(screen.getByRole('button'))

    expect(screen.queryByText('perdón recién veo')).not.toBeInTheDocument()
    expect(screen.queryByText('che me contestás?')).not.toBeInTheDocument()
  })

  it('explica por qué no se ven', async () => {
    render(<MessageGroupItem group={group} isSharedStory privacyCopy={privacyCopy} />)

    await userEvent.click(screen.getByRole('button'))

    expect(screen.getByText(privacyCopy.body)).toBeInTheDocument()
  })

  it('lo explica en el idioma del recorrido, no siempre en español', async () => {
    render(<MessageGroupItem group={group} isSharedStory privacyCopy={shellCopy.en.sharedPrivacy} />)

    await userEvent.click(screen.getByRole('button'))

    expect(screen.getByText(shellCopy.en.sharedPrivacy.body)).toBeInTheDocument()
    expect(screen.queryByText(privacyCopy.body)).not.toBeInTheDocument()
  })

  it('el aviso se puede cerrar', async () => {
    render(<MessageGroupItem group={group} isSharedStory privacyCopy={privacyCopy} />)

    await userEvent.click(screen.getByRole('button', { name: /tardó/ }))
    await userEvent.click(screen.getByRole('button', { name: privacyCopy.dismiss }))

    expect(screen.queryByText(privacyCopy.body)).not.toBeInTheDocument()
  })

  it('el encabezado sí se muestra: es un agregado, no una cita', () => {
    render(<MessageGroupItem group={group} isSharedStory privacyCopy={privacyCopy} />)

    expect(screen.getByText(group.heading)).toBeInTheDocument()
  })

  it('nunca queda marcado como expandido', async () => {
    render(<MessageGroupItem group={group} isSharedStory privacyCopy={privacyCopy} />)

    await userEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('button', { name: /tardó/ })).toHaveAttribute('aria-expanded', 'false')
  })
})
