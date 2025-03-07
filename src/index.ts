import dotenv from 'dotenv';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

// Carrega as variáveis de ambiente do arquivo .env
dotenv.config();

let isRunning = false;

// Recupera as variáveis de ambiente
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL as string;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY as string;
const GITHUB_GIST_TOKEN = process.env.GITHUB_GIST_TOKEN;
const GITHUB_GIST_ID = process.env.GITHUB_GIST_ID; // Create a Gist and put its ID here

// URLs que serão verificadas para extrair as notícias
const ULTIMAS_URL = "https://www.centraldatoca.com.br/ultimas/";
const HOME_URL = "https://www.centraldatoca.com.br/";

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

// Função para chamar a API do DeepSeek v3 para gerar o resumo
async function runDeepseek(prompt: string): Promise<string> {
  try {
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions', 
      {
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.5, 
        max_tokens: 350,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        },
      }
    );
    
    return response.data.choices[0].message.content.trim() || '';
  } catch (error) {
    console.error('Erro ao chamar a API do DeepSeek:', error);
    throw error;
  }
}

// Função que realiza o scraping do site e extrai as notícias com o resumo completo
async function scrapeNews(): Promise<Array<{ title: string; url: string; summary: string }>> {
  try {
    const newsItems: Array<{ title: string; url: string; summary: string }> = [];
    const processedUrls = new Set<string>();
    
    // 1. Primeiro, faz o scraping da página inicial (que pode ter notícias mais recentes)
    console.log('Buscando notícias na página inicial...');
    const homeResponse = await axios.get(HOME_URL);
    const $home = cheerio.load(homeResponse.data);
    
    // Busca notícias na estrutura do bloco de últimas notícias da página inicial
    const homeNewsElements = $home('div.td_module_flex.td_module_flex_1').toArray();
    for (const element of homeNewsElements) {
      const titleElement = $home(element).find('h3.entry-title a');
      const title = titleElement.text().trim();
      const url = titleElement.attr('href') || '';
      
      if (url && !processedUrls.has(url)) {
        processedUrls.add(url);
        // Busca a versão completa do conteúdo na página da notícia
        const fullSummary = await getFullNewsSummary(url);
        newsItems.push({ title, url, summary: fullSummary });
      }
    }
    
    // 2. Depois, faz o scraping da página de últimas notícias
    console.log('Buscando notícias na página de últimas notícias...');
    const ultimasResponse = await axios.get(ULTIMAS_URL);
    const $ultimas = cheerio.load(ultimasResponse.data);
    
    const ultimasNewsElements = $ultimas('div.tdb_module_loop.td_module_wrap').toArray();
    for (const element of ultimasNewsElements) {
      const titleElement = $ultimas(element).find('.td-module-meta-info h3.entry-title a');
      const title = titleElement.text().trim();
      const url = titleElement.attr('href') || '';
      
      if (url && !processedUrls.has(url)) {
        processedUrls.add(url);
        // Busca a versão completa do conteúdo na página da notícia
        const fullSummary = await getFullNewsSummary(url);
        newsItems.push({ title, url, summary: fullSummary });
      }
    }
    
    console.log(`Total de notícias encontradas: ${newsItems.length}`);
    return newsItems;
  } catch (error) {
    console.error('Erro ao realizar o scraping:', error);
    return [];
  }
}

// Função que processa cada notícia: utiliza a API do DeepSeek para gerar o resumo e envia para o Discord
async function processNewsItem(news: { title: string; url: string; summary: string }): Promise<void> {
  try {
    // Define o prompt para extrair um resumo conciso
    const prompt = `Reescreva o texto da notícia para ter no máximo 1700 caracteres, contendo apenas as informações mais importantes.
    
    IMPORTANTE: 
    - NÃO repita o título no início do texto resumido
    - O título já será exibido separadamente
    - Comece o resumo diretamente com as informações da notícia
    - Não mencione que é um resumo ou que a notícia foi obtida por web scraping
    
    Título: ${news.title}
    Conteúdo: ${news.summary}
    `;

    // Chama a API do DeepSeek
    const importantInfo = await runDeepseek(prompt);

    // Monta a mensagem para o Discord com o resumo gerado
    const discordMessage = {
      content: `**${news.title}**\n${importantInfo}\n\nLeia mais: ${news.url}`,
    };

    await axios.post(DISCORD_WEBHOOK_URL, discordMessage);
    console.log(`Notícia enviada: ${news.title}`);
  } catch (error) {
    console.error('Erro ao processar a notícia com DeepSeek:', error);
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

// Instead of using local file system for storage, let's use an API (GitHub Gist as an example)
// Replace the processedNews loading and saving functions
async function loadProcessedNews(): Promise<Set<string>> {
  try {
    if (!GITHUB_GIST_ID || !GITHUB_GIST_TOKEN) {
      console.warn('GitHub Gist credentials not found. Using in-memory storage only.');
      return new Set<string>();
    }
    
    const response = await axios.get(`https://api.github.com/gists/${GITHUB_GIST_ID}`, {
      headers: {
        Authorization: `token ${GITHUB_GIST_TOKEN}`,
      },
    });
    
    const content = response.data.files['processedNews.json']?.content;
    if (content) {
      return new Set<string>(JSON.parse(content));
    }
    
    return new Set<string>();
  } catch (error) {
    console.error('Error loading processed news:', error);
    return new Set<string>();
  }
}

async function saveProcessedNews(processedNews: Set<string>): Promise<void> {
  try {
    if (!GITHUB_GIST_ID || !GITHUB_GIST_TOKEN) {
      console.warn('GitHub Gist credentials not found. Changes will not be persisted.');
      return;
    }
    
    await axios.patch(
      `https://api.github.com/gists/${GITHUB_GIST_ID}`,
      {
        files: {
          'processedNews.json': {
            content: JSON.stringify(Array.from(processedNews)),
          },
        },
      },
      {
        headers: {
          Authorization: `token ${GITHUB_GIST_TOKEN}`,
        },
      }
    );
  } catch (error) {
    console.error('Error saving processed news:', error);
  }
}

// Export the main function so it can be imported in the API route
export async function main(): Promise<void> {
  if (isRunning) {
    console.log('A execução anterior ainda está em andamento. Aguardando...');
    return;
  }
  isRunning = true;
  console.log('Verificando novas notícias...');
  
  // Load the processed news from the external storage
  const processedNews = await loadProcessedNews();
  
  const newsItems = await scrapeNews();
  for (const news of newsItems) {
    if (!processedNews.has(news.url)) {
      await processNewsItem(news);
      processedNews.add(news.url);
    }
  }
  
  // Save the updated processed news back to the external storage
  await saveProcessedNews(processedNews);
  
  console.log('Verificação de notícias concluída.');
  isRunning = false;
}

// For local development, you can still call main directly
if (process.env.NODE_ENV !== 'production') {
  main();
}

// Remove the setInterval since Vercel will use the cron job instead
// setInterval(main, 60 * 1000);

// Export individual functions for API endpoints to use
export async function fetchNewsUrls(): Promise<Array<{ title: string; url: string }>> {
  try {
    const newsItems: Array<{ title: string; url: string }> = [];
    const processedUrls = new Set<string>();
    
    // 1. First, scrape the homepage (may have most recent news)
    console.log('Fetching news from homepage...');
    const homeResponse = await axios.get(HOME_URL);
    const $home = cheerio.load(homeResponse.data);
    
    const homeNewsElements = $home('div.td_module_flex.td_module_flex_1').toArray();
    for (const element of homeNewsElements) {
      const titleElement = $home(element).find('h3.entry-title a');
      const title = titleElement.text().trim();
      const url = titleElement.attr('href') || '';
      
      if (url && !processedUrls.has(url)) {
        processedUrls.add(url);
        newsItems.push({ title, url });
      }
    }
    
    // 2. Then, scrape the latest news page
    console.log('Fetching news from latest news page...');
    const ultimasResponse = await axios.get(ULTIMAS_URL);
    const $ultimas = cheerio.load(ultimasResponse.data);
    
    const ultimasNewsElements = $ultimas('div.tdb_module_loop.td_module_wrap').toArray();
    for (const element of ultimasNewsElements) {
      const titleElement = $ultimas(element).find('.td-module-meta-info h3.entry-title a');
      const title = titleElement.text().trim();
      const url = titleElement.attr('href') || '';
      
      if (url && !processedUrls.has(url)) {
        processedUrls.add(url);
        newsItems.push({ title, url });
      }
    }
    
    console.log(`Total news items found: ${newsItems.length}`);
    return newsItems;
  } catch (error) {
    console.error('Error fetching news URLs:', error);
    return [];
  }
}

// Function to process a single news item by URL
export async function processOneNewsItem(url: string): Promise<boolean> {
  try {
    // Load processed news to check if this URL has already been processed
    const processedNews = await loadProcessedNews();
    
    // Skip if already fully processed
    if (processedNews.has(url)) {
      console.log(`News item already processed: ${url}`);
      return false;
    }
    
    console.log(`Processing news item: ${url}`);
    
    // Get the full content
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    
    // Extract title
    const title = $('h1.entry-title').text().trim();
    
    // Extract content
    let summary = $('div.td-post-content')
      .find('p, h1, h2, h3, h4, h5, h6')
      .map((i, el) => $(el).text())
      .get()
      .join('\n')
      .replace(/\s{2,}/g, ' ')
      .replace(/Leia também:.*?(?=\n|$)/g, '')
      .trim();
    
    // Process and send to Discord
    await processNewsItem({ title, url, summary });
    
    // Mark as processed
    processedNews.add(url);
    await saveProcessedNews(processedNews);
    
    return true;
  } catch (error) {
    console.error(`Error processing news item ${url}:`, error);
    return false;
  }
}

// Export other functions needed by the API endpoints
export { loadProcessedNews, saveProcessedNews, processNewsItem };
