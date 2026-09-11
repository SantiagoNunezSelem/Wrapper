import { Component, type ReactNode } from 'react'

interface Props {
  /** Cambia con la sección y la cuenta abierta: navegar a otra cosa vuelve a intentar. */
  resetKey: string
  fallback: (retry: () => void) => ReactNode
  children: ReactNode
}

interface State {
  failed: boolean
  resetKey: string
}

/**
 * Una sección que se rompe no se lleva el panel entero. Sin esto, un dato inesperado en
 * una ficha (una moneda en null, por ejemplo) desmontaba todo y dejaba la pantalla en
 * blanco, sin menú para ir a otra parte.
 */
export class AdminErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, resetKey: this.props.resetKey }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { failed: false, resetKey: props.resetKey } : null
  }

  componentDidCatch(error: unknown) {
    console.error('[admin] una sección del panel falló al dibujarse', error)
  }

  render() {
    return this.state.failed ? this.props.fallback(() => this.setState({ failed: false })) : this.props.children
  }
}
