FROM node:18-alpine

# Define o diretório de trabalho
WORKDIR /app

# Copia os arquivos de dependência
COPY package*.json ./

# Instala as dependências
RUN npm install

# Copia todo o código para dentro do container
COPY . .

# Expõe a nova porta que o servidor Node vai rodar
EXPOSE 3002

# Inicia a aplicação
CMD ["npm", "start"]
