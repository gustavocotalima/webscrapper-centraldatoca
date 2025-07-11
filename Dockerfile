FROM node:20-alpine

WORKDIR /app

# Copia os arquivos de definição de dependências
COPY package.json pnpm-lock.yaml ./

# Instala o pnpm
RUN npm install -g pnpm

# Instala as dependências
RUN pnpm install --frozen-lockfile

# Copia o código fonte
COPY . .

# Compila o TypeScript
RUN pnpm run build

# Cria o diretório src para dados em tempo de execução se não existir
RUN mkdir -p /app/src

# Inicia a aplicação
CMD ["node", "dist/index.js"]