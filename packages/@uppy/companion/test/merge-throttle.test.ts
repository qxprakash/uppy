import { afterEach, describe, expect, test, vi } from 'vitest'
import { merge, throttle } from '../dist/server/helpers/utils.js'

describe('merge', () => {
  test('merges plain objects deeply, into copies', () => {
    const defaults = { server: { protocol: 'http', path: '' }, metrics: true }
    const options = { server: { host: 'localhost' } }
    const result = merge({}, defaults, options)
    expect(result).toEqual({
      server: { protocol: 'http', path: '', host: 'localhost' },
      metrics: true,
    })
    expect(result.server).not.toBe(defaults.server)
    expect(defaults.server).toEqual({ protocol: 'http', path: '' })
  })

  test('merges arrays index by index', () => {
    const result = merge({}, { list: ['a', 'b', 'c'] }, { list: ['z'] })
    expect(result.list).toEqual(['z', 'b', 'c'])
  })

  test('an undefined value does not replace an existing one', () => {
    const result = merge(
      {},
      { a: 1, b: { c: 2 } },
      { a: undefined, b: { c: undefined } },
    )
    expect(result).toEqual({ a: 1, b: { c: 2 } })
    expect(merge({}, {}, { a: undefined })).toHaveProperty('a', undefined)
  })

  test('null replaces a value', () => {
    expect(merge({}, { a: { b: 1 } }, { a: null })).toEqual({ a: null })
  })

  test('assigns functions, RegExps and class instances as they are', () => {
    const fn = () => {}
    const re = /x/
    const instance = new Map()
    const result = merge({}, {}, { fn, re, instance, list: [re] })
    expect(result.fn).toBe(fn)
    expect(result.re).toBe(re)
    expect(result.instance).toBe(instance)
    expect(result.list[0]).toBe(re)
  })

  test('does not pollute Object.prototype', () => {
    const result = merge(
      {},
      JSON.parse('{"__proto__":{"polluted":true}}'),
      JSON.parse('{"constructor":{"prototype":{"polluted":true}}}'),
    )
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Object.hasOwn(result, '__proto__')).toBe(false)
  })

  test('copes with a source that refers to itself', () => {
    const source: Record<string, unknown> = { a: 1 }
    source['self'] = source
    const result = merge({}, { b: 2 }, source) as Record<string, unknown>
    // as with lodash: the copy of `source` under `self` refers to itself
    const copy = result['self'] as Record<string, unknown>
    expect(result['a']).toBe(1)
    expect(result['b']).toBe(2)
    expect(copy).not.toBe(source)
    expect(copy['a']).toBe(1)
    expect(copy['self']).toBe(copy)
  })
})

describe('throttle', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('calls on the leading edge only, at most once per wait', () => {
    vi.useFakeTimers({ now: 10_000 })
    const fn = vi.fn()
    const throttled = throttle(fn, 1000)

    throttled(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith(1)

    vi.advanceTimersByTime(999)
    throttled(2)
    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    throttled(3)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith(3)

    // no trailing call for the dropped ones
    throttled(4)
    vi.advanceTimersByTime(5000)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
