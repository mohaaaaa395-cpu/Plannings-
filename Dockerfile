# ============================================================
# CEDIF Saint-Antoine — Planning app
# Single-image build: builds the React frontend into the backend's
# public/ folder, then runs the Express API which serves both.
# ============================================================
FROM node:20-slim AS build
WORKDIR /app

# Install backend production dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

# Build the frontend (needs dev deps like vite); outputs to ../backend/public
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install
COPY backend ./backend
COPY frontend ./frontend
RUN cd frontend && npm run build

# ---- Runtime image ----
FROM node:20-slim
WORKDIR /app/backend
ENV NODE_ENV=production
# Copy the backend (with prod node_modules, source and built public/)
COPY --from=build /app/backend ./
EXPOSE 8080
CMD ["node", "src/index.js"]
