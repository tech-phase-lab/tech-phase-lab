# Owner assignment — 2026-10-25 (latest explicit instruction)

- ALL news work belongs to Claude. Codex must not modify news collection, feeds,
  translation, summaries, display, caches, FREE/PRO restrictions, or news-specific tests.
  The news access change a7b58b55 was reverted by 3eedd229 at the owner's request.
  Do not reapply it. General authorization to continue development is not authorization
  to work on news. Relationship maps and Theme Ranking also belong to Claude.
- Codex owns Tech Phase PRO billing and other explicitly assigned non-news work.
  Railway connection/reauthentication is prohibited. Do not repeat completed purchases.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# GitHub synchronization in ChatGPT Work

- Work only on the requested branch and inspect the worktree before syncing.
- `git fetch` and `git ls-remote` may work anonymously while `git push` fails with
  `could not read Username for 'https://github.com'`. This does **not** mean the
  connected GitHub app is disconnected, and reconnecting the browser session will
  not add credentials to the local Git CLI.
- When local `git push` lacks credentials, use the connected GitHub app's Git Data
  write operations. Re-read the remote branch head immediately before writing,
  create a commit with that head as its parent, and update the branch with
  `force: false`.
- Never ask the user to paste a password or token. Never force-push, merge to
  `main`, or overwrite unrelated work.
- If a local branch diverges because an equivalent change was committed through
  the GitHub app, first require a clean worktree, preserve the local tip on a
  backup branch, fetch the remote branch, compare both diffs, and align only when
  every local change is already represented remotely.

# Preview branch checks before remote updates

- For changes to application code, monitor code, dependencies, tests, or CI on
  `codex/research-preview`, run the same gates as `.github/workflows/research-preview-checks.yml`
  against the final integrated tree before updating the remote branch:
  `npm run lint`, `npm test`, `npm run test:python`, and `npm run build`.
- Run `python3 -m compileall -q scripts/research tests` as a quick source-integrity
  check; it catches malformed Python files such as embedded NUL bytes before a
  GitHub Actions run fails. Also run `git diff --check`.
- When another change lands on the remote branch, integrate it and repeat the
  applicable checks on the combined tree. Do not update the branch when a gate
  fails. For documentation-only changes, `git diff --check` is sufficient.

# Prevent partial-file publication

A September 27 connector update truncated existing research files. Before any Git Data ref update, stage the final checked local files and compare `git write-tree` with the SHA returned by `create_tree` using the current remote base. They must match exactly. Never publish clipped tool output as file content. Read large files in bounded chunks and reassemble without omissions. A mismatched tree must be corrected before moving the branch ref. Preserve the existing integrity tests; passing deployment status is not a substitute for a successful GitHub Actions run.

# Python test clock

- `npm run test:python` runs `scripts/run_python_tests.py`, which pins the clock to
  `RESEARCH_TEST_NOW` (default in that file) so dated fixtures do not expire as the
  calendar moves on. Run the suite through it, not bare `unittest discover`.
- The pinned clock lives in `scripts/test_clock/research_test_clock.py`. `npm test` puts
  `scripts/test_clock` on `PYTHONPATH`, so Python fixtures spawned from `.mjs` tests load the
  same clock through `sitecustomize.py`. Run the Node suite through `npm test`, not bare
  `node --test`.

# Product plans (owner decisions)

- Home news: once the Stock News API contract is in place, switch the home screen news
  (top LIVE band and the lower news list) to the Stock News API. The home screen is redesigned
  in mid-November; until then the current sources stay as they are.

- The authoritative FREE / PRO policy is `docs/TECH-PHASE-FREE-PRO-POLICY-2026-10-25.md`.
  Read it before changing entitlements, PRO benefit copy or related navigation.
  It supersedes earlier 15-minute/summary proposals: FREE high-tech alerts are
  30-minute-delayed, newest-first latest five headlines only. Capital Map is FREE;
  relationship maps are PRO except the NVDA free sample. The official feature name
  is テーマランキング / Theme Ranking; Claude owns both relationship maps and Theme Ranking. Do not duplicate or edit those implementations.
