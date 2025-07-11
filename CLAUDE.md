# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js TypeScript web scraper application that monitors news from "Central da Toca" website. It extracts news articles, generates AI-powered summaries using DeepSeek API, and sends formatted notifications to Discord via webhook.

## Commands

### Development
- `pnpm install` - Install dependencies
- `pnpm run start` - Start development server with hot reloading (watches TypeScript files)
- `pnpm run build` - Compile TypeScript to JavaScript (outputs to `dist/` directory)
- `pnpm run start:prod` - Run compiled JavaScript in production mode

### Docker
- `docker-compose up -d` - Start the application in Docker container
- `docker-compose down` - Stop the Docker container
- `docker-compose logs -f` - Follow container logs

## Architecture

### Core Application Flow
1. **Main Loop** (`src/index.ts`): Runs every 60 seconds, checking for new news articles
2. **Web Scraping**: Fetches news from two URLs using Axios and parses HTML with Cheerio
3. **Content Processing**: Extracts full article content from individual news pages
4. **AI Summarization**: Uses DeepSeek API to generate concise summaries (max 1700 chars)
5. **Discord Notification**: Sends formatted messages to Discord webhook
6. **State Persistence**: Tracks processed URLs in `processedNews.json` to avoid duplicates

### Key Components

#### Environment Variables
Required in `.env` file:
- `DISCORD_WEBHOOK_URL`: Discord webhook URL for sending notifications
- `DEEPSEEK_API_KEY`: DeepSeek API key for AI summarization

Note: The `.env.example` file needs to be updated to include `DEEPSEEK_API_KEY`

#### Data Persistence
- `src/processedNews.json`: Stores processed news URLs to prevent duplicate notifications
- `src/ignoredUrls.json`: Contains URL segments to filter out unwanted content (e.g., "sada", "feminino")

#### Docker Configuration
- Uses Node.js 20 Alpine image with pnpm package manager
- Mounts `processedNews.json` as volume for data persistence across container restarts
- Runs compiled JavaScript in production mode

### Error Handling
- Falls back to sending original content if AI summarization fails
- Handles missing configuration files gracefully
- Prevents concurrent executions with `isRunning` flag

## Development Workflow

### Adding New Features
1. Modify `src/index.ts` - all application logic is in this single file
2. Test locally with `pnpm run start`
3. Build with `pnpm run build` before deploying
4. Update Docker image if deploying via Docker

### Modifying Scraping Logic
- News extraction selectors: `.tdb_module_loop.td_module_wrap` and `.td_module_flex.td_module_flex_1`
- Full content selector: `div.td-post-content`
- Update these in `scrapeNews()` and `getFullNewsSummary()` functions

### Changing AI Behavior
- Modify the prompt in `processNewsItem()` function
- Adjust DeepSeek parameters: `temperature` (0.5) and `max_tokens` (350)

## Important Notes

- The application uses a single-file architecture - all logic is in `src/index.ts`
- File paths are adjusted when running from `dist/` to maintain access to configuration files
- Discord webhook has a 2000 character limit, summaries are kept under 1700 characters
- The scraper runs continuously with 1-minute intervals between checks
- No testing framework is currently configured - the test script will exit with an error
- The `openai` package is installed but not currently used (only DeepSeek API is implemented)
- TypeScript strict mode is enabled for better type safety

## Common Issues and Solutions

### Missing Environment Variables
If the application crashes on startup, ensure both `DISCORD_WEBHOOK_URL` and `DEEPSEEK_API_KEY` are set in your `.env` file.

### Docker Volume Permissions
If running in Docker and the container can't write to `processedNews.json`, ensure the file exists and has proper permissions before starting the container.

### API Rate Limits
The DeepSeek API may have rate limits. If you encounter 429 errors, consider adding retry logic or increasing the interval between checks.