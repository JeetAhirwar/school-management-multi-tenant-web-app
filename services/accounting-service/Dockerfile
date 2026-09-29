FROM node:18-alpine
WORKDIR /app

COPY package.json ./
COPY shared/ ./shared/

COPY services/accounting-service/ ./services/accounting-service/

WORKDIR /app/services/accounting-service
RUN npm install --production

EXPOSE 5009
CMD ["node", "src/index.js"]
