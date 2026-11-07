export type ClassValue =
  | string
  | false
  | null
  | undefined
  | Record<string, unknown>

/**
 * Join class names, skipping falsy values. Object keys are included when
 * their value is truthy: `classNames('a', { b: true, c: false })` is `'a b'`.
 */
export default function classNames(...args: ClassValue[]): string {
  const classes: string[] = []
  for (const arg of args) {
    if (!arg) continue
    if (typeof arg === 'string') classes.push(arg)
    else {
      for (const [key, value] of Object.entries(arg))
        if (value) classes.push(key)
    }
  }
  return classes.join(' ')
}
