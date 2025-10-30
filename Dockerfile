# Build stage
FROM node:18-alpine AS builder

# Instalar ferramentas de build necessárias
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev

WORKDIR /app

# Copiar package files
COPY package*.json ./

# Instalar dependências
RUN npm install --omit=dev

# Production stage
FROM node:18-alpine

# Instalar poppler-utils para conversão PDF e tesseract para OCR local
RUN apk add --no-cache \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-data-por \
    cairo \
    jpeg \
    pango \
    giflib \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copiar node_modules do builder
COPY --from=builder /app/node_modules ./node_modules

# Copiar código da aplicação
COPY . .

# Criar diretórios necessários
RUN mkdir -p uploads public

# Expor porta
EXPOSE 4545

# Healthcheck
#HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
#    CMD node -e "require('http').get('http://localhost:4545/status', (r) => {if(r.statusCode !== 200) process.exit(1);})" || exit 1

# Comando para iniciar
CMD ["node", "server.js"]
