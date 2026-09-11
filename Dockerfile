# syntax=docker/dockerfile:1
FROM node:24.20.0-bookworm-slim AS base
WORKDIR /app
ENV LOG_TO_FILE=false

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development
COPY --chown=node:node scripts/promote-admin.js ./scripts/
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node drizzle.config.js ./
USER node
EXPOSE 3000
CMD ["node", "--watch", "src/index.js"]

FROM dependencies AS test
COPY scripts/promote-admin.js ./scripts/
COPY src ./src
COPY public ./public
COPY index.js ./
COPY test ./test
COPY drizzle ./drizzle
COPY eslint.config.js .prettierrc ./
USER node
CMD ["npm", "test"]

FROM development AS migration
CMD ["npm", "run", "db:migrate"]

FROM base AS production-dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS production
COPY --chown=node:node scripts/promote-admin.js ./scripts/
ENV NODE_ENV=production
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "--input-type=module", "-e", "const r = await fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health', {signal: AbortSignal.timeout(3000)}); process.exit(r.ok ? 0 : 1)"]
CMD ["node", "src/index.js"]
