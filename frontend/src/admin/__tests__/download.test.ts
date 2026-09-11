import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveFile } from '../download'

const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }

afterEach(() => {
  URL.createObjectURL = original.create
  URL.revokeObjectURL = original.revoke
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('guardar un archivo', () => {
  it('lo baja con su nombre y libera el link un rato después, no enseguida', () => {
    vi.useFakeTimers()
    const create = vi.fn(() => 'blob:vistazo/1')
    const revoke = vi.fn()
    URL.createObjectURL = create
    URL.revokeObjectURL = revoke
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this)
    })
    const file = new Blob(['id,email'])

    saveFile(file, 'vistazo-usuarios.csv')

    expect(create).toHaveBeenCalledWith(file)
    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe('vistazo-usuarios.csv')
    expect(clicked[0].href).toBe('blob:vistazo/1')
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revoke).not.toHaveBeenCalled()

    vi.runAllTimers()

    expect(revoke).toHaveBeenCalledWith('blob:vistazo/1')
  })
})
