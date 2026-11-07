import delay from './delay.js'

/**
 * Throw this from the retried function to stop retrying. `retry()` then
 * rejects with the wrapped error.
 */
export class AbortError extends Error {
  originalError: Error

  constructor(error: Error | string) {
    const originalError = typeof error === 'string' ? new Error(error) : error
    super(originalError.message)
    this.name = 'AbortError'
    this.originalError = originalError
  }
}

export type FailedAttempt = {
  error: Error
  attemptNumber: number
  retriesLeft: number
}

export type RetryOptions = {
  retries: number
  signal?: AbortSignal
  onFailedAttempt?: (attempt: FailedAttempt) => unknown
}

const networkErrorMessages = new Set([
  'network error', // Chrome
  'NetworkError when attempting to fetch resource.', // Firefox
  'The Internet connection appears to be offline.', // Safari 16
  'Network request failed', // `cross-fetch`
  'fetch failed', // Undici (Node.js)
  'terminated', // Undici (Node.js)
  ' A network error occurred.', // Bun (WebKit)
  'Network connection lost', // Cloudflare Workers (fetch)
])

// The `TypeError`s that `fetch()` rejects with when the request fails.
function isFetchNetworkError(error: TypeError): boolean {
  if (error.name !== 'TypeError' || typeof error.message !== 'string') {
    return false
  }
  const { message } = error
  // Safari 17+ has a generic message but no stack for network errors
  if (
    message === 'Load failed' ||
    (message.startsWith('Load failed (') && message.endsWith(')'))
  ) {
    return error.stack === undefined || '__sentry_captured__' in error
  }
  return (
    message.startsWith('error sending request for url') ||
    message === 'Failed to fetch' ||
    (message.startsWith('Failed to fetch (') && message.endsWith(')')) ||
    networkErrorMessages.has(message)
  )
}

/**
 * Call `fn` until it resolves, at most `retries + 1` times, waiting
 * 1s, 2s, 4s, ... between attempts.
 *
 * Gives up right away on an `AbortError` (rejecting with the error it wraps),
 * on a `TypeError` that is not a network error, and when `signal` aborts
 * (rejecting with `signal.reason`). Same rules as `p-retry` 8 with its
 * default timing options.
 */
export default async function retry<T>(
  fn: (attemptNumber: number) => T | PromiseLike<T>,
  { retries, signal, onFailedAttempt }: RetryOptions,
): Promise<T> {
  if (!(retries >= 0)) {
    throw new TypeError(`Expected \`retries\` to be a number, got ${retries}`)
  }
  signal?.throwIfAborted()

  for (let attemptNumber = 1; ; attemptNumber++) {
    try {
      signal?.throwIfAborted()
      const result = await fn(attemptNumber)
      signal?.throwIfAborted()
      return result
    } catch (err) {
      const error =
        err instanceof Error
          ? err
          : new TypeError(
              `Non-error was thrown: "${err}". You should only throw errors.`,
            )
      if (error instanceof AbortError) throw error.originalError

      const retriesLeft = Math.max(0, retries - (attemptNumber - 1))
      await onFailedAttempt?.({ error, attemptNumber, retriesLeft })

      if (retriesLeft <= 0) throw error
      if (error instanceof TypeError && !isFetchNetworkError(error)) throw error

      signal?.throwIfAborted()
      await delay(1000 * 2 ** (attemptNumber - 1), signal && { signal })
      signal?.throwIfAborted()
    }
  }
}
