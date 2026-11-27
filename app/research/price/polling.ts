/** Runs `task` now and then every `every` ms, but only while the tab is visible: a hidden tab asks for nothing, and asks again the moment it is shown. */
export function startPolling(task: () => Promise<void>, every: number, firstAfter = 0): () => void {
  let stopped = false, idle = false, timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    idle = false;
    await task();
    if (stopped) return;
    if (document.visibilityState === "hidden") { idle = true; return; }
    timer = setTimeout(run, every);
  };
  const shown = () => { if (!stopped && idle && document.visibilityState === "visible") void run(); };
  document.addEventListener("visibilitychange", shown);
  if (document.visibilityState === "hidden") idle = true; else if (firstAfter > 0) timer = setTimeout(run, firstAfter); else void run();
  return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", shown); };
}
