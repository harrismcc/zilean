import { Hono } from "hono";
import { getTorrentCount } from "../services/torrent.service";
import { getImdbCount } from "../services/imdb.service";
import { getBlacklistCount } from "../services/blacklist.service";
import { getConfig } from "../config";

const health = new Hono();

/**
 * GET /health - Basic health check
 */
health.get("/", async (c) => {
  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/ping - Simple ping
 */
health.get("/ping", async (c) => {
  return c.text("pong");
});

/**
 * GET /health/stats - Service statistics
 */
health.get("/stats", async (c) => {
  try {
    const [torrentCount, imdbCount, blacklistCount] = await Promise.all([
      getTorrentCount(),
      getImdbCount(),
      getBlacklistCount(),
    ]);

    const config = getConfig();

    return c.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      stats: {
        torrents: torrentCount,
        imdbEntries: imdbCount,
        blacklisted: blacklistCount,
      },
      features: {
        dmm: {
          endpointEnabled: config.dmm.enableEndpoint,
          scrapingEnabled: config.dmm.enableScraping,
        },
        ingestion: {
          scrapingEnabled: config.ingestion.enableScraping,
          zurgInstances: config.ingestion.zurgInstances.length,
          zileanInstances: config.ingestion.zileanInstances.length,
          genericEndpoints: config.ingestion.genericEndpoints.length,
        },
        torznab: {
          enabled: config.torznab.enableEndpoint,
        },
        imdb: {
          enabled: config.imdb.enableEndpoint,
        },
      },
    });
  } catch (error) {
    console.error("Stats error:", error);
    return c.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: "Failed to retrieve stats",
      },
      500
    );
  }
});

export default health;
