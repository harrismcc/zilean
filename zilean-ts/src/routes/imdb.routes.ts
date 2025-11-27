import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { searchImdb, getImdbById } from "../services/imdb.service";
import { getConfig } from "../config";

const imdb = new Hono();

// Search schema
const searchSchema = z.object({
  query: z.string().min(1),
  year: z.coerce.number().optional(),
  category: z.string().optional(),
  limit: z.coerce.number().max(100).default(20),
});

/**
 * POST /imdb/search - Search IMDB metadata
 */
imdb.post("/search", zValidator("json", searchSchema), async (c) => {
  const config = getConfig();
  if (!config.imdb.enableEndpoint) {
    return c.json({ error: "IMDB endpoint is disabled" }, 503);
  }

  const { query, year, category, limit } = c.req.valid("json");

  try {
    const results = await searchImdb({
      query,
      year,
      category,
      limit,
    });

    return c.json({
      results,
      count: results.length,
    });
  } catch (error) {
    console.error("IMDB search error:", error);
    return c.json({ error: "Search failed" }, 500);
  }
});

/**
 * GET /imdb/:id - Get IMDB entry by ID
 */
imdb.get("/:id", async (c) => {
  const config = getConfig();
  if (!config.imdb.enableEndpoint) {
    return c.json({ error: "IMDB endpoint is disabled" }, 503);
  }

  const id = c.req.param("id");

  try {
    const result = await getImdbById(id);

    if (!result) {
      return c.json({ error: "IMDB entry not found" }, 404);
    }

    return c.json(result);
  } catch (error) {
    console.error("IMDB lookup error:", error);
    return c.json({ error: "Lookup failed" }, 500);
  }
});

export default imdb;
