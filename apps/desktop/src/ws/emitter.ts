// Minimal type-safe event emitter. Keys and payloads come from a caller-supplied event map, so
// `on`/`emit` are checked against the exact wire types with no `any`.

export type Listener<T> = (payload: T) => void;

export class TypedEmitter<M> {
  private readonly listeners = new Map<keyof M, Set<Listener<unknown>>>();

  /** Subscribe. Returns an unsubscribe fn. */
  on<K extends keyof M>(key: K, cb: Listener<M[K]>): () => void {
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(cb as Listener<unknown>);
    return () => this.off(key, cb);
  }

  /** Subscribe for exactly one emission. */
  once<K extends keyof M>(key: K, cb: Listener<M[K]>): () => void {
    const off = this.on(key, (payload) => {
      off();
      cb(payload);
    });
    return off;
  }

  off<K extends keyof M>(key: K, cb: Listener<M[K]>): void {
    this.listeners.get(key)?.delete(cb as Listener<unknown>);
  }

  emit<K extends keyof M>(key: K, payload: M[K]): void {
    const set = this.listeners.get(key);
    if (!set) return;
    // Snapshot so a listener that unsubscribes mid-dispatch doesn't perturb iteration.
    for (const cb of [...set]) {
      (cb as Listener<M[K]>)(payload);
    }
  }
}
