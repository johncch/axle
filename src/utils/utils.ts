export function arrayify<T>(arr: T | T[]): T[] {
  return Array.isArray(arr) ? arr : [arr];
}

export function stringify(obj: any): string {
  return typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}

export function friendly(id: string, name?: string): string {
  if (name) {
    return `${name}:${id.slice(0, 8)}`;
  }
  return id.slice(0, 8);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Await a promise for sequencing without propagating its result or rejection */
export function settleWhen(promise: Promise<unknown>): Promise<void> {
  return promise.then(
    () => {},
    () => {},
  );
}
