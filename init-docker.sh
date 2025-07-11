#!/bin/bash

# Cria o diretório src se não existir
mkdir -p src

# Cria processedNews.json se não existir
if [ ! -f src/processedNews.json ]; then
    echo "[]" > src/processedNews.json
    echo "Criado src/processedNews.json"
fi

# Verifica se ignoredUrls.json existe
if [ ! -f src/ignoredUrls.json ]; then
    echo "Aviso: src/ignoredUrls.json não encontrado. O scraper não filtrará nenhuma URL."
fi

echo "Inicialização do Docker concluída!"