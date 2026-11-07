import debounce, { type DebouncedFunction } from './debounce.js'

/**
 * Call `fn` at most once every `wait` ms. Same as lodash's `throttle`.
 */
export default function throttle<F extends (...args: any[]) => unknown>(
  fn: F,
  wait: number,
  { leading = true, trailing = true } = {},
): DebouncedFunction<F> {
  return debounce(fn, wait, { leading, trailing, maxWait: wait })
}
