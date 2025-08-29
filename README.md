# Central da Toca News Bot

A Discord bot that monitors news from Central da Toca website and sends AI-powered summaries to Discord servers.

## Features

- 🤖 **Multi-server Discord bot** with slash commands
- 📺 **Multi-channel support** - configure multiple channels per server
- 🏷️ **Category allowlists** - filter news by category per channel
- 🧠 **Multiple AI models** support (DeepSeek, Google Gemini, OpenAI GPT)
- 📰 **Rich Discord embeds** with clickable titles, images, and categories
- 🔄 **Automatic news monitoring** every 60 seconds
- 🗃️ **Redis persistence** to prevent duplicate news on deployments
- ⚡ **Immediate sending** - news sent as soon as processed
- 🖼️ **Image extraction** from news articles
- 🎯 **Advanced filtering** with per-channel allowlists and per-channel ignore patterns
- 👑 **Role-based permissions** (bot owner vs server admin)

## Bot Commands

### Public Commands
- `/info` - Show bot information and server configuration
- `/help` - Show available commands

### Server Admin Commands (requires Administrator permission)

**Channel Management:**
- `/channel add` - Add channel to receive news notifications
- `/channel remove` - Remove channel from news notifications
- `/channel list` - List all configured channels

**Global Filters:**
- `/ignore add <channel> <pattern>` - Add ignore pattern for specific channel
- `/ignore remove <channel> <pattern>` - Remove ignore pattern from channel  
- `/ignore list <channel>` - List channel's ignore patterns
- `/ignore clear <channel>` - Clear all ignore patterns from channel

**Per-Channel Allowlists:**
- `/allowlist add <channel> <category>` - Allow specific category for a channel
- `/allowlist remove <channel> <category>` - Remove category from channel allowlist
- `/allowlist list <channel>` - Show allowed categories for a channel
- `/allowlist clear <channel>` - Clear allowlist (allow all categories)

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

- **Multi-channel system**: Configure multiple channels per server for different news categories
- **Smart filtering**: Per-channel allowlists override server-wide ignore patterns
- **Redis persistence**: Stores processed URLs, multi-channel configuration, and AI model settings
- **AI model switching**: Bot owner can switch between different AI providers and models
- **Immediate processing**: News articles are sent immediately after AI processing (no batching)
- **Rich embeds**: News displayed with Central da Toca branding, clickable titles, and extracted images

## Filtering Logic

1. **Channel has allowlist**: Only news matching allowlisted categories are sent
2. **Channel has no allowlist**: Uses per-channel ignore patterns
3. **Priority**: Allowlists override ignore patterns (if allowlist exists, ignore patterns are ignored)
4. **Per-channel control**: Each channel has independent filtering configuration

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

## Usage Examples

### Multi-Channel Setup
```
# Add channels
/channel add #football
/channel add #basketball
/channel add #general-news

# Configure category filtering
/allowlist add #football futebol
/allowlist add #basketball basquete
# #general-news gets all news (no allowlist)

# Result:
# - #football: Only soccer/football news
# - #basketball: Only basketball news  
# - #general-news: All news (unless server has ignore patterns)
```

### Per-Channel Filtering
```
# Configure different ignore patterns per channel
/ignore add #general-news feminino
/ignore add #general-news sada
/ignore add #sports-news apostas

# Each channel has independent ignore patterns
# Channels with allowlists will ignore these patterns completely
```
