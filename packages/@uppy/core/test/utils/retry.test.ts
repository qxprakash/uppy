import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import retry, { AbortError } from '../../lib/utils/retry.js'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function failingTimes(n: number, error: () => unknown) {
  const attempts: number[] = []
  const start = Date.now()
  const fn = (attemptNumber: number) => {
    attempts.push(Date.now() - start)
    if (attemptNumber <= n) throw error()
    return attemptNumber
  }
  return { fn, attempts }
}

describe('retry', () => {
  it('retries with 1s, 2s, 4s, ... delays until it resolves', async () => {
    const { fn, attempts } = failingTimes(3, () => new Error('nope'))
    const onFailedAttempt = vi.fn()
    const promise = retry(fn, { retries: 10, onFailedAttempt })
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBe(4)
    expect(attempts).toEqual([0, 1000, 3000, 7000])
    expect(
      onFailedAttempt.mock.calls.map(([c]) => [c.attemptNumber, c.retriesLeft]),
    ).toEqual([
      [1, 10],
      [2, 9],
      [3, 8],
    ])
  })

  it('rejects with the last error after `retries + 1` attempts', async () => {
    const errors: Error[] = []
    const { fn, attempts } = failingTimes(Infinity, () => {
      errors.push(new Error(`fail ${errors.length + 1}`))
      return errors.at(-1)
    })
    const onFailedAttempt = vi.fn()
    const promise = retry(fn, { retries: 2, onFailedAttempt })
    promise.catch(() => {})
    await vi.runAllTimersAsync()
    await expect(promise).rejects.toBe(errors[2])
    expect(attempts).toHaveLength(3)
    expect(onFailedAttempt).toHaveBeenCalledTimes(3)
  })

  it('stops on AbortError and rejects with the wrapped error', async () => {
    const original = new Error('auth')
    const { fn, attempts } = failingTimes(
      Infinity,
      () => new AbortError(original),
    )
    const onFailedAttempt = vi.fn()
    await expect(retry(fn, { retries: 10, onFailedAttempt })).rejects.toBe(
      original,
    )
    expect(attempts).toHaveLength(1)
    expect(onFailedAttempt).not.toHaveBeenCalled()
  })

  it('does not retry a TypeError unless it is a network error', async () => {
    const typeError = new TypeError('x is not a function')
    const plain = failingTimes(Infinity, () => typeError)
    const onFailedAttempt = vi.fn()
    await expect(
      retry(plain.fn, { retries: 10, onFailedAttempt }),
    ).rejects.toBe(typeError)
    expect(plain.attempts).toHaveLength(1)
    expect(onFailedAttempt).toHaveBeenCalledTimes(1)

    const network = failingTimes(1, () => new TypeError('Failed to fetch'))
    const promise = retry(network.fn, { retries: 10 })
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBe(2)
  })

  it('rejects with the abort reason when the signal aborts during the delay', async () => {
    const controller = new AbortController()
    const { fn, attempts } = failingTimes(Infinity, () => new Error('nope'))
    const promise = retry(fn, { retries: 10, signal: controller.signal })
    promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(1500)
    controller.abort()
    await expect(promise).rejects.toBe(controller.signal.reason)
    await vi.runAllTimersAsync()
    expect(attempts).toEqual([0, 1000])
  })

  it('rejects right away when the signal is already aborted', async () => {
    const fn = vi.fn()
    const signal = AbortSignal.abort()
    await expect(retry(fn, { retries: 10, signal })).rejects.toBe(signal.reason)
    expect(fn).not.toHaveBeenCalled()
  })
})
