import dotenv from 'dotenv';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { createClient } from 'redis';
import { Client, GatewayIntentBits, SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

// Carrega as variáveis de ambiente do arquivo .env
dotenv.config();

let isRunning = false;

// Recupera as variáveis de ambiente
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN as string;
const BOT_OWNER_USER_ID = process.env.BOT_OWNER_USER_ID as string;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY as string;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string;
const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY as string;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Valida variáveis de ambiente obrigatórias
if (!DISCORD_BOT_TOKEN || !BOT_OWNER_USER_ID || !DEEPSEEK_API_KEY) {
  console.error('Erro: Variáveis de ambiente obrigatórias não configuradas.');
  console.error('Certifique-se de que DISCORD_BOT_TOKEN, BOT_OWNER_USER_ID e DEEPSEEK_API_KEY estão definidas no arquivo .env');
  process.exit(1);
}

// URLs que serão verificadas para extrair as notícias
const ULTIMAS_URL = "https://www.centraldatoca.com.br/ultimas/";
const HOME_URL = "https://www.centraldatoca.com.br/";

// Initialize AI clients
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const googleAI = GOOGLE_AI_API_KEY ? new GoogleGenerativeAI(GOOGLE_AI_API_KEY) : null;

// Available AI models configuration
const MODELS: Record<string, { provider: string; model?: string; displayName: string }> = {
  'deepseek-chat': { provider: 'deepseek', displayName: 'DeepSeek Chat' },
  'gemini-2.0-flash': { provider: 'google', model: 'gemini-2.0-flash-exp', displayName: 'Gemini 2.0 Flash' },
  'gemini-2.0-flash-lite': { provider: 'google', model: 'gemini-2.0-flash-thinking-exp-1219', displayName: 'Gemini 2.0 Flash Lite' },
  'gpt-4o-mini': { provider: 'openai', model: 'gpt-4o-mini', displayName: 'GPT-4o Mini' },
  'gpt-5-nano': { provider: 'openai', model: 'gpt-5-nano', displayName: 'GPT-5 Nano' }
};

// Discord client setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

// Redis client setup
const redis = createClient({ url: REDIS_URL });

// Redis connection and error handling
redis.on('error', (err) => console.error('Erro de conexão com Redis:', err));
redis.on('connect', () => console.log('Conectado ao Redis'));
redis.on('ready', () => console.log('Redis pronto para uso'));
redis.on('end', () => console.log('Conexão com Redis encerrada'));

// Multi-server Redis functions
async function getServerChannel(guildId: string): Promise<string | null> {
  try {
    return await redis.get(`server:${guildId}:channel`);
  } catch (err) {
    console.error('Erro ao buscar canal do servidor:', err);
    return null;
  }
}

async function setServerChannel(guildId: string, channelId: string): Promise<void> {
  try {
    await redis.set(`server:${guildId}:channel`, channelId);
  } catch (err) {
    console.error('Erro ao definir canal do servidor:', err);
  }
}

async function getServerIgnoreUrls(guildId: string): Promise<string[]> {
  try {
    const data = await redis.get(`server:${guildId}:ignore_urls`);
    if (!data) {
      const defaultIgnoreUrls: string[] = []; // No filters by default
      await redis.set(`server:${guildId}:ignore_urls`, JSON.stringify(defaultIgnoreUrls));
      return defaultIgnoreUrls;
    }
    return JSON.parse(data);
  } catch (err) {
    console.error('Erro ao carregar URLs ignoradas do servidor:', err);
    return []; // No filters on error
  }
}

async function setServerIgnoreUrls(guildId: string, ignoreUrls: string[]): Promise<void> {
  try {
    await redis.set(`server:${guildId}:ignore_urls`, JSON.stringify(ignoreUrls));
  } catch (err) {
    console.error('Erro ao definir URLs ignoradas do servidor:', err);
  }
}

// Global AI model settings (bot owner only)
async function getCurrentModel(): Promise<string> {
  try {
    const model = await redis.get('global:current_model');
    return model || 'deepseek-chat';
  } catch (err) {
    console.error('Erro ao buscar modelo atual:', err);
    return 'deepseek-chat';
  }
}

async function setCurrentModel(model: string): Promise<void> {
  try {
    await redis.set('global:current_model', model);
  } catch (err) {
    console.error('Erro ao definir modelo atual:', err);
  }
}

async function getModelSettings(): Promise<{ temperature: number; max_tokens: number; top_p: number }> {
  try {
    const data = await redis.get('global:model_settings');
    if (!data) {
      const defaultSettings = { temperature: 0.7, max_tokens: 500, top_p: 0.9 };
      await redis.set('global:model_settings', JSON.stringify(defaultSettings));
      return defaultSettings;
    }
    return JSON.parse(data);
  } catch (err) {
    console.error('Erro ao buscar configurações do modelo:', err);
    return { temperature: 0.7, max_tokens: 500, top_p: 0.9 };
  }
}

async function setModelSettings(settings: { temperature?: number; max_tokens?: number; top_p?: number }): Promise<void> {
  try {
    const current = await getModelSettings();
    const updated = { ...current, ...settings };
    await redis.set('global:model_settings', JSON.stringify(updated));
  } catch (err) {
    console.error('Erro ao definir configurações do modelo:', err);
  }
}

// Processed URLs functions (global)
async function isUrlProcessed(url: string): Promise<boolean> {
  try {
    const result = await redis.sIsMember('processed_urls', url);
    return Boolean(result);
  } catch (err) {
    console.error('Erro ao verificar URL processada:', err);
    return false;
  }
}

async function markUrlAsProcessed(url: string): Promise<void> {
  try {
    await redis.sAdd('processed_urls', url);
  } catch (err) {
    console.error('Erro ao marcar URL como processada:', err);
  }
}

async function getProcessedUrlsCount(): Promise<number> {
  try {
    return await redis.sCard('processed_urls');
  } catch (err) {
    console.error('Erro ao contar URLs processadas:', err);
    return 0;
  }
}

async function clearProcessedUrls(): Promise<void> {
  try {
    await redis.del('processed_urls');
  } catch (err) {
    console.error('Erro ao limpar URLs processadas:', err);
  }
}

// Permission checking functions
function isBotOwner(userId: string): boolean {
  return userId === BOT_OWNER_USER_ID;
}

function isServerAdmin(member: any): boolean {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

// Check if URL should be ignored for specific server
async function shouldIgnoreUrlForServer(url: string, guildId: string): Promise<boolean> {
  const ignoreUrls = await getServerIgnoreUrls(guildId);
  return ignoreUrls.some(segment => url.includes(`/${segment}/`));
}

// Check if URL is ignored by ALL servers (skip AI processing if so)
async function isUrlIgnoredByAllServers(url: string): Promise<boolean> {
  try {
    const guilds = client.guilds.cache;
    if (guilds.size === 0) return false; // No servers = don't ignore
    
    for (const guild of guilds.values()) {
      const channelId = await getServerChannel(guild.id);
      if (channelId) {
        // This server has a configured channel
        const isIgnored = await shouldIgnoreUrlForServer(url, guild.id);
        if (!isIgnored) {
          // At least one server doesn't ignore this URL
          return false;
        }
      }
    }
    
    // All servers with configured channels ignore this URL
    return true;
  } catch (error) {
    console.error('Erro ao verificar se URL é ignorada por todos os servidores:', error);
    return false; // Default to not ignore on error
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

// Multi-model AI system
async function callAIModel(prompt: string): Promise<string> {
  const currentModel = await getCurrentModel();
  const settings = await getModelSettings();
  const modelConfig = MODELS[currentModel];
  
  if (!modelConfig) {
    throw new Error(`Modelo desconhecido: ${currentModel}`);
  }

  return retryWithBackoff(async () => {
    switch (modelConfig.provider) {
      case 'deepseek':
        const deepseekResponse = await axios.post(
          'https://api.deepseek.com/v1/chat/completions',
          {
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            temperature: settings.temperature,
            max_tokens: settings.max_tokens,
            top_p: settings.top_p
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
            },
            timeout: 30000
          }
        );
        return deepseekResponse.data.choices[0].message.content.trim() || '';

      case 'openai':
        if (!openai) throw new Error('OpenAI API key não configurada');
        if (!modelConfig.model) throw new Error('Modelo OpenAI não especificado');
        const openaiResponse = await openai.chat.completions.create({
          model: modelConfig.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: settings.temperature,
          max_tokens: settings.max_tokens,
          top_p: settings.top_p
        });
        return openaiResponse.choices[0]?.message?.content?.trim() || '';

      case 'google':
        if (!googleAI) throw new Error('Google AI API key não configurada');
        if (!modelConfig.model) throw new Error('Modelo Google não especificado');
        const geminiModel = googleAI.getGenerativeModel({ 
          model: modelConfig.model,
          generationConfig: {
            temperature: settings.temperature,
            maxOutputTokens: settings.max_tokens,
            topP: settings.top_p
          }
        });
        const geminiResponse = await geminiModel.generateContent(prompt);
        return geminiResponse.response.text().trim() || '';

      default:
        throw new Error(`Provider não suportado: ${modelConfig.provider}`);
    }
  });
}

// Função para buscar o conteúdo completo da notícia e imagem a partir de sua URL
async function getFullNewsContent(newsUrl: string): Promise<{ summary: string; imageUrl?: string }> {
  try {
    return await retryWithBackoff(async () => {
      const { data } = await axios.get(newsUrl, {
        timeout: 15000,
      });
      const $ = cheerio.load(data);
      
      // Extract text content
      let fullSummary = $('div.td-post-content')
        .find('p, h1, h2, h3, h4, h5, h6')
        .map((i, el) => $(el).text())
        .get()
        .join('\n')
        .replace(/\s{2,}/g, ' ')
        .replace(/Leia também:.*?(?=\n|$)/g, '')
        .trim();
      
      // Extract featured image
      let imageUrl = '';
      
      // Try multiple selectors for featured image
      const imageSelectors = [
        'meta[property="og:image"]',
        '.td-post-featured-image img',
        '.wp-post-image',
        'div.td-post-content img:first-child',
        'img.attachment-full'
      ];
      
      for (const selector of imageSelectors) {
        const imgElement = $(selector);
        if (imgElement.length > 0) {
          imageUrl = imgElement.attr('content') || imgElement.attr('src') || '';
          if (imageUrl) {
            // Convert relative URLs to absolute
            if (imageUrl.startsWith('/')) {
              imageUrl = new URL(imageUrl, newsUrl).href;
            }
            break;
          }
        }
      }
      
      return { summary: fullSummary, imageUrl: imageUrl || undefined };
    }, 2, 500);
  } catch (error) {
    console.error(`Erro ao buscar o conteúdo completo da notícia em ${newsUrl}:`, error); 
    return { summary: '' };
  }
}

// Função que realiza o scraping do site e extrai as notícias com o resumo completo
async function scrapeNews(): Promise<Array<{ title: string; url: string; summary: string; imageUrl?: string }>> {
  try {
    const newsItems: Array<{ title: string; url: string; summary: string; imageUrl?: string }> = [];
    const processedUrls = new Set<string>();

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
      
      if (url && !processedUrls.has(url)) {
        processedUrls.add(url);
        const fullContent = await getFullNewsContent(url);
        newsItems.push({ title, url, summary: fullContent.summary, imageUrl: fullContent.imageUrl });
      }
    }
    
    console.log('Buscando notícias na página inicial...');
    const homeResponse = await retryWithBackoff(async () => 
      axios.get(HOME_URL, { timeout: 15000 }), 2, 500
    );
    const $home = cheerio.load(homeResponse.data);
    
    const homeNewsElements = $home('div.td_module_flex.td_module_flex_1').toArray();
    for (const element of homeNewsElements) {
      const titleElement = $home(element).find('h3.entry-title a');
      const title = titleElement.text().trim();
      const url = titleElement.attr('href') || '';
      
      if (url && !processedUrls.has(url)) {
        processedUrls.add(url);
        const fullContent = await getFullNewsContent(url);
        newsItems.push({ title, url, summary: fullContent.summary, imageUrl: fullContent.imageUrl });
      }
    }
    
    console.log(`Total de notícias encontradas: ${newsItems.length}`);
    return newsItems;
  } catch (error) {
    console.error('Erro ao realizar o scraping:', error);
    return [];
  }
}

// Função que processa uma notícia e a envia imediatamente para os canais
async function processAndSendNews(news: { title: string; url: string; summary: string; imageUrl?: string }): Promise<void> {
  try {
    // Check if this URL is ignored by ALL servers before AI processing
    const ignoredByAll = await isUrlIgnoredByAllServers(news.url);
    if (ignoredByAll) {
      console.log(`⏭️ URL ignorada por todos os servidores: ${news.title}`);
      return;
    }

    const prompt = `Reescreva o texto da notícia para ter no máximo 1700 caracteres, contendo apenas as informações mais importantes.
    
    IMPORTANTE: 
    - NÃO repita o título no início do texto resumido
    - O título já será exibido separadamente
    - Comece o resumo diretamente com as informações da notícia
    - Não mencione que é um resumo ou que a notícia foi obtida por web scraping
    
    Título: ${news.title}
    Conteúdo: ${news.summary}
    `;

    let processedSummary: string;
    try {
      processedSummary = await callAIModel(prompt);
    } catch (error) {
      console.error('Erro ao processar com AI, usando conteúdo original:', error);
      processedSummary = news.summary.length > 1700 ? news.summary.slice(0, 1700) + '...' : news.summary;
    }

    // Send to all configured channels immediately
    await sendNewsToAllChannels(news.title, processedSummary, news.url, news.imageUrl);
    
  } catch (error) {
    console.error('Erro ao processar e enviar notícia:', error);
  }
}

// Discord bot event handlers
client.once('clientReady', async () => {
  console.log(`Bot conectado como ${client.user?.tag}`);
  await registerSlashCommands();
  console.log('Comandos slash registrados');
  
  // Inicia o loop principal de monitoramento de notícias
  main();
  setInterval(main, 60 * 1000);
});

client.on('guildCreate', async (guild) => {
  console.log(`Bot adicionado ao servidor: ${guild.name}`);
  
  // Set default channel (first text channel with send permissions)
  const defaultChannel = guild.channels.cache
    .filter(c => c.type === ChannelType.GuildText)
    .find(c => c.permissionsFor(guild.members.me!)?.has(PermissionFlagsBits.SendMessages));
    
  if (defaultChannel) {
    await setServerChannel(guild.id, defaultChannel.id);
    console.log(`Canal padrão definido para ${guild.name}: ${defaultChannel.name}`);
  }
  
  // Set default ignore patterns (none by default)
  await setServerIgnoreUrls(guild.id, []);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    await handleSlashCommand(interaction);
  } catch (error) {
    console.error('Erro ao processar comando slash:', error);
    const errorMessage = 'Ocorreu um erro ao processar o comando.';
    
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(errorMessage);
    } else {
      await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
    }
  }
});

// Slash command registration
async function registerSlashCommands() {
  const commands = [
    // Bot Owner Commands
    new SlashCommandBuilder()
      .setName('model')
      .setDescription('Gerenciar modelos de AI (apenas proprietário do bot)')
      .addSubcommand(subcommand =>
        subcommand
          .setName('set')
          .setDescription('Definir modelo de AI atual')
          .addStringOption(option =>
            option.setName('model')
              .setDescription('Modelo a ser usado')
              .setRequired(true)
              .addChoices(
                ...Object.entries(MODELS).map(([key, model]) => ({
                  name: model.displayName,
                  value: key
                }))
              )
          )
          .addNumberOption(option =>
            option.setName('temperature')
              .setDescription('Temperatura (0.0-1.0)')
              .setMinValue(0)
              .setMaxValue(1)
          )
          .addIntegerOption(option =>
            option.setName('max_tokens')
              .setDescription('Máximo de tokens (100-1000)')
              .setMinValue(100)
              .setMaxValue(1000)
          )
          .addNumberOption(option =>
            option.setName('top_p')
              .setDescription('Top P (0.1-1.0)')
              .setMinValue(0.1)
              .setMaxValue(1.0)
          )
      )
      .addSubcommand(subcommand =>
        subcommand.setName('current').setDescription('Mostrar modelo e configurações atuais')
      )
      .addSubcommand(subcommand =>
        subcommand.setName('list').setDescription('Listar todos os modelos disponíveis')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('tune')
          .setDescription('Ajustar configurações do modelo atual')
          .addNumberOption(option =>
            option.setName('temperature')
              .setDescription('Temperatura (0.0-1.0)')
              .setMinValue(0)
              .setMaxValue(1)
          )
          .addIntegerOption(option =>
            option.setName('max_tokens')
              .setDescription('Máximo de tokens (100-1000)')
              .setMinValue(100)
              .setMaxValue(1000)
          )
          .addNumberOption(option =>
            option.setName('top_p')
              .setDescription('Top P (0.1-1.0)')
              .setMinValue(0.1)
              .setMaxValue(1.0)
          )
      ),

    new SlashCommandBuilder()
      .setName('processed')
      .setDescription('Gerenciar URLs processadas (apenas proprietário do bot)')
      .addSubcommand(subcommand =>
        subcommand.setName('count').setDescription('Contar URLs processadas')
      )
      .addSubcommand(subcommand =>
        subcommand.setName('clear').setDescription('Limpar todas as URLs processadas')
      ),

    // Server Admin Commands
    new SlashCommandBuilder()
      .setName('channel')
      .setDescription('Configurar canal de notícias (apenas administradores)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand(subcommand =>
        subcommand
          .setName('set')
          .setDescription('Definir canal para receber notícias')
          .addChannelOption(option =>
            option.setName('channel')
              .setDescription('Canal para receber as notícias')
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText)
          )
      )
      .addSubcommand(subcommand =>
        subcommand.setName('current').setDescription('Mostrar canal atual')
      ),

    new SlashCommandBuilder()
      .setName('ignore')
      .setDescription('Gerenciar padrões de URL ignorados (apenas administradores)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand(subcommand =>
        subcommand
          .setName('add')
          .setDescription('Adicionar padrão de URL a ser ignorado')
          .addStringOption(option =>
            option.setName('pattern')
              .setDescription('Padrão de URL a ser ignorado (ex: sada, feminino)')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('remove')
          .setDescription('Remover padrão de URL ignorado')
          .addStringOption(option =>
            option.setName('pattern')
              .setDescription('Padrão de URL a ser removido')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand.setName('list').setDescription('Listar padrões de URL ignorados')
      ),

    // Public Commands
    new SlashCommandBuilder()
      .setName('info')
      .setDescription('Mostrar informações do bot e configurações do servidor'),

    new SlashCommandBuilder()
      .setName('help')
      .setDescription('Mostrar ajuda sobre os comandos disponíveis')
  ];

  if (client.application) {
    await client.application.commands.set(commands);
  }
}

// Slash command handlers
async function handleSlashCommand(interaction: any) {
  const { commandName, options } = interaction;

  switch (commandName) {
    case 'model':
      if (!isBotOwner(interaction.user.id)) {
        return interaction.reply({ 
          content: '❌ Apenas o proprietário do bot pode gerenciar modelos de AI.', 
          flags: MessageFlags.Ephemeral 
        });
      }
      await handleModelCommand(interaction, options);
      break;

    case 'processed':
      if (!isBotOwner(interaction.user.id)) {
        return interaction.reply({ 
          content: '❌ Apenas o proprietário do bot pode gerenciar URLs processadas.', 
          flags: MessageFlags.Ephemeral 
        });
      }
      await handleProcessedCommand(interaction, options);
      break;

    case 'channel':
      if (!isServerAdmin(interaction.member)) {
        return interaction.reply({ 
          content: '❌ Apenas administradores do servidor podem configurar o canal.', 
          flags: MessageFlags.Ephemeral 
        });
      }
      await handleChannelCommand(interaction, options);
      break;

    case 'ignore':
      if (!isServerAdmin(interaction.member)) {
        return interaction.reply({ 
          content: '❌ Apenas administradores do servidor podem gerenciar URLs ignoradas.', 
          flags: MessageFlags.Ephemeral 
        });
      }
      await handleIgnoreCommand(interaction, options);
      break;

    case 'info':
      await handleInfoCommand(interaction);
      break;

    case 'help':
      await handleHelpCommand(interaction);
      break;
  }
}

async function handleModelCommand(interaction: any, options: any) {
  const subcommand = options.getSubcommand();

  switch (subcommand) {
    case 'set':
      const model = options.getString('model');
      const temperature = options.getNumber('temperature');
      const maxTokens = options.getInteger('max_tokens');
      const topP = options.getNumber('top_p');

      await setCurrentModel(model);
      
      const settingsUpdate: any = {};
      if (temperature !== null) settingsUpdate.temperature = temperature;
      if (maxTokens !== null) settingsUpdate.max_tokens = maxTokens;
      if (topP !== null) settingsUpdate.top_p = topP;
      
      if (Object.keys(settingsUpdate).length > 0) {
        await setModelSettings(settingsUpdate);
      }

      const modelConfig = MODELS[model as keyof typeof MODELS];
      let response = `✅ Modelo definido para **${modelConfig.displayName}**`;
      
      if (Object.keys(settingsUpdate).length > 0) {
        response += '\n📊 Configurações atualizadas:';
        if (temperature !== null) response += `\n• Temperatura: ${temperature}`;
        if (maxTokens !== null) response += `\n• Max Tokens: ${maxTokens}`;
        if (topP !== null) response += `\n• Top P: ${topP}`;
      }

      await interaction.reply({ content: response, flags: MessageFlags.Ephemeral });
      break;

    case 'current':
      const currentModel = await getCurrentModel();
      const settings = await getModelSettings();
      const currentConfig = MODELS[currentModel as keyof typeof MODELS];
      
      const embed = new EmbedBuilder()
        .setTitle('🤖 Configuração Atual do Modelo')
        .addFields(
          { name: 'Modelo', value: currentConfig.displayName, inline: true },
          { name: 'Provider', value: currentConfig.provider, inline: true },
          { name: '\u200b', value: '\u200b', inline: true },
          { name: 'Temperature', value: settings.temperature.toString(), inline: true },
          { name: 'Max Tokens', value: settings.max_tokens.toString(), inline: true },
          { name: 'Top P', value: settings.top_p.toString(), inline: true }
        )
        .setColor(0x00AE86);

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      break;

    case 'list':
      const modelsList = Object.entries(MODELS)
        .map(([key, model]) => `• **${model.displayName}** (${model.provider})`)
        .join('\n');

      const listEmbed = new EmbedBuilder()
        .setTitle('📋 Modelos Disponíveis')
        .setDescription(modelsList)
        .setColor(0x00AE86);

      await interaction.reply({ embeds: [listEmbed], flags: MessageFlags.Ephemeral });
      break;

    case 'tune':
      const tuneSettings: any = {};
      const newTemp = options.getNumber('temperature');
      const newMaxTokens = options.getInteger('max_tokens');
      const newTopP = options.getNumber('top_p');

      if (newTemp !== null) tuneSettings.temperature = newTemp;
      if (newMaxTokens !== null) tuneSettings.max_tokens = newMaxTokens;
      if (newTopP !== null) tuneSettings.top_p = newTopP;

      if (Object.keys(tuneSettings).length === 0) {
        return interaction.reply({ 
          content: '❌ Pelo menos um parâmetro deve ser especificado.', 
          flags: MessageFlags.Ephemeral 
        });
      }

      await setModelSettings(tuneSettings);
      
      let tuneResponse = '✅ Configurações atualizadas:';
      if (newTemp !== null) tuneResponse += `\n• Temperatura: ${newTemp}`;
      if (newMaxTokens !== null) tuneResponse += `\n• Max Tokens: ${newMaxTokens}`;
      if (newTopP !== null) tuneResponse += `\n• Top P: ${newTopP}`;

      await interaction.reply({ content: tuneResponse, flags: MessageFlags.Ephemeral });
      break;
  }
}

async function handleProcessedCommand(interaction: any, options: any) {
  const subcommand = options.getSubcommand();

  switch (subcommand) {
    case 'count':
      const count = await getProcessedUrlsCount();
      await interaction.reply({ 
        content: `📊 Total de URLs processadas: **${count}**`, 
        flags: MessageFlags.Ephemeral 
      });
      break;

    case 'clear':
      await clearProcessedUrls();
      await interaction.reply({ 
        content: '✅ Todas as URLs processadas foram removidas.', 
        flags: MessageFlags.Ephemeral 
      });
      break;
  }
}

async function handleChannelCommand(interaction: any, options: any) {
  const subcommand = options.getSubcommand();

  switch (subcommand) {
    case 'set':
      const channel = options.getChannel('channel');
      await setServerChannel(interaction.guildId, channel.id);
      await interaction.reply({ 
        content: `✅ Canal de notícias definido para ${channel}`, 
        flags: MessageFlags.Ephemeral 
      });
      break;

    case 'current':
      const channelId = await getServerChannel(interaction.guildId);
      if (channelId) {
        const channel = interaction.guild.channels.cache.get(channelId);
        await interaction.reply({ 
          content: `📍 Canal atual: ${channel || 'Canal não encontrado'}`, 
          flags: MessageFlags.Ephemeral 
        });
      } else {
        await interaction.reply({ 
          content: '❌ Nenhum canal configurado.', 
          flags: MessageFlags.Ephemeral 
        });
      }
      break;
  }
}

async function handleIgnoreCommand(interaction: any, options: any) {
  const subcommand = options.getSubcommand();

  switch (subcommand) {
    case 'add':
      const addPattern = options.getString('pattern').toLowerCase();
      const currentIgnoreUrls = await getServerIgnoreUrls(interaction.guildId);
      
      if (currentIgnoreUrls.includes(addPattern)) {
        return interaction.reply({ 
          content: `❌ O padrão "${addPattern}" já está na lista.`, 
          flags: MessageFlags.Ephemeral 
        });
      }

      currentIgnoreUrls.push(addPattern);
      await setServerIgnoreUrls(interaction.guildId, currentIgnoreUrls);
      await interaction.reply({ 
        content: `✅ Padrão "${addPattern}" adicionado à lista de ignorados.`, 
        flags: MessageFlags.Ephemeral 
      });
      break;

    case 'remove':
      const removePattern = options.getString('pattern').toLowerCase();
      const ignoreUrls = await getServerIgnoreUrls(interaction.guildId);
      const index = ignoreUrls.indexOf(removePattern);
      
      if (index === -1) {
        return interaction.reply({ 
          content: `❌ O padrão "${removePattern}" não está na lista.`, 
          flags: MessageFlags.Ephemeral 
        });
      }

      ignoreUrls.splice(index, 1);
      await setServerIgnoreUrls(interaction.guildId, ignoreUrls);
      await interaction.reply({ 
        content: `✅ Padrão "${removePattern}" removido da lista de ignorados.`, 
        flags: MessageFlags.Ephemeral 
      });
      break;

    case 'list':
      const listIgnoreUrls = await getServerIgnoreUrls(interaction.guildId);
      const listText = listIgnoreUrls.length > 0 
        ? listIgnoreUrls.map(pattern => `• ${pattern}`).join('\n')
        : 'Nenhum padrão configurado.';

      const embed = new EmbedBuilder()
        .setTitle('🚫 Padrões de URL Ignorados')
        .setDescription(listText)
        .setColor(0xFF6B6B);

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      break;
  }
}

async function handleInfoCommand(interaction: any) {
  const currentModel = await getCurrentModel();
  const settings = await getModelSettings();
  const modelConfig = MODELS[currentModel];
  const channelId = await getServerChannel(interaction.guildId);
  const ignoreUrls = await getServerIgnoreUrls(interaction.guildId);
  const processedCount = await getProcessedUrlsCount();

  const channel = channelId ? interaction.guild.channels.cache.get(channelId) : null;

  const embed = new EmbedBuilder()
    .setTitle('ℹ️ Informações do Bot')
    .addFields(
      { name: '🤖 Modelo AI Atual', value: modelConfig.displayName, inline: true },
      { name: '🎛️ Temperature', value: settings.temperature.toString(), inline: true },
      { name: '📊 Max Tokens', value: settings.max_tokens.toString(), inline: true },
      { name: '📍 Canal de Notícias', value: channel ? channel.toString() : 'Não configurado', inline: true },
      { name: '🚫 URLs Ignoradas', value: ignoreUrls.length > 0 ? ignoreUrls.join(', ') : 'Nenhuma', inline: true },
      { name: '📈 URLs Processadas', value: processedCount.toString(), inline: true }
    )
    .setColor(0x00AE86)
    .setFooter({ text: 'Central da Toca News Bot' });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleHelpCommand(interaction: any) {
  const isOwner = isBotOwner(interaction.user.id);
  const isAdmin = isServerAdmin(interaction.member);

  let helpText = '**📋 Comandos Disponíveis:**\n\n';
  
  // Public commands
  helpText += '**👥 Comandos Públicos:**\n';
  helpText += '• `/info` - Mostrar informações do bot e configurações\n';
  helpText += '• `/help` - Mostrar esta ajuda\n\n';

  // Admin commands
  if (isAdmin) {
    helpText += '**👑 Comandos de Administrador:**\n';
    helpText += '• `/channel set` - Definir canal para receber notícias\n';
    helpText += '• `/channel current` - Mostrar canal atual\n';
    helpText += '• `/ignore add` - Adicionar padrão de URL ignorado\n';
    helpText += '• `/ignore remove` - Remover padrão de URL ignorado\n';
    helpText += '• `/ignore list` - Listar padrões ignorados\n\n';
  }

  // Owner commands
  if (isOwner) {
    helpText += '**🔧 Comandos do Proprietário:**\n';
    helpText += '• `/model set` - Definir modelo AI e configurações\n';
    helpText += '• `/model current` - Mostrar modelo e configurações atuais\n';
    helpText += '• `/model list` - Listar todos os modelos disponíveis\n';
    helpText += '• `/model tune` - Ajustar configurações do modelo\n';
    helpText += '• `/processed count` - Contar URLs processadas\n';
    helpText += '• `/processed clear` - Limpar URLs processadas\n\n';
  }

  helpText += '**ℹ️ Sobre:**\n';
  helpText += 'Este bot monitora notícias do Central da Toca e envia resumos gerados por AI.\n';
  helpText += 'Verifica novas notícias a cada 60 segundos.';

  const embed = new EmbedBuilder()
    .setTitle('🤖 Central da Toca News Bot - Ajuda')
    .setDescription(helpText)
    .setColor(0x00AE86);

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// Send single news item to all configured channels
async function sendNewsToAllChannels(title: string, summary: string, url: string, imageUrl?: string): Promise<void> {
  const guilds = client.guilds.cache.values();
  let sentCount = 0;

  for (const guild of guilds) {
    try {
      const channelId = await getServerChannel(guild.id);
      if (!channelId) continue;

      const channel = guild.channels.cache.get(channelId);
      if (!channel || channel.type !== ChannelType.GuildText) continue;

      // Check if this server ignores this URL
      if (await shouldIgnoreUrlForServer(url, guild.id)) {
        continue; // Skip this server
      }

      try {
        // Create simple message format: Title + Summary + Link
        let message = `**${title}**\n\n${summary}\n\n🔗 ${url}`;
        
        // If we have an image, send it as attachment/embed
        const messageOptions: any = { content: message };
        
        if (imageUrl) {
          // Try to send with embed for image
          try {
            const embed = new EmbedBuilder()
              .setImage(imageUrl)
              .setColor(0x00AE86);
            
            messageOptions.embeds = [embed];
          } catch (imgError) {
            console.log('Erro ao adicionar imagem, enviando sem:', imgError);
          }
        }

        await (channel as any).send(messageOptions);
        console.log(`📤 Notícia enviada para ${guild.name}: ${title}`);
        sentCount++;
        
      } catch (error) {
        console.error(`❌ Erro ao enviar para ${guild.name}:`, error);
      }
    } catch (error) {
      console.error(`❌ Erro ao processar servidor ${guild.name}:`, error);
    }
  }
  
  if (sentCount > 0) {
    console.log(`✅ Notícia enviada para ${sentCount} canal(is): ${title}`);
  }
}

// Check if bot has any configured channels
async function hasConfiguredChannels(): Promise<boolean> {
  try {
    const guilds = client.guilds.cache;
    for (const guild of guilds.values()) {
      const channelId = await getServerChannel(guild.id);
      if (channelId) {
        const channel = guild.channels.cache.get(channelId);
        if (channel && channel.type === ChannelType.GuildText) {
          return true;
        }
      }
    }
    return false;
  } catch (error) {
    console.error('Erro ao verificar canais configurados:', error);
    return false;
  }
}

// Função principal que coordena o fluxo de extração e envio das notícias
async function main(): Promise<void> {
  if (isRunning) {
    console.log('A execução anterior ainda está em andamento. Aguardando...');
    return;
  }
  
  // Check if we have any configured channels before processing
  const hasChannels = await hasConfiguredChannels();
  if (!hasChannels) {
    console.log('⏸️ Nenhum canal configurado. Use /channel set para configurar um canal primeiro.');
    return;
  }
  
  isRunning = true;
  console.log('🔍 Verificando novas notícias...');
  
  try {
    const newsItems = await scrapeNews();
    let newNewsCount = 0;
    
    for (const news of newsItems) {
      if (!(await isUrlProcessed(news.url))) {
        console.log(`🆕 Nova notícia encontrada: ${news.title}`);
        await processAndSendNews(news);
        await markUrlAsProcessed(news.url);
        newNewsCount++;
      }
    }
    
    if (newNewsCount === 0) {
      console.log('📭 Nenhuma notícia nova encontrada.');
    } else {
      console.log(`📊 Total de ${newNewsCount} notícias novas processadas.`);
    }
    
    console.log('✅ Verificação de notícias concluída.');
  } catch (error) {
    console.error('❌ Erro no loop principal:', error);
  } finally {
    isRunning = false;
  }
}

// Initialize connections and start bot
(async () => {
  try {
    await redis.connect();
    await client.login(DISCORD_BOT_TOKEN);
  } catch (err) {
    console.error('Erro ao conectar:', err);
    process.exit(1);
  }
})();