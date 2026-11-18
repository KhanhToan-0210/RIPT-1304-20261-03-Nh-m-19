FROM node:20-alpine
RUN apk add --no-cache nginx
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY gateway /app/gateway
COPY backend/src/services/clusterState.js /app/gateway/clusterState.cjs
ENV NODE_PATH=/app/backend/node_modules
EXPOSE 8080
CMD ["node", "/app/gateway/bootstrap.cjs"]
