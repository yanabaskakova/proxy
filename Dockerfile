# --- Build stage -----------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies (including dev deps needed to compile).
COPY package*.json ./
RUN npm install

# Compile TypeScript -> dist/
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies for a lean production node_modules.
RUN npm prune --omit=dev

# --- Runtime stage ---------------------------------------------------------
FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./
COPY responses.json ./responses.json

EXPOSE 3000

CMD ["node", "dist/main.js"]
