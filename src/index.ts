import dotenv from 'dotenv';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

// Carrega as variáveis de ambiente do arquivo .env
dotenv.config();

let isRunning = false;

// Recupera as variáveis de ambiente
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL as string;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY as string;

// Valida variáveis de ambiente obrigatórias
if (!DISCORD_WEBHOOK_URL || !DEEPSEEK_API_KEY) {
  console.error('Erro: Variáveis de ambiente obrigatórias não configuradas.');
  console.error('Certifique-se de que DISCORD_WEBHOOK_URL e DEEPSEEK_API_KEY estão definidas no arquivo .env');
  process.exit(1);
}

// URLs que serão verificadas para extrair as notícias
const ULTIMAS_URL = "https://www.centraldatoca.com.br/ultimas/";
const HOME_URL = "https://www.centraldatoca.com.br/";

// Caminhos para arquivos de persistência e configuração.
// Quando o código é executado a partir de dist, esses arquivos permanecem em
// ../src para que possam ser montados como volume no Docker.
const configDir = __dirname.includes('dist') ? path.resolve(__dirname, '../src') : __dirname;

// Caminho do arquivo que armazenará as URLs processadas
const processedNewsFilePath = path.join(configDir, 'processedNews.json');

// Caminho do arquivo com filtros de URLs que devem ser ignoradas
const ignoreUrlsFilePath = path.join(configDir, 'ignoredUrls.json');

function loadIgnoreUrls(): string[] {
  if (!fs.existsSync(ignoreUrlsFilePath)) {
    return [];
  }
  try {
    const data = fs.readFileSync(ignoreUrlsFilePath, 'utf-8').trim();
    return data ? JSON.parse(data) : [];
  } catch (err) {
    console.error('Erro ao ler ignoredUrls.json. Nenhum filtro será aplicado.', err);
    return [];
  }
}

const ignoreUrls = loadIgnoreUrls();

// Carrega as URLs processadas do arquivo (para evitar envios duplicados)
let processedNews = new Set<string>();
try {
  if (!fs.existsSync(processedNewsFilePath) || fs.lstatSync(processedNewsFilePath).isDirectory()) {
    fs.writeFileSync(processedNewsFilePath, '[]');
  }
  const data = fs.readFileSync(processedNewsFilePath, 'utf-8').trim();
  if (data) {
    processedNews = new Set(JSON.parse(data));
  }
} catch (err) {
  console.error('Erro ao ler processedNews.json. Iniciando com um conjunto vazio.', err);
  processedNews = new Set();
}

// Função para salvar as URLs processadas no arquivo
function saveProcessedNews() {
  fs.writeFileSync(processedNewsFilePath, JSON.stringify(Array.from(processedNews)));
}

// Função para buscar o conteúdo completo da notícia a partir de sua URL
async function getFullNewsSummary(newsUrl: string): Promise<string> {
  try {
    return await retryWithBackoff(async () => {
      const { data } = await axios.get(newsUrl, {
        timeout: 15000, // 15 segundos de timeout
      });
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
    }, 2, 500); // Menos retries e delay menor para scraping
  } catch (error) {
    console.error(`Erro ao buscar o conteúdo completo da notícia em ${newsUrl}:`, error); 
    return '';
  }
}

// Função para implementar retry com exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const delay = initialDelay * Math.pow(2, i);
      console.error(`Tentativa ${i + 1} falhou. Tentando novamente em ${delay}ms...`);
      
      // Se for um erro 429 (rate limit), espera mais tempo
      if (error.response?.status === 429) {
        const retryAfter = error.response.headers['retry-after'];
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : delay * 2;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// Função para chamar a API do DeepSeek v3 para gerar o resumo
async function runDeepseek(prompt: string): Promise<string> {
  return retryWithBackoff(async () => {
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions', 
      {
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2, 
        max_tokens: 500,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        },
        timeout: 30000, // 30 segundos de timeout
      }
    );
    
    return response.data.choices[0].message.content.trim() || '';
  });
}

// Função para verificar se uma URL deve ser ignorada (por exemplo, notícias da Sada)
function shouldIgnoreUrl(url: string): boolean {
  return ignoreUrls.some(segment => url.includes(`/${segment}/`));
}

// Função que realiza o scraping do site e extrai as notícias com o resumo completo
async function scrapeNews(): Promise<Array<{ title: string; url: string; summary: string }>> {
  try {
    const newsItems: Array<{ title: string; url: string; summary: string }> = [];
    const processedUrls = new Set<string>();

    // 1. Depois, faz o scraping da página de últimas notícias
    console.log('Buscando notícias na página de últimas notícias...');
    const ultimasResponse = await retryWithBackoff(async () => 
      axios.get(ULTIMAS_URL, { timeout: 15000 }), 2, 500
    );
    const $ultimas = cheerio.load(ultimasResponse.data);
    
    const ultimasNewsElements = $ultimas('div.tdb_module_loop.td_module_wrap').toArray();
    for (const element of ultimasNewsElements) {
      const titleElement = $ultimas(element).find('.td-module-meta-info h3.entry-title a');
      const title = titleElement.text().trim();
      const url = titleElement.attr('href') || '';
      
      // Ignora notícias da Sada e URLs já processadas
      if (url && !processedUrls.has(url) && !shouldIgnoreUrl(url)) {
        processedUrls.add(url);
        // Busca a versão completa do conteúdo na página da notícia
        const fullSummary = await getFullNewsSummary(url);
        newsItems.push({ title, url, summary: fullSummary });
      }
    }
    
    // 2. Primeiro, faz o scraping da página inicial (que pode ter notícias mais recentes)
    console.log('Buscando notícias na página inicial...');
    const homeResponse = await retryWithBackoff(async () => 
      axios.get(HOME_URL, { timeout: 15000 }), 2, 500
    );
    const $home = cheerio.load(homeResponse.data);
    
    // Busca notícias na estrutura do bloco de últimas notícias da página inicial
    const homeNewsElements = $home('div.td_module_flex.td_module_flex_1').toArray();
    for (const element of homeNewsElements) {
      const titleElement = $home(element).find('h3.entry-title a');
      const title = titleElement.text().trim();
      const url = titleElement.attr('href') || '';
      
      // Ignora notícias da Sada e URLs já processadas
      if (url && !processedUrls.has(url) && !shouldIgnoreUrl(url)) {
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
