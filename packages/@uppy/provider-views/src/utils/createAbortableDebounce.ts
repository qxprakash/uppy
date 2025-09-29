type AbortableDebounceHandler<T> = (
  value: T,
  signal: AbortSignal,
) => void | Promise<void>

export interface AbortableDebounce<T> {
  schedule(value: T): void
  flush(value?: T): Promise<void>
  cancel(): void
  destroy(): void
  getPending(): T | undefined
}

interface AbortableDebounceOptions<T> {
  delay: number
  handler: AbortableDebounceHandler<T>
}

export function createAbortableDebounce<T>(
  options: AbortableDebounceOptions<T>,
): AbortableDebounce<T> {
  const { delay, handler } = options

  let timer: number | null = null
  let controller: AbortController | null = null
  let pendingValue: T | undefined

  const abortActive = () => {
    if (controller) {
      controller.abort()
      controller = null
    }
  }

  const clearTimer = () => {
    if (timer != null) {
      window.clearTimeout(timer)
      timer = null
    }
  }

  const runHandler = async (value: T) => {
    abortActive()
    controller = new AbortController()
    try {
      await handler(value, controller.signal)
    } finally {
      controller = null
    }
  }

  return {
    schedule(value: T) {
      pendingValue = value
      clearTimer()
      timer = window.setTimeout(() => {
        timer = null
        const current = pendingValue
        pendingValue = undefined
        if (current !== undefined) {
          void runHandler(current)
        }
      }, delay)
    },
    async flush(value?: T) {
      if (value !== undefined) {
        pendingValue = value
      }
      const current = pendingValue
      pendingValue = undefined
      clearTimer()
      if (current === undefined) return
      await runHandler(current)
    },
    cancel() {
      pendingValue = undefined
      clearTimer()
      abortActive()
    },
    destroy() {
      pendingValue = undefined
      clearTimer()
      abortActive()
    },
    getPending() {
      return pendingValue
    },
  }
}
