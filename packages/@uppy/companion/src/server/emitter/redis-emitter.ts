import { EventEmitter } from 'node:events'
import type { Redis } from 'ioredis'
import * as logger from '../logger.js'
import type { EmitterLike } from './index.js'

/**
 * JSON.stringify that leaves out keys starting with `_`, the string
 * '[Circular]', and properties that point back to an object they are nested
 * in. Those are found depth first, and a property found once is left out
 * wherever its object appears again. Other repeated objects are serialized in
 * full each time.
 */
export function stringifyArgs(args: unknown[]): string {
  const circular = new Map<object, Set<string>>()
  const path: object[] = []
  const visit = (value: object) => {
    path.push(value)
    for (const [key, child] of Object.entries(value)) {
      if (typeof child !== 'object' || child === null) continue
      if (circular.get(value)?.has(key)) continue
      if (path.includes(child)) {
        const keys = circular.get(value) ?? new Set()
        circular.set(value, keys.add(key))
      } else {
        visit(child)
      }
    }
    path.pop()
  }
  visit(args)

  return JSON.stringify(
    args,
    function replacer(this: object, key: string, value: unknown) {
      if (key[0] === '_' || value === '[Circular]') return undefined
      return circular.get(this)?.has(key) ? undefined : value
    },
  )
}

/**
 * Backslash-escape the glob characters of a Redis PSUBSCRIBE pattern so an
 * event name can only ever match itself.
 */
export function escapeGlob(name: string): string {
  return name.replace(/[\\*?[\]]/g, '\\$&')
}

/**
 * This module simulates the builtin events.EventEmitter but with the use of redis.
 * This is useful for when companion is running on multiple instances and events need
 * to be distributed across.
 *
 * @param redisClient
 * @param redisPubSubScope
 */
export default function redisEmitter(
  redisClient: Redis,
  redisPubSubScope?: string,
): EmitterLike {
  const prefix = redisPubSubScope ? `${redisPubSubScope}:` : ''
  // literal channel, used for publishing
  const getChannelName = (eventName: string) => `${prefix}${eventName}`
  // escaped pattern, used for (p)subscribing and matching
  const getPatternName = (eventName: string) =>
    `${prefix}${escapeGlob(eventName)}`

  const errorEmitter = new EventEmitter()
  const handleError = (err: unknown) => errorEmitter.emit('error', err)

  async function makeRedis() {
    const publisher = redisClient.duplicate({ lazyConnect: true })
    publisher.on('error', (err) =>
      logger.error('publisher redis error', err.toString()),
    )
    const subscriber = publisher.duplicate()
    subscriber.on('error', (err) =>
      logger.error('subscriber redis error', err.toString()),
    )
    await publisher.connect()
    await subscriber.connect()
    return { subscriber, publisher }
  }

  const redisPromise = makeRedis()
  redisPromise.catch((err) => handleError(err))

  /**
   *
   * @param fn
   */
  async function runWhenConnected(
    fn: (clients: { subscriber: Redis; publisher: Redis }) => unknown,
  ): Promise<void> {
    try {
      await fn(await redisPromise)
    } catch (err) {
      handleError(err)
    }
  }

  // because each event can have multiple listeners, we need to keep track of them
  const handlersByEventName: Map<
    string,
    Map<
      (...args: unknown[]) => unknown,
      (pattern: string, _channel: string, message: string) => unknown
    >
  > = new Map()

  /**
   * Remove an event listener
   *
   * @param eventName name of the event
   * @param handler the handler of the event to remove
   */
  type Handler = (...args: unknown[]) => unknown

  async function removeListener(eventName: string, handler: Handler) {
    if (eventName === 'error') {
      errorEmitter.removeListener('error', handler)
      return
    }

    const actualHandlerByHandler = handlersByEventName.get(eventName)
    if (actualHandlerByHandler == null) return

    const actualHandler = actualHandlerByHandler.get(handler)
    if (actualHandler == null) return

    actualHandlerByHandler.delete(handler)

    const didRemoveLastListener = actualHandlerByHandler.size === 0
    if (didRemoveLastListener) {
      handlersByEventName.delete(eventName)
    }

    await runWhenConnected(async ({ subscriber }) => {
      subscriber.off('pmessage', actualHandler)
      if (didRemoveLastListener) {
        await subscriber.punsubscribe(getPatternName(eventName))
      }
    })
  }

  /**
   *
   * @param eventName
   * @param handler
   * @param _once
   */
  async function addListener(
    eventName: string,
    handler: Handler,
    _once = false,
  ) {
    if (eventName === 'error') {
      if (_once) errorEmitter.once('error', handler)
      else errorEmitter.addListener('error', handler)
      return
    }

    function actualHandler(pattern: string, _channel: string, message: string) {
      if (pattern !== getPatternName(eventName)) {
        return
      }

      if (_once) removeListener(eventName, handler)
      let args: unknown[]
      try {
        const parsed: unknown = JSON.parse(message)
        if (!Array.isArray(parsed)) {
          throw new Error('Expected JSON array')
        }
        args = parsed
      } catch (_ex) {
        handleError(
          new Error(
            `Invalid JSON received! Channel: ${eventName} Message: ${message}`,
          ),
        )
        return
      }

      handler(...args)
    }

    let actualHandlerByHandler = handlersByEventName.get(eventName)
    if (actualHandlerByHandler == null) {
      actualHandlerByHandler = new Map()
      handlersByEventName.set(eventName, actualHandlerByHandler)
    }
    actualHandlerByHandler.set(handler, actualHandler)

    await runWhenConnected(async ({ subscriber }) => {
      subscriber.on('pmessage', actualHandler)
      await subscriber.psubscribe(getPatternName(eventName))
    })
  }

  /**
   * Add an event listener
   *
   * @param eventName name of the event
   * @param handler the handler of the event
   */
  async function on(eventName: string, handler: Handler) {
    await addListener(eventName, handler)
  }

  /**
   * Remove an event listener
   *
   * @param eventName name of the event
   * @param handler the handler of the event
   */
  async function off(eventName: string, handler: Handler) {
    await removeListener(eventName, handler)
  }

  /**
   * Add an event listener (will be triggered at most once)
   *
   * @param eventName name of the event
   * @param handler the handler of the event
   */
  async function once(eventName: string, handler: Handler) {
    await addListener(eventName, handler, true)
  }

  /**
   * Announce the occurrence of an event
   *
   * @param eventName name of the event
   */
  async function emit(eventName: string, ...args: unknown[]) {
    let message: string
    try {
      message = stringifyArgs(args)
    } catch (err) {
      // e.g. a BigInt, or a toJSON that throws: nothing to publish
      logger.error(err, 'emitter.serialize.error')
      return
    }
    await runWhenConnected(async ({ publisher }) =>
      publisher.publish(getChannelName(eventName), message),
    )
  }

  /**
   * Remove all listeners of an event
   *
   * @param eventName name of the event
   */
  async function removeAllListeners(eventName: string) {
    if (eventName === 'error') {
      errorEmitter.removeAllListeners(eventName)
      return
    }

    const actualHandlerByHandler = handlersByEventName.get(eventName)
    if (actualHandlerByHandler != null) {
      for (const handler of actualHandlerByHandler.keys()) {
        await removeListener(eventName, handler)
      }
    }
  }

  return {
    on,
    off,
    once,
    emit,
    removeListener,
    removeAllListeners,
  }
}
