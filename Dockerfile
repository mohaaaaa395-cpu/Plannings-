# ============================================================
# CEDIF Saint-Antoine — Planning app
# Single-image build: builds the React client into the server's
# public/ folder, then runs the Express API which serves both.
# ============================================================
FROM node:20-slim AS build
WORKDIR /app

# Install server production dependencies
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# Build the client (needs dev deps like vite); outputs to ../server/public
COPY client/package*.json ./client/
RUN cd client && npm install
COPY server ./server
COPY client ./client
RUN cd client && npm run build

# ---- Runtime image ----
FROM node:20-slim
WORKDIR /app/server
ENV NODE_ENV=production
# Copy the server (with prod node_modules, source and built public/)
COPY --from=build /app/server ./
EXPOSE 8080
CMD ["node", "src/index.js"]
