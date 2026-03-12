FROM node:18-alpine

# Define o diretório de trabalho
WORKDIR /app

# Copia os arquivos de dependência
COPY package*.json ./

# Instala as dependências
RUN npm install

# Copia todo o código para dentro do container
COPY . .

# Define a variável de ambiente para ajudar o Proxy do Coolify a achar a porta
ENV PORT=3002

# Expõe a porta que o servidor Node vai rodar internamente
EXPOSE 3002

# Inicia a aplicação
CMD ["npm", "start"]
