import type { Context, Next } from "hono";
import { getConfig } from "../config";

/**
 * API key authentication middleware
 * Checks for X-API-KEY header or apikey query parameter
 */
export async function apiKeyAuth(c: Context, next: Next) {
  const config = getConfig();

  // Get API key from header or query
  const apiKey =
    c.req.header("X-API-KEY") ||
    c.req.query("apikey");

  if (!apiKey) {
    return c.json(
      { error: "API key required", message: "Provide API key via X-API-KEY header or apikey query parameter" },
      401
    );
  }

  if (apiKey !== config.apiKey) {
    return c.json(
      { error: "Invalid API key", message: "The provided API key is not valid" },
      403
    );
  }

  await next();
}

/**
 * Optional API key auth - sets isAuthenticated flag but doesn't block
 */
export async function optionalApiKeyAuth(c: Context, next: Next) {
  const config = getConfig();

  const apiKey =
    c.req.header("X-API-KEY") ||
    c.req.query("apikey");

  c.set("isAuthenticated", apiKey === config.apiKey);

  await next();
}
