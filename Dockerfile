FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.server.json ./
COPY lib ./lib
COPY server ./server
RUN npm run build:backend

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4174 DATA_DIR=/data TZ=America/Los_Angeles
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force && mkdir -p /data && chown 99:100 /data
COPY --from=build /app/dist-server ./dist-server
COPY migrations ./migrations
COPY scripts/retry-unmatched.mjs ./scripts/retry-unmatched.mjs
COPY scripts/backfill-rt.mjs ./scripts/backfill-rt.mjs
COPY scripts/kids-in-mind.mjs ./scripts/kids-in-mind.mjs
USER 99:100
EXPOSE 4174
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/server/index.js"]
