import { Hono } from "hono";
import { searchFiltered, type SearchFilter } from "../services/torrent.service";
import { generateCapsXml, generateSearchResultsXml, generateErrorXml } from "../utils/xml";
import { getConfig } from "../config";

const torznab = new Hono();

/**
 * GET /torznab/api - Torznab API endpoint
 * Supports: caps, search, tvsearch, movie
 */
torznab.get("/api", async (c) => {
  const config = getConfig();
  if (!config.torznab.enableEndpoint) {
    return c.text(generateErrorXml(503, "Torznab endpoint is disabled"), 503, {
      "Content-Type": "application/xml",
    });
  }

  const t = c.req.query("t");
  const q = c.req.query("q");
  const imdbid = c.req.query("imdbid");
  const season = c.req.query("season");
  const ep = c.req.query("ep");
  const limit = c.req.query("limit");
  const offset = c.req.query("offset");
  const cat = c.req.query("cat");

  // Get base URL for links
  const url = new URL(c.req.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  // Handle capabilities request
  if (t === "caps") {
    return c.text(generateCapsXml(baseUrl), 200, {
      "Content-Type": "application/xml",
    });
  }

  // Build search filter based on request type
  const filter: SearchFilter = {
    limit: limit ? Math.min(parseInt(limit, 10), 200) : 100,
    offset: offset ? parseInt(offset, 10) : 0,
    excludeTrash: true,
    excludeAdult: !cat?.includes("6000"), // Only include adult if category 6000 is requested
  };

  // Parse query
  if (q && q.trim()) {
    filter.query = q.trim();
  }

  // Parse IMDB ID
  if (imdbid) {
    // Normalize IMDB ID (tt1234567 format)
    filter.imdbId = imdbid.toLowerCase().startsWith("tt")
      ? imdbid.toLowerCase()
      : `tt${imdbid}`;
  }

  // Parse season/episode
  if (season) {
    filter.season = parseInt(season, 10);
  }
  if (ep) {
    filter.episode = parseInt(ep, 10);
  }

  // Parse category
  if (cat) {
    const catNum = parseInt(cat, 10);
    if (catNum >= 2000 && catNum < 3000) {
      filter.category = "movie";
    } else if (catNum >= 5000 && catNum < 6000) {
      filter.category = "tvSeries";
    } else if (catNum >= 6000 && catNum < 7000) {
      filter.category = "xxx";
      filter.excludeAdult = false;
    }
  }

  // Handle different search types
  switch (t) {
    case "search":
      // General search - no additional filters
      break;

    case "tvsearch":
      // TV search - prefer TV category if not already set
      if (!filter.category) {
        filter.category = "tvSeries";
      }
      break;

    case "movie":
      // Movie search - prefer movie category if not already set
      if (!filter.category) {
        filter.category = "movie";
      }
      break;

    case "xxx":
      filter.category = "xxx";
      filter.excludeAdult = false;
      break;

    default:
      if (!t) {
        return c.text(generateErrorXml(200, "Missing parameter: t"), 200, {
          "Content-Type": "application/xml",
        });
      }
      return c.text(generateErrorXml(202, `Unknown search type: ${t}`), 200, {
        "Content-Type": "application/xml",
      });
  }

  // Require at least query or imdbid
  if (!filter.query && !filter.imdbId) {
    return c.text(generateErrorXml(200, "Missing search query or IMDB ID"), 200, {
      "Content-Type": "application/xml",
    });
  }

  try {
    const results = await searchFiltered(filter);
    const xml = generateSearchResultsXml(results, baseUrl);

    return c.text(xml, 200, {
      "Content-Type": "application/xml",
    });
  } catch (error) {
    console.error("Torznab search error:", error);
    return c.text(generateErrorXml(900, "Internal server error"), 500, {
      "Content-Type": "application/xml",
    });
  }
});

export default torznab;
