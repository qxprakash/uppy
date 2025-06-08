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

type Args<T> = Parameters<Listener<T>>;
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
    const prevState = { ...this.state }
    const nextState = { ...this.state, ...patch }

    this.state = nextState
    this.#publish(prevState, nextState, patch)
  }

  subscribe(listener: Listener<T>): () => void {
    // listener the param is a function here who's type is Listener<T>
    // it in a function that takes three arguments: prevState, nextState, and patch
    // to subscribe that listener we add it to the callbacks set
    // and return a function that removes the listener from the set
    this.#callbacks.add(listener)
    return () => {
      this.#callbacks.delete(listener)
    }
  }

  #publish(...args: Args<T>): void {
    this.#callbacks.forEach((listener) => {
      listener(...args)
    })
  }
}

export default DefaultStore
