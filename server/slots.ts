/**
 * At most `size` jobs run at once; the rest wait in order. A slot passes straight to the
 * next waiter, so the count can never exceed `size`, even for a caller arriving in between.
 * Used for diagram analysis: OCR is CPU-bound, and seven at once on one vCPU turned a
 * 6 s OCR into 45 s (and could exhaust memory).
 */
export function createSlots(size: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return {
    async run<T>(job: () => Promise<T>): Promise<T> {
      if (active >= size) await new Promise<void>((resume) => waiting.push(resume));
      else active++;
      try {
        return await job();
      } finally {
        const next = waiting.shift();
        if (next) next();
        else active--;
      }
    },
    get active() {
      return active;
    },
    get waiting() {
      return waiting.length;
    },
  };
}
