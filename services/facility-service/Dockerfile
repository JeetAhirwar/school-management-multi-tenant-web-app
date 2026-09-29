FROM node:18-alpine
WORKDIR /app

COPY package.json ./
COPY shared/ ./shared/

COPY services/facility-service/ ./services/facility-service/

WORKDIR /app/services/facility-service
RUN npm install --production

EXPOSE 5008
CMD ["node", "src/index.js"]
