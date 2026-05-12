# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

# Copy root package files
COPY package.json package-lock.json ./
# Copy package manifests for workspace resolution
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/

# Install ALL dependencies (including devDependencies for build)
RUN npm install

# Copy source code and configs
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend

# Build the packages using the simplified scripts
RUN npm run build:prod -w @mockia/shared
RUN npm run build:prod -w @mockia/backend

# Stage 2: Runtime
FROM node:20-alpine

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy root package files
COPY package.json package-lock.json ./
# Copy built artifacts and manifests from builder
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/backend/package.json ./packages/backend/package.json
COPY --from=builder /app/packages/frontend/package.json ./packages/frontend/package.json

# Install only production dependencies
# This re-resolves workspaces and installs only what's needed for runtime
RUN npm install --omit=dev

EXPOSE 3000

# Use tsx to handle ESM module resolution (missing extensions in imports) which is no longer supported by node 20 flags
CMD ["npx", "tsx", "packages/backend/dist/index.js"]
