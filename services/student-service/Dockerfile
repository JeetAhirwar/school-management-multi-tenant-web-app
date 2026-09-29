FROM node:18-alpine
WORKDIR /app

COPY package.json ./
COPY shared/ ./shared/

COPY services/student-service/ ./services/student-service/

WORKDIR /app/services/student-service
RUN npm install --production

EXPOSE 5002
CMD ["node", "src/index.js"]
