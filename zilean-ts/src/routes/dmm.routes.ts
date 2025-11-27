import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { searchByTitle, searchFiltered, type SearchFilter } from "../services/torrent.service";
import { apiKeyAuth } from "../middleware/auth";
import { getConfig } from "../config";

const dmm = new Hono();

// Search schema
const searchSchema = z.object({
  query: z.string().min(1),
});

// Filtered search schema
const filteredSearchSchema = z.object({
  query: z.string().optional(),
  imdbId: z.string().optional(),
  season: z.coerce.number().optional(),
  episode: z.coerce.number().optional(),
  year: z.coerce.number().optional(),
  language: z.string().optional(),
  resolution: z.string().optional(),
  category: z.enum(["movie", "tvSeries", "xxx", "other"]).optional(),
  limit: z.coerce.number().max(500).default(100),
  offset: z.coerce.number().default(0),
});

/**
 * POST /dmm/search - Simple text search
 */
dmm.post("/search", zValidator("json", searchSchema), async (c) => {
  const config = getConfig();
  if (!config.dmm.enableEndpoint) {
    return c.json({ error: "DMM endpoint is disabled" }, 503);
  }

  const { query } = c.req.valid("json");

  try {
    const results = await searchByTitle(query, config.dmm.maxFilteredResults);
    return c.json({
      results,
      count: results.length,
    });
  } catch (error) {
    console.error("Search error:", error);
    return c.json({ error: "Search failed" }, 500);
  }
});

/**
 * GET /dmm/filtered - Advanced filtered search
 */
dmm.get("/filtered", async (c) => {
  const config = getConfig();
  if (!config.dmm.enableEndpoint) {
    return c.json({ error: "DMM endpoint is disabled" }, 503);
  }

  // Parse query parameters
  const query = c.req.query("query");
  const imdbId = c.req.query("imdbId");
  const season = c.req.query("season");
  const episode = c.req.query("episode");
  const year = c.req.query("year");
  const language = c.req.query("language");
  const resolution = c.req.query("resolution");
  const category = c.req.query("category") as SearchFilter["category"];
  const limit = c.req.query("limit");
  const offset = c.req.query("offset");

  const filter: SearchFilter = {
    query: query || undefined,
    imdbId: imdbId || undefined,
    season: season ? parseInt(season, 10) : undefined,
    episode: episode ? parseInt(episode, 10) : undefined,
    year: year ? parseInt(year, 10) : undefined,
    language: language || undefined,
    resolution: resolution || undefined,
    category: category || undefined,
    limit: limit ? Math.min(parseInt(limit, 10), 500) : config.dmm.maxFilteredResults,
    offset: offset ? parseInt(offset, 10) : 0,
  };

  try {
    const results = await searchFiltered(filter);
    return c.json({
      results,
      count: results.length,
      filter,
    });
  } catch (error) {
    console.error("Filtered search error:", error);
    return c.json({ error: "Search failed" }, 500);
  }
});

/**
 * GET /dmm/on-demand-scrape - Trigger DMM sync (requires API key)
 */
dmm.get("/on-demand-scrape", apiKeyAuth, async (c) => {
  const config = getConfig();
  if (!config.dmm.enableScraping) {
    return c.json({ error: "DMM scraping is disabled" }, 503);
  }

  // Import and trigger scraper
  try {
    const { triggerDmmSync } = await import("../scrapers/scheduler");
    const started = await triggerDmmSync();

    if (started) {
      return c.json({
        status: "started",
        message: "DMM sync job has been triggered",
      });
    } else {
      return c.json({
        status: "skipped",
        message: "DMM sync job is already running",
      });
    }
  } catch (error) {
    console.error("Failed to trigger DMM sync:", error);
    return c.json({ error: "Failed to trigger sync" }, 500);
  }
});

export default dmm;
