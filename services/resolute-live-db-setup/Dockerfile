FROM node:24.22.1-bookworm-slim
WORKDIR /app
# Only `pg` is needed: reuse the resolute-api lockfile.
COPY services/resolute-api/package.json services/resolute-api/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY scripts/resolute/live-db-setup.mjs ./scripts/resolute/live-db-setup.mjs
COPY services/resolute-api/payments/live-config-check.mjs ./services/resolute-api/payments/live-config-check.mjs
COPY db/resolute/015_payments_live_role.sql db/resolute/016_live_entitlement_readers.sql db/resolute/021_guest_payments.sql \
     db/resolute/022_guest_receipt_queue.sql db/resolute/023_guest_receipt_sender.sql db/resolute/025_auto_renewal.sql ./db/resolute/
USER node
ENV NODE_ENV=production
# Inert unless RESOLUTE_LIVE_DB_SETUP=check|apply is set on the (temporary) service; otherwise it prints DISABLED and exits 0.
RUN node scripts/resolute/live-db-setup.mjs
CMD ["timeout", "--signal=TERM", "--kill-after=10s", "180s", "node", "scripts/resolute/live-db-setup.mjs"]
