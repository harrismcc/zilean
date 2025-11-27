# Build stage
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile || bun install

# Copy source files
COPY . .

# Build the application
RUN bun run build

# Production stage
FROM oven/bun:1-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S zilean && \
    adduser -u 1001 -S zilean -G zilean

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# Create data directory
RUN mkdir -p /app/data && chown -R zilean:zilean /app

# Switch to non-root user
USER zilean

# Environment variables
ENV NODE_ENV=production
ENV ZILEAN_DATA_DIR=/app/data
ENV ZILEAN_HOST=0.0.0.0
ENV ZILEAN_PORT=8181

# Expose port
EXPOSE 8181

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8181/health/ping || exit 1

# Start the application
ENTRYPOINT ["dumb-init", "--"]
CMD ["bun", "run", "dist/index.js"]
