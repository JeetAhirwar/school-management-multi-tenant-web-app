FROM node:18-alpine
WORKDIR /app

# Copy root package.json (for file:../.. dependency) and shared module
COPY package.json ./
COPY shared/ ./shared/

# Copy api-gateway source
COPY api-gateway/ ./api-gateway/

WORKDIR /app/api-gateway
RUN npm install --production

EXPOSE 5000
CMD ["node", "src/index.js"]
