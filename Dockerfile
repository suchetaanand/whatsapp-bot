FROM node:20-bullseye

# Install System Chromium and its dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Set up working directory
WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm install

# Copy project files
COPY . .

# Railway dynamic port
ENV PORT=8080
EXPOSE $PORT

# Start command
CMD ["npm", "start"]
