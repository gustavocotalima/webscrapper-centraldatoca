import dotenv from 'dotenv';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

// Loads environment variables from .env file
dotenv.config();

// Retrieves the Discord webhook URL from environment variables
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL as string;

// Retrieves the target URL (website to scrape) from environment variables
const TARGET_URL = "https://www.centraldatoca.com.br/ultimas/";

// Path of the file that will store the processed URLs
const processedNewsFilePath = path.resolve(__dirname, 'processedNews.json');

// Loads processed URLs from the file (to avoid duplicate submissions)
let processedNews = new Set<string>();
if (fs.existsSync(processedNewsFilePath)) {
  const data = fs.readFileSync(processedNewsFilePath, 'utf-8').trim();
  if (data) {
    try {
      processedNews = new Set(JSON.parse(data));
    } catch (err) {
      console.error('Error parsing processedNews.json. Starting with an empty set.', err);
      processedNews = new Set();
    }
  }
}

// Function to save processed URLs to a file
function saveProcessedNews() {
  fs.writeFileSync(processedNewsFilePath, JSON.stringify(Array.from(processedNews)));
}

// Function to fetch the full content of a news article from its page
async function getFullNewsSummary(newsUrl: string): Promise<string> {
  try {
    const { data } = await axios.get(newsUrl);
    const $ = cheerio.load(data);
    // Adjust the selector to capture the full content of the article
    let fullSummary = $('div.td-post-content').text().trim();
    
    // Extract only the text from paragraphs and headings
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
    console.error(`Error fetching the full article content from ${newsUrl}:`, error); 
    return '';
  }
}

// Function to call the local Ollama API to generate a summary
// Endpoint: http://localhost:11434/api/generate, expects a JSON with "model" and "prompt"
async function runOllama(prompt: string): Promise<string> {
  try {
    const response = await axios.post('http://localhost:11434/api/generate', {
      model: 'llama3:8b',
      prompt: prompt,
      stream: false
    });
    // Assuming the response has a "response" field with the generated text
    return response.data.response?.trim() || '';
  } catch (error) {
    console.error('Error calling the Ollama API:', error);
    throw error;
  }
}

// Function that scrapes the website and extracts news with a full summary
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
        // Fetch the full version of the content from the news page
        const fullSummary = await getFullNewsSummary(url);
        newsItems.push({ title, url, summary: fullSummary });
      }
    }
    
    return newsItems;
  } catch (error) {
    console.error('Error scraping the site:', error);
    return [];
  }
}

// Function that processes each news item: uses the local Ollama API to generate a summary and sends it to Discord
async function processNewsItem(news: { title: string; url: string; summary: string }): Promise<void> {
  try {
    // Define the prompt to extract a concise summary
    const prompt = `This news was obtained via web scraping. Below, the title and the full content of the news. Create a concise summary explaining the text information. Max 1700 characters. Only reply with the summary text, nothing else.
Title: ${news.title}
Content: ${news.summary}`;

    // Calls the local Ollama API
    const importantInfo = await runOllama(prompt);

    // Builds the message for Discord with the generated summary
    const discordMessage = {
      content: `**${news.title}**\n${importantInfo}\n\nRead more: ${news.url}`,
    };

    await axios.post(DISCORD_WEBHOOK_URL, discordMessage);
    console.log(`News sent: ${news.title}`);
  } catch (error) {
    console.error('Error processing the news with Ollama:', error);
    // In case of an error processing with the model, send the full content
    try {
      const discordMessage = {
        content: `**${news.title}**\n${news.summary.length > 1700 ? news.summary.slice(0, 1700) + '...' : news.summary}\n\nRead more: ${news.url}`,
      };
      await axios.post(DISCORD_WEBHOOK_URL, discordMessage);
      console.log(`News sent (full text): ${news.title}`);
    } catch (err) {
      console.error('Error sending full text message to Discord:', err);
    }
  }
}

// Main function that coordinates the extraction and sending of news
async function main(): Promise<void> {
  console.log('Checking for new news...');
  const newsItems = await scrapeNews();
  for (const news of newsItems) {
    if (!processedNews.has(news.url)) {
      await processNewsItem(news);
      processedNews.add(news.url);
      saveProcessedNews();
    }
  }
}

// Calls the main function immediately and schedules it to run every 5 minutes
main();
setInterval(main, 5 * 60 * 1000);
