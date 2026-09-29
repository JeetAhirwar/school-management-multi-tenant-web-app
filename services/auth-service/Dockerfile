FROM node:18-alpine
WORKDIR /app

# Copy root package.json (for file:../.. dependency) and shared module
COPY package.json ./
COPY shared/ ./shared/

# Copy auth-service source
COPY services/auth-service/ ./services/auth-service/

WORKDIR /app/services/auth-service
RUN npm install --production

EXPOSE 5001
CMD ["node", "src/index.js"]
