# Context: repo root. NEXT_PUBLIC_* values are inlined at build time, so pass them as build args.
FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /src
# Download dependencies from the lockfile only, so a source change does not re-download them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
ARG NEXT_PUBLIC_NETWORK=fuji
ARG NEXT_PUBLIC_RELAYER_URL
ARG NEXT_PUBLIC_INDEXER_URL
ARG NEXT_PUBLIC_L1_RPC
ARG NEXT_PUBLIC_C_RPC
ARG NEXT_PUBLIC_PRIVY_APP_ID
ARG NEXT_PUBLIC_APP_DOMAIN
ENV NEXT_PUBLIC_NETWORK=$NEXT_PUBLIC_NETWORK NEXT_PUBLIC_RELAYER_URL=$NEXT_PUBLIC_RELAYER_URL NEXT_PUBLIC_INDEXER_URL=$NEXT_PUBLIC_INDEXER_URL NEXT_PUBLIC_L1_RPC=$NEXT_PUBLIC_L1_RPC NEXT_PUBLIC_C_RPC=$NEXT_PUBLIC_C_RPC NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID NEXT_PUBLIC_APP_DOMAIN=$NEXT_PUBLIC_APP_DOMAIN NEXT_OUTPUT=standalone
RUN pnpm install --offline --frozen-lockfile --filter @vatanta/web... && pnpm --filter @vatanta/web build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=4001 HOSTNAME=0.0.0.0
COPY --from=build /src/apps/web/.next/standalone ./
COPY --from=build /src/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /src/apps/web/public ./apps/web/public
EXPOSE 4001
CMD ["node", "apps/web/server.js"]
