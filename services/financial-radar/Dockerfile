FROM node:24.22.1-bookworm-slim
WORKDIR /app
COPY services/resolute-api/package.json services/resolute-api/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY services/financial-radar/*.mjs ./services/financial-radar/
COPY scripts/tech-phase/financial-radar-schema.sql ./scripts/tech-phase/
USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "services/financial-radar/server.mjs"]
