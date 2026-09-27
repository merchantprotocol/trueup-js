# Test image: builds the SDK and runs its tests (live tests need TRUEUP_API_KEY).
FROM node:22-bookworm-slim
WORKDIR /sdk
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build
CMD ["npm", "test"]
