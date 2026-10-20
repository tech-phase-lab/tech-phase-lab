import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildDecision } from '../scripts/tech-phase/ignore-vercel-build.mjs';
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'vercel-policy-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Policy test');
  const write = (path, data) => { mkdirSync(join(cwd, path, '..'), { recursive: true }); writeFileSync(join(cwd, path), data); };
  const commit = () => { git('add', '.'); git('commit', '-qm', 'test'); return git('rev-parse', 'HEAD'); };
  write('app/page.tsx', 'original'); const base = commit();
  const env = head => ({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/research-preview', VERCEL_GIT_PREVIOUS_SHA: base, VERCEL_GIT_COMMIT_SHA: head });
  return { cwd, write, commit, env, base };
}
test('documentation-only skips; other environments and force override build', t => {
  const f = fixture(t); f.write('docs/log.md', 'record'); const env = f.env(f.commit());
  assert.equal(buildDecision(env, f.cwd), 0);
  for (const override of [{ VERCEL_ENV: 'production' }, { VERCEL_GIT_COMMIT_REF: 'main' }, { TECH_PHASE_FORCE_BUILD: '1' }]) assert.equal(buildDecision({ ...env, ...override }, f.cwd), 1);
});
test('code before latest docs commit is not missed', t => {
  const f = fixture(t); f.write('app/page.tsx', 'changed'); f.commit(); f.write('docs/log.md', 'record');
  assert.equal(buildDecision(f.env(f.commit()), f.cwd), 1);
});
test('code renamed into docs still builds', t => {
  const f = fixture(t); mkdirSync(join(f.cwd, 'docs')); renameSync(join(f.cwd, 'app/page.tsx'), join(f.cwd, 'docs/page.md'));
  assert.equal(buildDecision(f.env(f.commit()), f.cwd), 1);
});
test('missing history, invalid SHA and mismatched checkout build', t => {
  const f = fixture(t); f.write('docs/log.md', 'record'); const env = f.env(f.commit());
  for (const override of [{ VERCEL_GIT_PREVIOUS_SHA: '' }, { VERCEL_GIT_PREVIOUS_SHA: 'f'.repeat(40) }, { VERCEL_GIT_COMMIT_SHA: '--help' }, { VERCEL_GIT_COMMIT_SHA: f.base }]) assert.equal(buildDecision({ ...env, ...override }, f.cwd), 1);
});
test('same-commit redeploy is allowed', t => { const f = fixture(t); assert.equal(buildDecision(f.env(f.base), f.cwd), 1); });
test('data inside docs still builds', t => { const f = fixture(t); f.write('docs/data.json', '{}'); assert.equal(buildDecision(f.env(f.commit()), f.cwd), 1); });
