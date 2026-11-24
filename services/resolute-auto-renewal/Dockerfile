# RESOLUTE automatic renewal: one run of services/resolute-api/payments/renewal-worker.mjs, scheduled (hourly) by a Railway
# cron service (schedule and variables: PR "RESOLUTE auto-renewal copy and schedule"). Same code and modules as the resolute-api image.
# Inert without RESOLUTE_AUTO_RENEWAL_ENABLED=true: it prints {"enabled":false} and exits 0.
FROM node:24.22.1-bookworm-slim
WORKDIR /app
COPY services/resolute-api/package.json services/resolute-api/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY services/resolute-api/*.mjs ./services/resolute-api/
COPY services/resolute-api/payments/ ./services/resolute-api/payments/
COPY lib/resolute/*.ts lib/resolute/thermometer-rosters.json ./lib/resolute/
COPY lib/membership/entitlements.ts ./lib/membership/entitlements.ts
COPY lib/legal/ ./lib/legal/
COPY lib/research/ ./lib/research/
COPY scripts/research/mu_fq4_recovery.json scripts/research/sources.json ./scripts/research/
USER node
ENV NODE_ENV=production
# Load the worker's complete dependency graph at build time, without credentials (the flag is unset here, so it does nothing).
RUN node services/resolute-api/payments/renewal-worker.mjs
CMD ["timeout", "--signal=TERM", "--kill-after=10s", "900s", "node", "services/resolute-api/payments/renewal-worker.mjs"]
