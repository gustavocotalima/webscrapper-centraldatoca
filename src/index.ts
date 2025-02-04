import dotenv from 'dotenv';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

// Carrega as variáveis de ambiente do arquivo .env
dotenv.config();

let isRunning = false;

// Recupera a URL do webhook do Discord a partir das variáveis de ambiente
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL as string;

// URL que será verificada para extrair as notícias
const TARGET_URL = "https://www.centraldatoca.com.br/ultimas/";

// Caminho do arquivo que armazenará as URLs processadas
const processedNewsFilePath = path.resolve(__dirname, 'processedNews.json');

// Carrega as URLs processadas do arquivo (para evitar envios duplicados)
let processedNews = new Set<string>();
if (fs.existsSync(processedNewsFilePath)) {
  const data = fs.readFileSync(processedNewsFilePath, 'utf-8').trim();
  if (data) {
    try {
      processedNews = new Set(JSON.parse(data));
    } catch (err) {
      console.error('Erro ao fazer parse do arquivo processedNews.json. Iniciando com um conjunto vazio.', err);
      processedNews = new Set();
    }
  }
}

// Função para salvar as URLs processadas no arquivo
function saveProcessedNews() {
  fs.writeFileSync(processedNewsFilePath, JSON.stringify(Array.from(processedNews)));
}

// Função para buscar o conteúdo completo da notícia a partir de sua URL
async function getFullNewsSummary(newsUrl: string): Promise<string> {
  try {
    const { data } = await axios.get(newsUrl);
    const $ = cheerio.load(data);
    // Ajuste o seletor para capturar o conteúdo completo da notícia
    let fullSummary = $('div.td-post-content').text().trim();
    
    // Extrai somente os textos dos parágrafos e cabeçalhos
    fullSummary = $('div.td-post-content')
      .find('p, h1, h2, h3, h4, h5, h6')
      .map((i, el) => $(el).text())
      .get()
      .join('\n')
      .replace(/\s{2,}/g, ' ')
      .replace(/Leia também:.*?(?=\n|$)/g, '')
      .trim();
    return fullSummary;
  } catch (error) {
    console.error(`Erro ao buscar o conteúdo completo da notícia em ${newsUrl}:`, error); 
    return '';
  }
}

// Função para chamar a API do Ollama (no localhost) para gerar o resumo.
// O endpoint utilizado é http://localhost:11434/api/generate e espera um JSON com "model" e "prompt".
async function runOllama(prompt: string): Promise<string> {
  try {
    const response = await axios.post('http://localhost:11434/api/generate', {
      model: 'llama3:8b',
      prompt: prompt,
      stream: false
    });
    // Supondo que a resposta possua o campo "response" com o texto gerado.
    return response.data.response?.trim() || '';
  } catch (error) {
    console.error('Erro ao chamar a API do Ollama:', error);
    throw error;
  }
}

// Função que realiza o scraping do site e extrai as notícias com o resumo completo
async function scrapeNews(): Promise<Array<{ title: string; url: string; summary: string }>> {
  try {
    const { data } = await axios.get(TARGET_URL);
    const $ = cheerio.load(data);

    const newsItems: Array<{ title: string; url: string; summary: string }> = [];
    
    const newsElements = $('div.tdb_module_loop.td_module_wrap').toArray();
    for (const element of newsElements) {
      const titleElement = $(element).find('.td-module-meta-info h3.entry-title a');
      const title = titleElement.text().trim();
      const url = titleElement.attr('href') || '';
      
      if (url) {
        // Busca a versão completa do conteúdo na página da notícia
        const fullSummary = await getFullNewsSummary(url);
        newsItems.push({ title, url, summary: fullSummary });
      }
    }
    
    return newsItems;
  } catch (error) {
    console.error('Erro ao realizar o scraping:', error);
    return [];
  }
}

// Função que processa cada notícia: utiliza a API lo cal do Ollama para gerar o resumo e envia para o Discord
async function processNewsItem(news: { title: string; url: string; summary: string }): Promise<void> {
  try {
    // Define o prompt para extrair um resumo conciso
    const prompt = `Reescreva o texto da notícia para ter no máximo 1700 caracteres, deve conter todas as informações importantes. Esta notícia foi obtida via web scraping. Abaixo, o título e o conteúdo completo da notícia. Só responda o texto gerado, nenhum prelambulo, nada mais.
Título: ${news.title}
Conteúdo: ${news.summary}`;

    // Chama a API local do Ollama
    const importantInfo = await runOllama(prompt);

    // Monta a mensagem para o Discord com o resumo gerado
    const discordMessage = {
      content: `**${news.title}**\n${importantInfo}\n\nLeia mais: ${news.url}`,
    };

    await axios.post(DISCORD_WEBHOOK_URL, discordMessage);
    console.log(`Notícia enviada: ${news.title}`);
  } catch (error) {
    console.error('Erro ao processar a notícia com Ollama:', error);
    // Em caso de erro ao processar com o modelo, envia o conteúdo completo da notícia
    try {
      const discordMessage = {
        content: `**${news.title}**\n${news.summary.length > 1700 ? news.summary.slice(0, 1700) + '...' : news.summary}\n\nLeia mais: ${news.url}`,
      };
      await axios.post(DISCORD_WEBHOOK_URL, discordMessage);
      console.log(`Notícia enviada (texto completo): ${news.title}`);
    } catch (err) {
      console.error('Erro ao enviar mensagem completa para o Discord:', err);
    }
  }
}

// Função principal que coordena o fluxo de extração e envio das notícias
async function main(): Promise<void> {
  if (isRunning) {
    console.log('A execução anterior ainda está em andamento. Aguardando...');
    return;
  }
  isRunning = true;
  console.log('Verificando novas notícias...');
  const newsItems = await scrapeNews();
  for (const news of newsItems) {
    if (!processedNews.has(news.url)) {
      await processNewsItem(news);
      processedNews.add(news.url);
      saveProcessedNews();
    }
  }
  console.log('Verificação de notícias concluída.');
  isRunning = false;
}

// Chama a função main imediatamente e agenda para ser executada a cada 1 minuto
main();
setInterval(main, 60 * 1000);
