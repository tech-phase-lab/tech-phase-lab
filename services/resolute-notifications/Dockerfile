FROM node:24.22.1-bookworm-slim
WORKDIR /app
# Same dependency set as resolute-api (pg, @clerk/backend, S3 client for the protection gateway import).
COPY services/resolute-api/package.json services/resolute-api/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY services/resolute-api/*.mjs ./services/resolute-api/
COPY services/resolute-api/payments/ ./services/resolute-api/payments/
COPY services/resolute-notifications/run.mjs ./services/resolute-notifications/run.mjs
COPY lib/resolute/*.ts ./lib/resolute/
COPY lib/membership/entitlements.ts ./lib/membership/entitlements.ts
COPY lib/research/ ./lib/research/
COPY scripts/research/mu_fq4_recovery.json scripts/research/sources.json ./scripts/research/
USER node
ENV NODE_ENV=production
# Cron service for closing-price alerts and the morning note. Created DISABLED: with no flags set both steps print
# {"enabled":false} and do nothing. Schedule (UTC 0 0,1,22,23 * * *) and flags are set only with the owner's approval.
RUN node --experimental-strip-types services/resolute-api/notification-queue.mjs; node --experimental-strip-types services/resolute-api/mail-worker.mjs; true
CMD ["timeout", "--signal=TERM", "--kill-after=10s", "540s", "node", "--experimental-strip-types", "services/resolute-notifications/run.mjs"]
