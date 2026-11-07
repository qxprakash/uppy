import type { SessionData } from 'express-session'
import session from 'express-session'
import type { Redis } from 'ioredis'

type Callback = (err?: unknown) => void

const noop: Callback = () => {}

// Used when a session cookie has no expiry date.
const DEFAULT_TTL_SECONDS = 86400

/**
 * An express-session store that keeps each session as a JSON string under
 * `${prefix}${sid}`, with a Redis expiry that follows the session cookie.
 * The keys and values are the same as the ones connect-redis 7 writes, so
 * existing sessions keep working.
 */
export default class RedisSessionStore extends session.Store {
  client: Redis
  prefix: string

  constructor({ client, prefix }: { client: Redis; prefix: string }) {
    super()
    this.client = client
    this.prefix = prefix
  }

  async get(
    sid: string,
    cb: (err?: unknown, sess?: SessionData | null) => void,
  ): Promise<void> {
    try {
      const data = await this.client.get(this.prefix + sid)
      if (!data) return cb()
      return cb(null, JSON.parse(data))
    } catch (err) {
      return cb(err)
    }
  }

  async set(
    sid: string,
    sess: SessionData,
    cb: Callback = noop,
  ): Promise<void> {
    const ttl = getTTL(sess)
    try {
      const value = JSON.stringify(sess)
      if (ttl > 0) {
        await this.client.set(this.prefix + sid, value, 'EX', ttl)
        return cb()
      }
      return this.destroy(sid, cb)
    } catch (err) {
      return cb(err)
    }
  }

  override async touch(
    sid: string,
    sess: SessionData,
    cb: Callback = noop,
  ): Promise<void> {
    try {
      await this.client.expire(this.prefix + sid, getTTL(sess))
      return cb()
    } catch (err) {
      return cb(err)
    }
  }

  async destroy(sid: string, cb: Callback = noop): Promise<void> {
    try {
      await this.client.del(this.prefix + sid)
      return cb()
    } catch (err) {
      return cb(err)
    }
  }
}

// Seconds until the cookie expires, rounded up.
function getTTL(sess: SessionData): number {
  if (sess?.cookie?.expires) {
    const ms = Number(new Date(sess.cookie.expires)) - Date.now()
    return Math.ceil(ms / 1000)
  }
  return DEFAULT_TTL_SECONDS
}
