FROM node:18-alpine
WORKDIR /app

COPY package.json ./
COPY shared/ ./shared/

COPY services/academic-service/ ./services/academic-service/

WORKDIR /app/services/academic-service
RUN npm install --production

EXPOSE 5004
CMD ["node", "src/index.js"]
