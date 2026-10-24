import { spawn } from 'node:child_process';

/** Internal fixed-command adapter, never pass request fields as executable/args.
 * Explicit env only: owner tokens/production credentials are not inherited.
 * Linux process-group termination also stops descendants holding output pipes.
 */
export function runIsolatedProcess({ executable, args = [], cwd, env = {}, signal,
  timeoutMs = 40_000, maxOutputBytes = 65_536, killGraceMs = 250 }) {
  return new Promise((resolve, reject) => {
    const fail = () => new Error('RECOVERY_PROCESS_UNAVAILABLE');
    if (process.platform !== 'linux' || !signal || signal.aborted ||
      typeof executable !== 'string' || !executable.startsWith('/') ||
      !Array.isArray(args) || args.some(x => typeof x !== 'string') ||
      typeof cwd !== 'string' || !cwd.startsWith('/') ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 50_000 ||
      !Number.isInteger(killGraceMs) || killGraceMs < 1 || killGraceMs > 1_000 ||
      !Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 1_048_576 ||
      Object.entries(env).some(([name, value]) => typeof value !== 'string' ||
        /^(?:PG|DATABASE_|NODE_OPTIONS$|LD_|DYLD_)/.test(name) ||
        /(?:_DB_URL|DATABASE_URL)$/.test(name))) {
      reject(fail()); return;
    }
    let child, timer, escalation, stopped = false, closed = false, size = 0;
    const chunks = [];
    const kill = action => {
      if (!child?.pid) return;
      try { process.kill(-child.pid, action); }
      catch (error) { if (error.code !== 'ESRCH') stopped = true; }
    };
    const stop = () => {
      if (stopped || closed) return;
      stopped = true; chunks.length = 0;
      kill('SIGTERM');
      escalation = setTimeout(() => kill('SIGKILL'), killGraceMs);
    };
    try {
      child = spawn(executable, args, { cwd, env, detached: true,
        stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    } catch { reject(fail()); return; }
    const collect = (chunk, stdout) => {
      size += chunk.length;
      if (size > maxOutputBytes) stop();
      if (!stopped && stdout) chunks.push(chunk);
    };
    child.stdout.on('data', chunk => collect(chunk, true));
    // stderr counts toward the bound but is never returned or included in errors.
    child.stderr.on('data', chunk => collect(chunk, false));
    child.on('error', stop);
    child.on('close', (code, exitSignal) => {
      closed = true; clearTimeout(timer); clearTimeout(escalation);
      signal.removeEventListener('abort', stop);
      // A leader may exit before descendants. Never leave its process group alive.
      kill('SIGKILL');
      if (stopped || signal.aborted || code !== 0 || exitSignal) reject(fail());
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    signal.addEventListener('abort', stop, { once: true });
    timer = setTimeout(stop, timeoutMs);
    if (signal.aborted) stop();
  });
}
