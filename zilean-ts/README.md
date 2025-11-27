# Zilean (TypeScript Edition)

A torrent metadata aggregator and Torznab indexer, rewritten in TypeScript with Bun.

## Features

- **DMM Scraping**: Automatically scrapes torrent metadata from DebridMediaManager hashlists
- **Generic Ingestion**: Supports importing from Zurg instances, other Zilean instances, and generic HTTP endpoints
- **Torznab API**: Standard Torznab API for integration with Sonarr, Radarr, and other media managers
- **IMDB Integration**: Search and match IMDB metadata
- **Full-Text Search**: PostgreSQL-powered trigram search for fuzzy matching
- **Blacklist Management**: Block unwanted torrents from search results

## Quick Start

### Using Docker Compose

```bash
docker compose up -d
```

This starts both Zilean and PostgreSQL. Access the API at `http://localhost:8181`.

### Local Development

1. Install dependencies:
   ```bash
   bun install
   ```

2. Start PostgreSQL (with pg_trgm extension):
   ```bash
   docker run -d --name zilean-postgres \
     -e POSTGRES_USER=zilean \
     -e POSTGRES_PASSWORD=zilean \
     -e POSTGRES_DB=zilean \
     -p 5432:5432 \
     postgres:16-alpine \
     -c 'shared_preload_libraries=pg_trgm'
   ```

3. Run database migrations:
   ```bash
   bun run db:push
   ```

4. Start the development server:
   ```bash
   bun run dev
   ```

## Configuration

Configuration is loaded from environment variables and `data/config.json`.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://zilean:zilean@localhost:5432/zilean` |
| `ZILEAN_PORT` | HTTP server port | `8181` |
| `ZILEAN_HOST` | HTTP server host | `0.0.0.0` |
| `ZILEAN_API_KEY` | API key (auto-generated if not set) | - |
| `ZILEAN_DATA_DIR` | Data directory path | `./data` |
| `ZILEAN_DMM_ENABLE_SCRAPING` | Enable DMM scraping | `true` |
| `ZILEAN_DMM_SCHEDULE` | DMM scrape schedule (cron) | `0 * * * *` |
| `ZILEAN_INGESTION_ENABLE_SCRAPING` | Enable generic ingestion | `true` |
| `ZILEAN_INGESTION_SCHEDULE` | Ingestion schedule (cron) | `0 */6 * * *` |

### Configuration File

Additional settings can be configured in `data/config.json`:

```json
{
  "apiKey": "your-api-key",
  "dmm": {
    "enableScraping": true,
    "enableEndpoint": true,
    "scrapeSchedule": "0 * * * *",
    "maxFilteredResults": 200,
    "minimumScoreMatch": 0.85
  },
  "ingestion": {
    "enableScraping": true,
    "scrapeSchedule": "0 */6 * * *",
    "zurgInstances": [
      { "name": "my-zurg", "url": "http://zurg:9999", "apiKey": "optional" }
    ],
    "zileanInstances": [],
    "genericEndpoints": []
  },
  "torznab": {
    "enableEndpoint": true
  }
}
```

## API Endpoints

### DMM Search

- `POST /dmm/search` - Simple text search
  ```json
  { "query": "movie name" }
  ```

- `GET /dmm/filtered` - Advanced filtered search
  ```
  /dmm/filtered?query=movie&year=2024&resolution=1080p
  ```

- `GET /dmm/on-demand-scrape` - Trigger DMM sync (requires API key)

### Torznab

- `GET /torznab/api?t=caps` - Capabilities
- `GET /torznab/api?t=search&q=...` - Search
- `GET /torznab/api?t=tvsearch&q=...&season=1&ep=1` - TV search
- `GET /torznab/api?t=movie&q=...&imdbid=tt1234567` - Movie search

### IMDB

- `POST /imdb/search` - Search IMDB metadata
  ```json
  { "query": "movie name", "year": 2024 }
  ```

### Torrents

- `GET /torrents/all` - Stream all torrents (requires API key)
- `GET /torrents/checkcached?hashes=...` - Check if hashes exist (requires API key)
- `GET /torrents/count` - Get total torrent count

### Blacklist

- `GET /blacklist` - List blacklisted items (requires API key)
- `PUT /blacklist/add` - Add to blacklist (requires API key)
- `DELETE /blacklist/remove` - Remove from blacklist (requires API key)

### Health

- `GET /health` - Health status
- `GET /health/ping` - Simple ping
- `GET /health/stats` - Service statistics

## Integration with Sonarr/Radarr

1. Go to Settings > Indexers > Add
2. Select "Torznab"
3. Configure:
   - URL: `http://zilean:8181/torznab/api`
   - API Key: Your Zilean API key
4. Test and save

## Development

```bash
# Install dependencies
bun install

# Run development server with hot reload
bun run dev

# Type checking
bun run typecheck

# Generate database migrations
bun run db:generate

# Apply migrations
bun run db:push

# Open Drizzle Studio
bun run db:studio
```

## Tech Stack

- **Runtime**: Bun
- **Framework**: Hono
- **Database**: PostgreSQL with Drizzle ORM
- **Search**: PostgreSQL pg_trgm extension
- **Scheduling**: Croner

## License

MIT
