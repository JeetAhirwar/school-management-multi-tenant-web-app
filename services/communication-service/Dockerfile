FROM node:18-alpine
WORKDIR /app

COPY package.json ./
COPY shared/ ./shared/

COPY services/communication-service/ ./services/communication-service/

WORKDIR /app/services/communication-service
RUN npm install --production

EXPOSE 5006
CMD ["node", "src/index.js"]
