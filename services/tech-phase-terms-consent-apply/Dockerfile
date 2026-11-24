FROM node:24.22.1-bookworm-slim
WORKDIR /app
# Only `pg` is needed: reuse the resolute-api lockfile.
COPY services/resolute-api/package.json services/resolute-api/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY scripts/tech-phase/apply-terms-consent.mjs ./scripts/tech-phase/apply-terms-consent.mjs
COPY db/tech-phase/010_terms_consent.sql ./db/tech-phase/010_terms_consent.sql
USER node
ENV NODE_ENV=production
# Inert unless TECH_PHASE_APPLY_TERMS_CONSENT=live|sandbox is set on the (temporary) service; otherwise it prints DISABLED and exits 0.
RUN node scripts/tech-phase/apply-terms-consent.mjs
CMD ["timeout", "--signal=TERM", "--kill-after=10s", "120s", "node", "scripts/tech-phase/apply-terms-consent.mjs"]
