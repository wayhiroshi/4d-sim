/** Bounded session memory only; no browser storage or API persistence. */
export class StrategyCache<T> {
  private items = new Map<string, { value: T; size: number }>();
  private size = 0;
  constructor(private maxEntries = 8, private maxBytes = 24_000_000) {}
  get(key: string): T | undefined {
    const entry = this.items.get(key); if (!entry) return undefined;
    this.items.delete(key); this.items.set(key, entry); return entry.value;
  }
  set(key: string, value: T) {
    const old = this.items.get(key); if (old) { this.size -= old.size; this.items.delete(key); }
    const size = (key.length + JSON.stringify(value).length) * 2;
    if (size > this.maxBytes) return;
    while (this.items.size >= this.maxEntries || this.size + size > this.maxBytes) {
      const first = this.items.keys().next().value; if (first === undefined) break;
      this.size -= this.items.get(first)!.size; this.items.delete(first);
    }
    this.items.set(key, { value, size }); this.size += size;
  }
}
