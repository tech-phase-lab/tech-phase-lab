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
