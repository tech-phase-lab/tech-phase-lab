import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIsolatedProcess } from '../services/resolute-recovery/process.mjs';
const options = (code, extra = {}) => ({ executable: process.execPath, args: ['-e', code],
  cwd: process.cwd(), signal: new AbortController().signal, ...extra });

test('fixed process receives only explicit environment and never returns stderr', async () => {
 const output = await runIsolatedProcess(options("process.stderr.write('private');process.stdout.write(JSON.stringify(process.env))", { env: { FIXTURE: 'synthetic' } }));
 assert.deepEqual(JSON.parse(output), { FIXTURE: 'synthetic' });
});
test('pre-aborted and inherited production connection or injection variables fail before launch', async () => {
 const controller = new AbortController(); controller.abort();
 await assert.rejects(runIsolatedProcess(options('process.exit(0)', { signal: controller.signal })), /RECOVERY_PROCESS_UNAVAILABLE/);
 for (const name of ['PGHOST', 'RESOLUTE_RIZEL_DB_URL', 'DATABASE_URL', 'DATABASE_HOST', 'NODE_OPTIONS', 'LD_PRELOAD'])
  await assert.rejects(runIsolatedProcess(options('process.exit(0)', { env: { [name]: 'secret' } })), /RECOVERY_PROCESS_UNAVAILABLE/);
});
test('spawn failures, nonzero exit and excessive stderr fail with redacted errors', async () => {
 for (const spec of [options('', { executable: '/missing/secret' }),
   options("process.stderr.write('secret');process.exit(2)"),
   options("process.stderr.write('secret'.repeat(10000));setInterval(()=>{},1000)", { maxOutputBytes: 100 })]) {
  await assert.rejects(runIsolatedProcess(spec), error => error.message === 'RECOVERY_PROCESS_UNAVAILABLE');
 }
});
test('timeout kills a TERM-resistant descendant and waits for pipes to close', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'recovery-process-'));
 t.after(() => rm(dir, { recursive: true, force: true }));
 const marker = join(dir, 'descendant');
 const descendant = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000)`;
 const code = `process.on('SIGTERM',()=>{});require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','inherit','inherit']});setInterval(()=>{},1000)`;
 const start = Date.now();
 await assert.rejects(runIsolatedProcess(options(code, { timeoutMs: 1500 })), /RECOVERY_PROCESS_UNAVAILABLE/);
 assert.ok(Date.now() - start < 5000);
 const pid = Number(await readFile(marker, 'utf8'));
 // A killed descendant can remain a zombie briefly under the container's init.
 try { const status = await readFile(`/proc/${pid}/stat`, 'utf8'); assert.match(status, /^\d+ \(.+\) Z /); }
 catch (error) { if (error.code !== 'ENOENT') throw error; }
});
test('caller abort cannot return success even when the child catches TERM and exits zero', async () => {
 const controller = new AbortController();
 const run = runIsolatedProcess(options("process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)", { signal: controller.signal }));
 const timer = setTimeout(() => controller.abort(), 500);
 try { await assert.rejects(run, /RECOVERY_PROCESS_UNAVAILABLE/); }
 finally { clearTimeout(timer); }
});
