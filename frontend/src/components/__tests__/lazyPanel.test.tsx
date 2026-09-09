import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { lazyPanel } from '../lazyPanel'

/**
 * `lazyPanel` es lo que sostiene el corte del bundle: cinco pantallas del shell pasan por
 * acá. Un error en la espera —que no dibuje nada nunca, o que el fallback tape la pantalla
 * de abajo— no lo agarra ningún test de shell, porque los shells lo importan ya armado.
 */
describe('lazyPanel', () => {
  /** Un import que se resuelve cuando el test quiere, para poder mirar el mientras tanto. */
  function importeDiferido<T>(modulo: T) {
    let resolver!: () => void
    const listo = new Promise<void>((resolve) => {
      resolver = resolve
    })
    return {
      load: async () => {
        await listo
        return modulo
      },
      resolver,
    }
  }

  const Saludo = ({ nombre }: { nombre: string }) => <p>hola {nombre}</p>

  it('dibuja el componente con sus props una vez que baja el chunk', async () => {
    const { load, resolver } = importeDiferido({ Saludo })
    const Panel = lazyPanel(load, (m) => m.Saludo)

    render(<Panel nombre="Ana" />)
    resolver()

    expect(await screen.findByText('hola Ana')).toBeInTheDocument()
  })

  it("sin fallback no dibuja nada mientras espera: abajo sigue estando la pantalla que lo abrió", async () => {
    const { load, resolver } = importeDiferido({ Saludo })
    const Panel = lazyPanel(load, (m) => m.Saludo)

    const { container } = render(<Panel nombre="Ana" />)

    expect(container).toBeEmptyDOMElement()

    resolver()
    await waitFor(() => expect(screen.getByText('hola Ana')).toBeInTheDocument())
  })

  it("con 'screen' muestra el spinner mientras espera y lo saca al llegar", async () => {
    const { load, resolver } = importeDiferido({ Saludo })
    const Panel = lazyPanel(load, (m) => m.Saludo, 'screen')

    render(<Panel nombre="Ana" />)

    // `status` y no `alert`: es una espera, no algo que interrumpa al lector de pantalla.
    expect(screen.getByRole('status')).toBeInTheDocument()

    resolver()

    expect(await screen.findByText('hola Ana')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
