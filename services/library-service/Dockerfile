FROM node:18-alpine
WORKDIR /app

COPY package.json ./
COPY shared/ ./shared/

COPY services/library-service/ ./services/library-service/

WORKDIR /app/services/library-service
RUN npm install --production

EXPOSE 5007
CMD ["node", "src/index.js"]
