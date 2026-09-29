FROM node:18-alpine
WORKDIR /app

COPY package.json ./
COPY shared/ ./shared/

COPY services/staff-service/ ./services/staff-service/

WORKDIR /app/services/staff-service
RUN npm install --production

EXPOSE 5003
CMD ["node", "src/index.js"]
