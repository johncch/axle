export class Channel<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private waiting: ((result: IteratorResult<T>) => void) | null = null;
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value, done: false });
    } else {
      this.queue.push(value);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: undefined as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as T, done: true });
        }
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
      return: (): Promise<IteratorResult<T>> => {
        this.closed = true;
        this.queue.length = 0;
        if (this.waiting) {
          const resolve = this.waiting;
          this.waiting = null;
          resolve({ value: undefined as T, done: true });
        }
        return Promise.resolve({ value: undefined as T, done: true });
      },
    };
  }
}
