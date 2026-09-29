FROM node:18-alpine
WORKDIR /app

COPY package.json ./
COPY shared/ ./shared/

COPY services/fee-service/ ./services/fee-service/

WORKDIR /app/services/fee-service
RUN npm install --production

EXPOSE 5005
CMD ["node", "src/index.js"]
