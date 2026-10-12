# Stage 1: Build
FROM node:22-alpine AS builder

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
RUN npm ci

# Copy source code
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend

# Build shared and backend
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/backend

# Stage 2: Runtime
FROM node:22-alpine

WORKDIR /app

# Copy package files for production install
COPY package.json package-lock.json ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/shared/package.json ./packages/shared/

# Install only production dependencies
RUN npm ci --omit=dev

# Copy compiled artifacts
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Start the application
CMD ["npm", "start", "--workspace=packages/backend"]
