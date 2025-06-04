FROM node:18-alpine

WORKDIR /app

# Copy package files and tsconfig
COPY package*.json ./
COPY tsconfig.json ./

# Install ALL dependencies (including dev for build)
RUN npm ci

# Copy the rest of your source code (e.g., your src folder or index.ts)
COPY index.ts ./

# Build TypeScript
RUN npm run build

# --- Production Stage (optional multi-stage build for smaller image) ---
# FROM node:18-alpine
# WORKDIR /app
# COPY package*.json ./
# RUN npm ci --only=production
# COPY --from=0 /app/dist ./dist # Copy only the built JS files

EXPOSE 8080
CMD ["node", "dist/index.js"] # Run the compiled file