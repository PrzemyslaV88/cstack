FROM node:22.16.0-bookworm-slim
WORKDIR /opt/cstack-deps
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
