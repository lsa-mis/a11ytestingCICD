# a11y-alfa MCP server — ARM64-ready (aarch64) container image.
#
# Based on Playwright's official image, which is multi-arch (linux/amd64 +
# linux/arm64) and ships Node + Chromium + every required system library. That
# lets this run natively on aarch64 hosts such as an NVIDIA DGX Spark
# (DGX OS / Ubuntu 24.04 "noble") with no arch-specific changes to the server.
#
# Pin the tag to the `playwright` version in package.json (currently 1.61.1) so
# the preinstalled browser matches the client.
FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

# Install dependencies against the lockfile first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Build the TypeScript server.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Chromium's sandbox can't run unprivileged in most containers; drop it here.
# The audit only loads local/trusted pages, so this is an accepted container
# trade-off (see src/audit.ts).
ENV A11Y_MCP_NO_SANDBOX=1

# Run as the non-root user the Playwright image provides.
USER pwuser

# MCP servers speak JSON-RPC over stdio. Launch from an MCP client with:
#   docker run -i --rm --ipc=host a11y-alfa-mcp
ENTRYPOINT ["node", "dist/server.js"]
