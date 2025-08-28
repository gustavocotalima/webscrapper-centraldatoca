# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js TypeScript Discord bot that monitors news from "Central da Toca" website. It extracts news articles, generates AI-powered summaries using multiple AI models, and sends formatted notifications to Discord channels. Features multi-server support with per-server configuration and role-based permissions. Uses Redis for lightweight, persistent data storage.

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
3. **Web Scraping**: Fetches news from two URLs using Axios and parses HTML with Cheerio
4. **Multi-Model AI**: Supports 5 AI models (DeepSeek, Gemini, GPT) with tunable parameters
5. **Discord Distribution**: Sends formatted embeds to configured channels per server
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
- `server:{guild_id}:channel`: Configured news channel for each server
- `server:{guild_id}:ignore_urls`: Server-specific ignored URL patterns (empty by default)

#### Discord Bot Architecture
**Permission Levels:**
- **Bot Owner** (your user ID): Global AI model management
- **Server Admins**: Per-server channel and ignore URL configuration
- **Everyone**: View-only info commands

**Multi-Server Features:**
- Auto-setup when joining new servers
- Independent channel configuration per server
- Server-specific URL filtering patterns
- Shared AI model settings across all servers

### Error Handling
- Falls back to sending original content if AI summarization fails
- Handles missing configuration files gracefully
- Prevents concurrent executions with `isRunning` flag

## Development Workflow

### Adding New Features
1. Modify `src/index.ts` - complete Discord bot implementation
2. Test locally with `pnpm run start`
3. Build with `pnpm run build` before deploying
4. Register new slash commands in `registerSlashCommands()` function
5. Update Docker image if deploying via Docker

### Available AI Models
- **DeepSeek Chat**: Default model, always available
- **Gemini 2.0 Flash**: Fast Google model (requires `GOOGLE_AI_API_KEY`)
- **Gemini 2.0 Flash Lite**: Lightweight Google model
- **GPT-4o Mini**: OpenAI model (requires `OPENAI_API_KEY`)
- **GPT-5 Nano**: Latest OpenAI model

### Slash Commands
**Bot Owner Commands:**
- `/model set` - Change AI model and parameters
- `/model current` - View current model settings
- `/processed count/clear` - Manage processed URLs

**Server Admin Commands:**
- `/channel set` - Configure news channel
- `/ignore add/remove/list` - Manage ignored URL patterns

**Public Commands:**
- `/info` - View bot and server status
- `/help` - Command help

### Bot Setup Process
1. **Create Discord Application**: https://discord.com/developers/applications
2. **Get Bot Token**: Copy from Bot section
3. **Get Your User ID**: Enable Developer Mode in Discord, right-click your name
4. **Set Environment Variables**: Configure `.env` file
5. **Invite Bot**: Generate invite URL with "applications.commands" and "bot" scopes
6. **Required Permissions**: Send Messages, Use Slash Commands, Embed Links

## Important Notes

- The Discord bot uses a single-file architecture - all logic is in `src/index.ts`
- Redis connection is established on startup and handles reconnection automatically
- Multi-server support with isolated per-server configurations
- Global AI model management restricted to bot owner via user ID
- News monitoring runs continuously with 1-minute intervals
- Slash commands provide intuitive Discord-native interface
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