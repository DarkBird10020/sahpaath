/**
 * Calls `run` every `intervalMs`, but politely: one request at a time, quiet
 * while the tab is hidden, and slower after each failure (up to 30 s) so a
 * signed-out or offline page cannot hammer the server. `run` must reject when
 * it fails. Returns a function that stops polling.
 */
export function poll(run: () => Promise<unknown>, intervalMs: number, maxMs = 30_000): () => void {
  let stopped = false;
  let failures = 0;
  let authFailures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (ms: number) => {
    if (!stopped) timer = setTimeout(() => void tick(), ms);
  };
  const tick = async () => {
    if (stopped) return;
    if (document.hidden) return schedule(intervalMs);
    try {
      await run();
      failures = 0;
      authFailures = 0;
    } catch (error) {
      failures++;
      const status = (error as { status?: number }).status;
      authFailures = status === 401 || status === 403 ? authFailures + 1 : 0;
      // Signed out or not allowed: asking again cannot help, so stop after three tries.
      if (authFailures >= 3) return stop();
    }
    schedule(Math.min(intervalMs * 2 ** failures, maxMs));
  };
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
  const onVisible = () => {
    if (stopped || document.hidden) return;
    clearTimeout(timer);
    void tick();
  };
  document.addEventListener("visibilitychange", onVisible);
  schedule(intervalMs);
  return stop;
}
