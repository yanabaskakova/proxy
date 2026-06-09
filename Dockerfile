# --- Build stage -----------------------------------------------------------
FROM node:20-alpine AS build

# Enable pnpm via corepack (pinned by package.json "packageManager").
RUN corepack enable

WORKDIR /app

# Install dependencies (including dev deps needed to compile).
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Compile TypeScript -> dist/
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN pnpm run build

# Keep only production dependencies for the runtime image.
RUN pnpm prune --prod

# --- Runtime stage ---------------------------------------------------------
FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY responses.json ./responses.json

EXPOSE 3000

CMD ["node", "dist/main.js"]
