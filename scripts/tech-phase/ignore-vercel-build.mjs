import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Ignored Build Step: 0 skips; 1 builds. Missing history must never skip.
export function buildDecision(env = process.env, cwd = process.cwd()) {
  if (env.VERCEL_ENV !== 'preview' || env.VERCEL_GIT_COMMIT_REF !== 'codex/research-preview' || env.TECH_PHASE_FORCE_BUILD === '1') return 1;
  const base = env.VERCEL_GIT_PREVIOUS_SHA, head = env.VERCEL_GIT_COMMIT_SHA;
  if (![base, head].every(value => /^[a-f0-9]{40}$/i.test(value ?? ''))) return 1;
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
  try {
    if (git(['rev-parse', 'HEAD']).trim() !== head) return 1;
    git(['merge-base', '--is-ancestor', base, head]);
    const paths = git(['diff', '--name-only', '--no-renames', '-z', base, head, '--']).split('\0').filter(Boolean);
    if (!paths.length) return 1;
    return paths.every(path => /^docs\/[^\0]+\.md$/.test(path) || path === 'README.md' || path === 'AGENTS.md') ? 0 : 1;
  } catch { return 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const decision = buildDecision();
  console.log(decision === 0 ? 'Skip: documentation-only preview change.' : 'Build: application change or comparison unavailable.');
  process.exitCode = decision;
}
