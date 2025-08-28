# Central da Toca News Bot

A Discord bot that monitors news from Central da Toca website and sends AI-powered summaries to Discord servers.

## Features

- 🤖 **Multi-server Discord bot** with slash commands
- 🧠 **Multiple AI models** support (DeepSeek, Google Gemini, OpenAI GPT)
- 📰 **Rich Discord embeds** with clickable titles, images, and categories
- 🔄 **Automatic news monitoring** every 60 seconds
- 🗃️ **Redis persistence** to prevent duplicate news on deployments
- ⚡ **Immediate sending** - news sent as soon as processed
- 🖼️ **Image extraction** from news articles
- 🎯 **Per-server configuration** with channel and ignore patterns
- 👑 **Role-based permissions** (bot owner vs server admin)

## Bot Commands

### Public Commands
- `/info` - Show bot information and server configuration
- `/help` - Show available commands

### Server Admin Commands (requires Administrator permission)
- `/channel set` - Set channel to receive news notifications
- `/channel current` - Show current configured channel
- `/ignore add` - Add URL pattern to ignore (e.g., "sada", "feminino")
- `/ignore remove` - Remove URL pattern from ignore list
- `/ignore list` - List all ignored URL patterns

### Bot Owner Commands (requires BOT_OWNER_USER_ID)
- `/model set` - Change AI model and settings
- `/model current` - Show current AI model and settings
- `/model list` - List all available AI models
- `/model tune` - Adjust AI model parameters
- `/processed count` - Count processed URLs
- `/processed clear` - Clear all processed URLs

## Setup

### Environment Variables

Create a `.env` file with:

```env
DISCORD_BOT_TOKEN=your_discord_bot_token
BOT_OWNER_USER_ID=your_discord_user_id
DEEPSEEK_API_KEY=your_deepseek_api_key
OPENAI_API_KEY=your_openai_api_key (optional)
GOOGLE_AI_API_KEY=your_google_ai_api_key (optional)
REDIS_URL=redis://localhost:6379
```

### Discord Bot Setup

1. Create a Discord application at https://discord.com/developers/applications
2. Create a bot and get the token
3. Invite bot to servers with these scopes:
   - `bot`
   - `applications.commands`
4. Bot permissions needed:
   - Send Messages
   - Use Slash Commands
   - Embed Links
   - Attach Files

### Installation

```bash
pnpm install
pnpm run build
pnpm run start:prod
```

### Docker

```bash
docker-compose up -d
```

## Architecture

- **Multi-server support**: Each server has independent channel and ignore pattern configuration
- **Redis persistence**: Stores processed URLs, server settings, and AI model configuration
- **AI model switching**: Bot owner can switch between different AI providers and models
- **Immediate processing**: News articles are sent immediately after AI processing (no batching)
- **Rich embeds**: News displayed with Central da Toca branding, clickable titles, and extracted images

## News Format

Each news article is sent as a Discord embed with:
- **Author**: "Central da Toca" (clickable link to main site)
- **Title**: Article title (clickable link to full article)
- **Description**: AI-generated summary (max 1700 characters)
- **Image**: Extracted from article (if available)
- **Footer**: Category (e.g., "Redes sociais", "Mercado")
- **Color**: Blue (#0F3BAA)
- **Timestamp**: When sent

## Supported AI Models

- **DeepSeek Chat** (default)
- **Google Gemini 2.0 Flash**
- **Google Gemini 2.0 Flash Lite**
- **OpenAI GPT-4o Mini**
- **OpenAI GPT-5 Nano**

## Technical Details

- Built with TypeScript and Node.js
- Uses Discord.js v14 for bot functionality
- Redis for lightweight persistent storage
- Cheerio for web scraping
- Axios for HTTP requests
- Supports ES2020+ features
