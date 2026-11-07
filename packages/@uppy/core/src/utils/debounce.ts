export type DebounceOptions = {
  leading?: boolean
  trailing?: boolean
  maxWait?: number
}

export type DebouncedFunction<F extends (...args: any[]) => unknown> = {
  (this: ThisParameterType<F>, ...args: Parameters<F>): void
  cancel(): void
}

/**
 * Delay calls to `fn` until `wait` ms have passed since the last call.
 * The trailing call gets the latest arguments and `this`.
 *
 * Same timing rules as lodash's `debounce` (without `flush` and return values).
 */
export default function debounce<F extends (...args: any[]) => unknown>(
  fn: F,
  wait: number,
  { leading = false, trailing = true, maxWait }: DebounceOptions = {},
): DebouncedFunction<F> {
  // Like lodash: a missing or invalid `wait` means 0.
  wait = Number(wait) || 0
  const maxing = maxWait !== undefined
  const maxDelay = Math.max(Number(maxWait) || 0, wait)
  let lastArgs: Parameters<F> | undefined
  let lastThis: ThisParameterType<F> | undefined
  let lastCallTime: number | undefined
  let lastInvokeTime = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  function invoke(time: number) {
    const args = lastArgs!
    const thisArg = lastThis
    lastArgs = undefined
    lastThis = undefined
    lastInvokeTime = time
    fn.apply(thisArg, args)
  }

  function shouldInvoke(time: number) {
    if (lastCallTime === undefined) return true
    const sinceLastCall = time - lastCallTime
    return (
      sinceLastCall >= wait ||
      sinceLastCall < 0 ||
      (maxing && time - lastInvokeTime >= maxDelay)
    )
  }

  function timerExpired() {
    const time = Date.now()
    if (shouldInvoke(time)) {
      timer = undefined
      if (trailing && lastArgs) {
        invoke(time)
      } else {
        lastArgs = undefined
        lastThis = undefined
      }
      return
    }
    const remaining = wait - (time - lastCallTime!)
    timer = setTimeout(
      timerExpired,
      maxing
        ? Math.min(remaining, maxDelay - (time - lastInvokeTime))
        : remaining,
    )
  }

  function debounced(this: ThisParameterType<F>, ...args: Parameters<F>) {
    const time = Date.now()
    const isInvoking = shouldInvoke(time)
    lastArgs = args
    lastThis = this
    lastCallTime = time

    if (isInvoking) {
      if (timer === undefined) {
        lastInvokeTime = time
        timer = setTimeout(timerExpired, wait)
        if (leading) invoke(time)
        return
      }
      if (maxing) {
        clearTimeout(timer)
        timer = setTimeout(timerExpired, wait)
        invoke(time)
        return
      }
    }
    if (timer === undefined) timer = setTimeout(timerExpired, wait)
  }

  debounced.cancel = () => {
    clearTimeout(timer)
    lastInvokeTime = 0
    lastArgs = undefined
    lastThis = undefined
    lastCallTime = undefined
    timer = undefined
  }

  return debounced
}
