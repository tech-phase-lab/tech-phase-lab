FROM node:24.22.1-bookworm-slim
WORKDIR /app
# Only `pg` is needed: reuse the resolute-api lockfile.
COPY services/resolute-api/package.json services/resolute-api/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY scripts/resolute/owner-test-seed.mjs ./scripts/resolute/owner-test-seed.mjs
COPY lib/resolute/*.ts ./lib/resolute/
COPY lib/membership/entitlements.ts ./lib/membership/entitlements.ts
USER node
ENV NODE_ENV=production
# Inert unless RESOLUTE_OWNER_TEST_SEED is exactly "on" or "off" on the (temporary) service; otherwise it prints DISABLED and exits 0.
RUN node scripts/resolute/owner-test-seed.mjs
CMD ["timeout", "--signal=TERM", "--kill-after=10s", "120s", "node", "scripts/resolute/owner-test-seed.mjs"]
