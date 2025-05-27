// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore We don't want TS to generate types for the package.json
import packageJson from '../package.json'

export type GenericState = Record<string, unknown>

export type Listener<T> = (
  prevState: T,
  nextState: T,
  patch?: Partial<T>,
) => void

export interface Store<T extends GenericState> {
  getState: () => T

  setState(patch?: Partial<T>): void

  subscribe(listener: Listener<T>): () => void
}

/**
 * Default store that keeps state in a simple object.
 */
class DefaultStore<T extends GenericState = GenericState> implements Store<T> {
  static VERSION = packageJson.version

  public state: T = {} as T

  #callbacks = new Set<Listener<T>>()

  getState(): T {
    return this.state
  }

  setState(patch?: Partial<T>): void {
    console.log('setState called ------>')

    console.log('patch --->', patch)

    const prevState = { ...this.state }
    const nextState = { ...this.state, ...patch }

    console.log('prevState --->', prevState)
    console.log('nextState --->', nextState)

    this.state = nextState
    this.#publish(prevState, nextState, patch)
  }

  subscribe(listener: Listener<T>): () => void {
    this.#callbacks.add(listener)
    return () => {
      this.#callbacks.delete(listener)
    }
  }

  #publish(...args: Parameters<Listener<T>>): void {
    // debugger
    console.log('publish called ------>')
    console.log('args --->', args)
    // console.log("this.#callbacks --->", this.#callbacks)
    this.#callbacks.forEach((listener) => {
      console.log('listener --->', listener)
      console.log('listener(...args) --->', listener(...args))
      listener(...args)
    })
  }
}

export default DefaultStore
