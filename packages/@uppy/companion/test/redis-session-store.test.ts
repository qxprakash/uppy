import express from 'express'
import type { SessionData } from 'express-session'
import session from 'express-session'
import type { Command } from 'ioredis'
import { Redis } from 'ioredis'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import RedisSessionStore from '../dist/server/redis-session-store.js'

const NOW = new Date('2026-01-01T00:00:00.000Z')

// A real ioredis client whose commands are answered from memory, so the
// test sees the exact commands and arguments that would go to Redis.
function fakeRedis() {
  const data = new Map<string, string>()
  const ttls = new Map<string, number>()
  const commands: unknown[][] = []
  const redis = new Redis({ lazyConnect: true })
  const reply = (name: string, args: string[]): unknown => {
    const [key = ''] = args
    switch (name) {
      case 'get':
        return data.get(key) ?? null
      case 'set':
        data.set(key, args[1]!)
        if (args[2] === 'EX') ttls.set(key, Number(args[3]))
        return 'OK'
      case 'del':
        return args.filter((k) => data.delete(k)).length
      case 'expire':
        if (!data.has(key)) return 0
        if (Number(args[1]) <= 0) data.delete(key)
        else ttls.set(key, Number(args[1]))
        return 1
      default:
        throw new Error(`unexpected command ${name}`)
    }
  }
  vi.spyOn(redis, 'sendCommand').mockImplementation((command: Command) => {
    commands.push([command.name, ...command.args])
    try {
      command.resolve(reply(command.name, command.args.map(String)))
    } catch (err) {
      command.reject(err as Error)
    }
    return command.promise
  })
  return { redis, data, ttls, commands }
}

function call<T>(
  fn: (cb: (err?: unknown, value?: T) => void) => unknown,
): Promise<{ err: unknown; value: T | undefined }> {
  return new Promise((resolve) => {
    fn((err, value) => resolve({ err, value }))
  })
}

const sessionWithExpiry = (expires: Date | undefined) =>
  ({
    cookie: { originalMaxAge: 600000, expires, httpOnly: true, path: '/' },
    grant: { provider: 'dropbox' },
  }) as unknown as SessionData

describe('RedisSessionStore', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('set stores JSON under the prefix with a TTL from the cookie', async () => {
    const { redis, data, commands } = fakeRedis()
    const store = new RedisSessionStore({ client: redis, prefix: 'pre:' })
    const sess = sessionWithExpiry(new Date(NOW.getTime() + 600000))
    const { err } = await call((cb) => store.set('abc', sess, cb))
    expect(err).toBeUndefined()
    expect(commands).toEqual([
      ['set', 'pre:abc', JSON.stringify(sess), 'EX', '600'],
    ])
    expect(data.get('pre:abc')).toBe(
      '{"cookie":{"originalMaxAge":600000,"expires":"2026-01-01T00:10:00.000Z","httpOnly":true,"path":"/"},"grant":{"provider":"dropbox"}}',
    )
  })

  test('set rounds a partial second up', async () => {
    const { redis, commands } = fakeRedis()
    const store = new RedisSessionStore({ client: redis, prefix: 'pre:' })
    const sess = sessionWithExpiry(new Date(NOW.getTime() + 1500))
    await call((cb) => store.set('abc', sess, cb))
    expect(commands[0]!.slice(3)).toEqual(['EX', '2'])
  })

  test('set uses one day when the cookie has no expiry', async () => {
    const { redis, commands } = fakeRedis()
    const store = new RedisSessionStore({ client: redis, prefix: 'pre:' })
    await call((cb) => store.set('abc', sessionWithExpiry(undefined), cb))
    expect(commands[0]!.slice(3)).toEqual(['EX', '86400'])
  })

  test('set deletes the session when the cookie has already expired', async () => {
    const { redis, data, commands } = fakeRedis()
    data.set('pre:abc', '{}')
    const store = new RedisSessionStore({ client: redis, prefix: 'pre:' })
    const { err } = await call((cb) =>
      store.set('abc', sessionWithExpiry(NOW), cb),
    )
    expect(err).toBeUndefined()
    expect(commands).toEqual([['del', 'pre:abc']])
    expect(data.has('pre:abc')).toBe(false)
  })

  test('get parses the stored session and returns nothing for a missing one', async () => {
    const { redis, data } = fakeRedis()
    data.set('pre:abc', '{"grant":{"provider":"box"}}')
    const store = new RedisSessionStore({ client: redis, prefix: 'pre:' })
    expect(await call((cb) => store.get('abc', cb))).toEqual({
      err: null,
      value: { grant: { provider: 'box' } },
    })
    const missing = await call((cb) => store.get('nope', cb))
    expect(missing.err).toBeFalsy()
    expect(missing.value).toBeUndefined()
  })

  test('get passes a JSON error to the callback', async () => {
    const { redis, data } = fakeRedis()
    data.set('pre:abc', 'not json')
    const store = new RedisSessionStore({ client: redis, prefix: 'pre:' })
    const { err } = await call((cb) => store.get('abc', cb))
    expect(err).toBeInstanceOf(SyntaxError)
  })

  test('touch sets the expiry from the cookie', async () => {
    const { redis, data, ttls, commands } = fakeRedis()
    data.set('pre:abc', '{}')
    const store = new RedisSessionStore({ client: redis, prefix: 'pre:' })
    const sess = sessionWithExpiry(new Date(NOW.getTime() + 300000))
    const { err } = await call((cb) => store.touch('abc', sess, cb))
    expect(err).toBeUndefined()
    expect(commands).toEqual([['expire', 'pre:abc', '300']])
    expect(ttls.get('pre:abc')).toBe(300)
  })

  test('destroy deletes the key', async () => {
    const { redis, data, commands } = fakeRedis()
    data.set('pre:abc', '{}')
    const store = new RedisSessionStore({ client: redis, prefix: 'pre:' })
    const { err } = await call((cb) => store.destroy('abc', cb))
    expect(err).toBeUndefined()
    expect(commands).toEqual([['del', 'pre:abc']])
    expect(data.size).toBe(0)
  })

  test('passes Redis errors to the callback', async () => {
    const { redis } = fakeRedis()
    const failure = new Error('connection lost')
    vi.mocked(redis.sendCommand).mockImplementation((command: Command) => {
      command.reject(failure)
      return command.promise
    })
    const store = new RedisSessionStore({ client: redis, prefix: 'pre:' })
    const sess = sessionWithExpiry(undefined)
    expect((await call((cb) => store.get('abc', cb))).err).toBe(failure)
    expect((await call((cb) => store.set('abc', sess, cb))).err).toBe(failure)
    expect((await call((cb) => store.touch('abc', sess, cb))).err).toBe(failure)
    expect((await call((cb) => store.destroy('abc', cb))).err).toBe(failure)
  })
})

test('works as the express-session store', async () => {
  const { redis, data, ttls } = fakeRedis()
  const app = express()
  app.use(
    session({
      secret: 'test-secret',
      resave: true,
      saveUninitialized: true,
      cookie: { maxAge: 10 * 60 * 1000 },
      store: new RedisSessionStore({ client: redis, prefix: 'sess-test:' }),
    }),
  )
  app.get('/set', (req, res) => {
    ;(req.session as unknown as Record<string, unknown>)['value'] = 'kept'
    res.end()
  })
  app.get('/read', (req, res) => {
    res.json((req.session as unknown as Record<string, unknown>)['value'])
  })

  const first = await request(app).get('/set').expect(200)
  const cookie = first.headers['set-cookie']!
  expect(data.size).toBe(1)
  const [key] = [...data.keys()]
  expect(key).toMatch(/^sess-test:/)
  expect(ttls.get(key!)).toBe(600)

  const second = await request(app).get('/read').set('Cookie', cookie)
  expect(second.body).toBe('kept')
  expect(data.size).toBe(1)
})
