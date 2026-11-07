import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import debounce from '../../lib/utils/debounce.js'
import throttle from '../../lib/utils/throttle.js'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('debounce', () => {
  it('calls once, `wait` ms after the last call, with the last arguments and `this`', () => {
    const calls: unknown[][] = []
    const fn = debounce(function (this: unknown, a: number) {
      calls.push([this, a])
    }, 100)
    const self = { id: 1 }

    fn.call(self, 1)
    vi.advanceTimersByTime(60)
    fn.call(self, 2)
    vi.advanceTimersByTime(99)
    expect(calls).toEqual([])
    vi.advanceTimersByTime(1)
    expect(calls).toEqual([[self, 2]])
    vi.advanceTimersByTime(1000)
    expect(calls).toHaveLength(1)
  })

  it('cancel() drops the pending call', () => {
    const spy = vi.fn()
    const fn = debounce(spy, 100)
    fn()
    fn.cancel()
    vi.advanceTimersByTime(1000)
    expect(spy).not.toHaveBeenCalled()
    fn()
    vi.advanceTimersByTime(100)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('with leading and trailing, calls right away and again only if called during the wait', () => {
    const spy = vi.fn()
    const fn = debounce(spy, 0, { leading: true, trailing: true })
    fn('a')
    expect(spy.mock.calls).toEqual([['a']])
    vi.advanceTimersByTime(10)
    expect(spy).toHaveBeenCalledTimes(1)

    fn('b')
    fn('c')
    expect(spy.mock.calls).toEqual([['a'], ['b']])
    vi.advanceTimersByTime(10)
    expect(spy.mock.calls).toEqual([['a'], ['b'], ['c']])
  })
})

describe('throttle', () => {
  it('calls at most once per `wait` ms, on both edges', () => {
    const spy = vi.fn()
    const fn = throttle(spy, 500)
    fn(1)
    expect(spy.mock.calls).toEqual([[1]])
    vi.advanceTimersByTime(100)
    fn(2)
    vi.advanceTimersByTime(100)
    fn(3)
    expect(spy).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(300)
    expect(spy.mock.calls).toEqual([[1], [3]])
    vi.advanceTimersByTime(2000)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('keeps calling every `wait` ms under a steady stream of calls', () => {
    const times: number[] = []
    const start = Date.now()
    const fn = throttle(() => times.push(Date.now() - start), 500)
    for (let t = 0; t <= 1600; t += 50) {
      fn()
      vi.advanceTimersByTime(50)
    }
    vi.advanceTimersByTime(1000)
    expect(times).toEqual([0, 500, 1000, 1500, 2000])
  })
})
