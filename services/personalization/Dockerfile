FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
ENV PORT=4006
EXPOSE 4006
CMD ["node", "src/index.js"]
