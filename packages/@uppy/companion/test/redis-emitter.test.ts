import type { Redis } from 'ioredis'
import { describe, expect, test, vi } from 'vitest'
import redisEmitter, {
  escapeGlob,
  stringifyArgs,
} from '../dist/server/emitter/redis-emitter.js'

function fakeRedis() {
  const stub = {
    duplicate: vi.fn(() => stub),
    on: vi.fn(),
    off: vi.fn(),
    connect: vi.fn(async () => {}),
    psubscribe: vi.fn(async () => {}),
    punsubscribe: vi.fn(async () => {}),
    publish: vi.fn(async () => 1),
  }
  return stub
}

const asRedis = (stub: ReturnType<typeof fakeRedis>) => stub as unknown as Redis

test.each([
  ['plain', 'plain'],
  ['a*b', 'a\\*b'],
  ['a?b', 'a\\?b'],
  ['[abc]', '\\[abc\\]'],
  ['a\\b', 'a\\\\b'],
])('escapeGlob(%s)', (input, expected) => {
  expect(escapeGlob(input)).toBe(expected)
})

test('subscribes with an escaped pattern but publishes to the literal channel', async () => {
  const redis = fakeRedis()
  const em = redisEmitter(asRedis(redis), 'scope')
  await em.on('a*b', () => {})
  expect(redis.psubscribe).toHaveBeenCalledWith('scope:a\\*b')
  await em.emit('a*b', { x: 1 })
  expect(redis.publish).toHaveBeenCalledWith(
    'scope:a*b',
    JSON.stringify([{ x: 1 }]),
  )
})

test('delivers a pmessage whose pattern is the escaped name', async () => {
  const redis = fakeRedis()
  const em = redisEmitter(asRedis(redis), '')
  const handler = vi.fn()
  await em.on('a*b', handler)
  const call = redis.on.mock.calls.find(([ev]) => ev === 'pmessage') as
    | unknown[]
    | undefined
  const pmessage = call![1] as (p: string, c: string, m: string) => void
  pmessage('a\\*b', 'a*b', JSON.stringify(['hello']))
  expect(handler).toHaveBeenCalledWith('hello')
})

test('removing the last listener unsubscribes the escaped pattern', async () => {
  const redis = fakeRedis()
  const em = redisEmitter(asRedis(redis), 'scope')
  const h = () => {}
  await em.on('a*b', h)
  await em.removeListener('a*b', h)
  expect(redis.punsubscribe).toHaveBeenCalledWith('scope:a\\*b')
})

describe('stringifyArgs', () => {
  test('drops a property pointing back to an object it is nested in', () => {
    const obj: Record<string, unknown> = { a: 1, nested: { b: 2 } }
    obj['self'] = obj
    ;(obj['nested'] as Record<string, unknown>)['up'] = obj
    expect(stringifyArgs([obj])).toBe('[{"a":1,"nested":{"b":2}}]')
  })

  test('drops keys starting with an underscore', () => {
    expect(stringifyArgs([{ _internal: 1, a: { _b: 2, c: 3 } }])).toBe(
      '[{"a":{"c":3}}]',
    )
  })

  test('keeps an object that appears more than once without a cycle', () => {
    const shared = { x: 1 }
    expect(stringifyArgs(['token', { a: shared, b: [shared] }])).toBe(
      '["token",{"a":{"x":1},"b":[{"x":1}]}]',
    )
  })

  test("drops the string '[Circular]'", () => {
    expect(stringifyArgs([{ a: '[Circular]', b: 1 }])).toBe('[{"b":1}]')
  })
})

describe('emit with arguments that cannot be serialized', () => {
  test.each([
    ['a BigInt', { n: 1n }],
    [
      'a throwing toJSON',
      {
        toJSON() {
          throw new Error('nope')
        },
      },
    ],
  ])('%s is logged and not published', async (_name, arg) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const redis = fakeRedis()
      const em = redisEmitter(asRedis(redis), 'scope')
      await expect(em.emit('event', arg)).resolves.toBeUndefined()
      expect(redis.publish).not.toHaveBeenCalled()
      expect(log.mock.calls.flat().join(' ')).toContain(
        'emitter.serialize.error',
      )
    } finally {
      log.mockRestore()
    }
  })
})
