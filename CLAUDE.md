# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js TypeScript Discord bot that monitors news from "Central da Toca" website. It extracts news articles, generates AI-powered summaries using multiple AI models, and sends formatted notifications to Discord channels. Features multi-server support with **multi-channel** per-server configuration, per-channel category allowlists, per-channel ignore patterns, and role-based permissions. Uses Redis for lightweight, persistent data storage.

## Commands

### Development
- `pnpm install` - Install dependencies
- `pnpm run start` - Start Discord bot in development mode with hot reloading
- `pnpm run build` - Compile TypeScript to JavaScript (outputs to `dist/` directory)
- `pnpm run start:prod` - Run compiled Discord bot in production mode

### Docker
- `docker-compose up -d` - Start the application in Docker container
- `docker-compose down` - Stop the Docker container
- `docker-compose logs -f` - Follow container logs

## Architecture

### Core Application Flow
1. **Discord Bot** (`src/index.ts`): Multi-server bot with slash commands and role-based permissions
2. **News Monitoring Loop**: Runs every 60 seconds, checking for new news articles
3. **Web Scraping**:
   - Fetches from two URLs: `ULTIMAS_URL` (https://centraldatoca.com.br/ultimas/) and `HOME_URL` (homepage)
   - Parses news list with Cheerio using CSS selectors (`div.tdb_module_loop.td_module_wrap` and `div.td_module_flex.td_module_flex_1`)
   - Follows each article link to extract full content from `div.td-post-content`
   - Extracts images using multiple selectors (og:image, featured image, first content image)
   - Handles bullet points and lists from HTML (`ul`, `ol`, `li` tags)
4. **Multi-Model AI**: Supports 5 AI models (DeepSeek, Gemini, GPT) with tunable parameters
5. **Discord Distribution**: Sends formatted embeds to configured channels per server (immediate sending, no batching)
6. **State Persistence**: Uses Redis for global/per-server settings and processed URLs

### Key Components

#### Environment Variables
Required in `.env` file:
- `DISCORD_BOT_TOKEN`: Discord bot token for authentication
- `BOT_OWNER_USER_ID`: Your Discord user ID for global model management
- `DEEPSEEK_API_KEY`: DeepSeek API key (required)
- `OPENAI_API_KEY`: OpenAI API key (optional - for GPT models)
- `GOOGLE_AI_API_KEY`: Google AI API key (optional - for Gemini models)
- `REDIS_URL`: Redis connection URL (defaults to `redis://localhost:6379`)

#### Data Persistence
**Global Data (shared across servers):**
- `processed_urls`: Set of processed news URLs to prevent duplicates
- `global:current_model`: Current AI model selection
- `global:model_settings`: AI model parameters (temperature, max_tokens, top_p)

**Per-Server Data:**
- `server:{guild_id}:channels`: Set of channel IDs configured for news notifications (supports multiple channels per server)
- `server:{guild_id}:channel:{channel_id}:allowlist`: Per-channel category allowlist (JSON array) - if set, only news from these categories are sent to this channel
- `server:{guild_id}:channel:{channel_id}:ignore`: Per-channel ignore URL patterns (JSON array) - only used if channel has no allowlist

#### Discord Bot Architecture
**Permission Levels:**
- **Bot Owner** (your user ID): Global AI model management
- **Server Admins**: Per-server channel and ignore URL configuration
- **Everyone**: View-only info commands

**Multi-Server & Multi-Channel Features:**
- Auto-setup when joining new servers (selects first text channel with send permissions)
- Multiple channels per server support (use `/channel add` to configure)
- Per-channel category allowlists (override ignore patterns when set)
- Per-channel ignore URL patterns (only active when channel has no allowlist)
- Shared AI model settings across all servers
- Category extraction from news URLs (e.g., "futebol", "basquete", "mercado")

### Filtering Logic
The bot uses a sophisticated two-tier filtering system:

1. **Global Check (AI Optimization)**: Before processing with AI, checks if ALL channels across ALL servers would ignore the URL. If yes, skips AI processing entirely to save costs.

2. **Per-Channel Filtering** (applied when sending):
   - **If channel has allowlist**: Only news matching allowlisted categories are sent. Ignore patterns are completely bypassed.
   - **If channel has no allowlist**: Uses ignore patterns to filter out unwanted news.
   - Pattern matching: Checks if URL contains `/{pattern}/` (e.g., pattern "feminino" matches URLs with `/feminino/`)

3. **Category Extraction**: Categories are extracted from the first path segment of the URL (e.g., `https://centraldatoca.com.br/futebol/article-name/` → category: "futebol")

### Error Handling
- Falls back to sending original content if AI summarization fails
- Handles missing configuration files gracefully
- Prevents concurrent executions with `isRunning` flag
- Retry logic with exponential backoff for network requests (default: 3 retries)
- Special handling for 429 rate limit errors (respects Retry-After headers)

## Development Workflow

### Adding New Features
1. Modify `src/index.ts` - complete Discord bot implementation
2. Test locally with `pnpm run start`
3. Build with `pnpm run build` before deploying
4. Register new slash commands in `registerSlashCommands()` function
5. Update Docker image if deploying via Docker

### Available AI Models
- **DeepSeek Chat**: Default model, always available (required as fallback)
- **Gemini 2.0 Flash**: Fast Google model (requires `GOOGLE_AI_API_KEY`)
- **Gemini 2.0 Flash Lite**: Lightweight Google model (uses gemini-2.0-flash-lite)
- **Gemini 2.5 Flash Lite**: Latest Gemini model (uses gemini-2.5-flash-lite)
- **GPT-4o Mini**: OpenAI model (requires `OPENAI_API_KEY`)
- **GPT-5 Nano**: Latest OpenAI model

### AI Prompt Engineering
The bot's AI prompt is carefully crafted to:
- Limit summaries to 1700 characters max (Discord embed description limit)
- **Avoid repeating the title** (title is displayed separately in the embed)
- Focus on information that aligns with the title
- Preserve important lists (TV channels, schedules, locations) using bullet points
- Never mention that content is AI-generated or scraped
- Start directly with news information without meta-commentary

### Slash Commands
**Bot Owner Commands:**
- `/model set` - Change AI model and parameters (temperature, max_tokens, top_p)
- `/model current` - View current model settings
- `/model list` - List all available AI models
- `/model tune` - Adjust AI model parameters without changing model
- `/processed count` - Count processed URLs
- `/processed clear` - Clear all processed URLs

**Server Admin Commands:**
- `/channel add <channel>` - Add channel to receive news notifications
- `/channel remove <channel>` - Remove channel from news notifications
- `/channel list` - List all configured channels with their filters
- `/ignore add <channel> <pattern>` - Add ignore pattern for specific channel
- `/ignore remove <channel> <pattern>` - Remove ignore pattern from channel
- `/ignore list <channel>` - List ignore patterns for channel
- `/ignore clear <channel>` - Clear all ignore patterns from channel
- `/allowlist add <channel> <category>` - Add category to channel allowlist (overrides ignores)
- `/allowlist remove <channel> <category>` - Remove category from allowlist
- `/allowlist list <channel>` - Show channel's allowlist
- `/allowlist clear <channel>` - Clear channel allowlist (reverts to ignore patterns)

**Public Commands:**
- `/info` - View bot and server status (includes AI disclaimer)
- `/help` - Command help (filtered by user permissions)

### Discord Embed Format
News articles are sent as rich embeds with:
- **Author**: "Central da Toca" (clickable link to main site) with logo icon
- **Title**: Article title (clickable link to full article)
- **Description**: AI-generated summary (max 1700 characters)
- **Image**: Extracted featured image (if available)
- **Footer**: Category name (formatted with spaces and capitalization, e.g., "Mercado", "Redes sociais")
- **Color**: Brand blue (#0F3BAA)
- **Timestamp**: When the news was sent

### Bot Setup Process
1. **Create Discord Application**: https://discord.com/developers/applications
2. **Get Bot Token**: Copy from Bot section
3. **Get Your User ID**: Enable Developer Mode in Discord, right-click your name
4. **Set Environment Variables**: Configure `.env` file
5. **Invite Bot**: Generate invite URL with "applications.commands" and "bot" scopes
6. **Required Permissions**: Send Messages, Use Slash Commands, Embed Links, Attach Files

## Important Notes

- The Discord bot uses a single-file architecture - all logic is in `src/index.ts`
- Redis connection is established on startup and handles reconnection automatically
- Multi-server support with isolated per-server configurations
- **Multi-channel support**: Each server can have multiple channels with independent filtering
- **Filtering priority**: Allowlists override ignore patterns. If a channel has an allowlist, ignore patterns are not applied
- **Smart AI optimization**: If all channels would ignore a URL, AI processing is skipped entirely
- Global AI model management restricted to bot owner via user ID
- News monitoring runs continuously with 1-minute intervals
- Slash commands provide intuitive Discord-native interface
- Categories are extracted from URL paths (e.g., `centraldatoca.com.br/futebol/...` → category: "futebol")
- All bot responses include AI disclaimers where appropriate
- No testing framework is currently configured - the test script will exit with an error
- TypeScript strict mode is enabled for better type safety

## Common Issues and Solutions

### Missing Environment Variables
If the bot crashes on startup, ensure `DISCORD_BOT_TOKEN`, `BOT_OWNER_USER_ID`, and `DEEPSEEK_API_KEY` are set in your `.env` file.

### Discord Bot Issues
- **Bot not responding**: Check bot permissions in server settings
- **Slash commands not appearing**: Ensure bot has "applications.commands" scope
- **Permission errors**: Verify your user ID matches `BOT_OWNER_USER_ID`

### Redis Connection Issues
If the bot fails to connect to Redis, verify the `REDIS_URL` is correct and the Redis instance is running and accessible.

### AI Model Errors
- Missing API keys will disable specific models but won't crash the bot
- DeepSeek is the fallback model and must always be available
- Rate limiting is handled with exponential backoff retry logic

### API Rate Limits
The DeepSeek API may have rate limits. If you encounter 429 errors, consider adding retry logic or increasing the interval between checks.

## Common Development Scenarios

### Adding a New AI Model
1. Add entry to `MODELS` object in src/index.ts:38 with provider, model name, and display name
2. Implement provider logic in `callAIModel()` function if using a new provider
3. Update slash command choices in `registerSlashCommands()` (auto-generated from MODELS)

### Modifying Web Scraping Selectors
If Central da Toca changes their website structure:
1. Update CSS selectors in `scrapeNews()` function (src/index.ts:464)
2. Update content extraction in `getFullNewsContent()` function (src/index.ts:405)
3. Test by running `pnpm run start` and monitoring console output

### Adjusting AI Prompt
The AI prompt is in `processAndSendNews()` function (src/index.ts:533). Key constraints:
- 1700 character limit (Discord embed description)
- Must avoid title repetition
- Should preserve important structured information (lists, schedules)

### Adding New Slash Commands
1. Create command definition in `registerSlashCommands()` (src/index.ts:609)
2. Add handler case in `handleSlashCommand()` (src/index.ts:858)
3. Create handler function following existing patterns
4. Update permission checks if needed