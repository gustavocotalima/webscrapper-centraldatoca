FROM node:20-alpine

WORKDIR /app

# Copia os arquivos de definição de dependências
COPY package.json pnpm-lock.yaml ./

# Instala o pnpm
RUN npm install -g pnpm

# Instala as dependências usando pnpm
RUN pnpm install

# Copia o código fonte
COPY . .

# Cria o diretório para os arquivos de persistência se não existir
RUN mkdir -p src

# Compila o TypeScript
RUN pnpm exec tsc

# Comando para iniciar a aplicação
CMD ["node", "dist/index.js"]
