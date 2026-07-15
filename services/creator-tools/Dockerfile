FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
ENV PORT=4011
EXPOSE 4011
CMD ["node", "src/index.js"]
