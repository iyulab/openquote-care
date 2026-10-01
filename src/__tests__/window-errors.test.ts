import { describe, expect, it, vi } from 'vitest'
import { reportUnhandledErrors } from '../window-errors.js'

function window() {
  const target = new EventTarget()
  const report = vi.fn((_kind: string, _stack: string) => Promise.resolve())
  reportUnhandledErrors(target as unknown as Window, report)
  const fire = (type: string, props: object) => target.dispatchEvent(Object.assign(new Event(type), props))
  return { report, fire }
}

describe('reportUnhandledErrors', () => {
  it('hands an uncaught error on as its type name and stack', () => {
    const { report, fire } = window()
    const error = new TypeError('cannot read a field of a record')
    fire('error', { error })
    expect(report).toHaveBeenCalledWith('TypeError', error.stack)
  })

  it('hands an unawaited rejection with an error on the same way', () => {
    const { report, fire } = window()
    const error = new RangeError('out of range')
    fire('unhandledrejection', { reason: error })
    expect(report).toHaveBeenCalledWith('RangeError', error.stack)
  })

  it('leaves out what is not an error of the window’s own code', () => {
    const { report, fire } = window()
    fire('unhandledrejection', { reason: { code: 'wrong-passphrase', message: 'the passphrase does not open this vault' } })
    fire('unhandledrejection', { reason: 'a value' })
    fire('error', { error: null })
    expect(report).not.toHaveBeenCalled()
  })

  it('lets a report that cannot be handed over go, without a failure of its own', async () => {
    const target = new EventTarget()
    const report = vi.fn(() => Promise.reject(new Error('the shell is gone')))
    reportUnhandledErrors(target as unknown as Window, report)
    target.dispatchEvent(Object.assign(new Event('error'), { error: new Error('x') }))
    await Promise.resolve()
    expect(report).toHaveBeenCalledTimes(1)
  })
})
