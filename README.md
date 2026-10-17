# Tech Phase Research

Bilingual Japanese-English research preview for U.S. technology stocks. The site brings together official-source research, company pages, stock lookup, a schedule calendar, and a local favorites list.

## Current stage

Development and previews run from `codex/research-preview`. The preview contains historical, source-linked research and manually maintained official schedules. Automatic member delivery, billing, push notifications, and real-time licensed news distribution are not enabled. Market cards use the separately labeled TradingView data source.

## Local development

Requirements: Node.js 22+, Python 3.12+, and the PDF parser listed in `scripts/research/requirements.txt`.

```bash
npm ci
python -m pip install -r scripts/research/requirements.txt
npm run dev
```

## Quality checks

The preview branch runs these gates on every push and pull request targeting `codex/research-preview`:

```bash
npm run lint
npm test
npm run test:python
npm run build
```

No deployment secrets are needed for these checks. The workflow has read-only repository permissions and does not deploy or publish to production.

## Research monitor and environment variables

See [`scripts/research/README.md`](scripts/research/README.md) and [`.env.example`](.env.example) for the monitor architecture, fail-closed review APIs, and disabled-by-default options. Copy example values only for local setup; never use the example placeholders as production secrets. Keep `.env.local` and credentials out of Git.

A readiness sequence for choosing and connecting a branded domain is in [`docs/LAUNCH-READINESS.md`](docs/LAUNCH-READINESS.md). Domain purchase, production aliases, paid access, licensed feeds, and external delivery require their own explicit launch decisions.
