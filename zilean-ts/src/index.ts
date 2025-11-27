import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { loadConfig, getConfig, updateConfig } from "./config";
import { initializeDatabase, closeDatabase } from "./db/client";
import { initializeScheduler, stopScheduler, runInitialSync } from "./scrapers/scheduler";

// Import routes
import dmmRoutes from "./routes/dmm.routes";
import torznabRoutes from "./routes/torznab.routes";
import imdbRoutes from "./routes/imdb.routes";
import torrentsRoutes from "./routes/torrents.routes";
import blacklistRoutes from "./routes/blacklist.routes";
import healthRoutes from "./routes/health.routes";

// ASCII art banner
const banner = `
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║     ███████╗██╗██╗     ███████╗ █████╗ ███╗   ██╗        ║
║     ╚══███╔╝██║██║     ██╔════╝██╔══██╗████╗  ██║        ║
║       ███╔╝ ██║██║     █████╗  ███████║██╔██╗ ██║        ║
║      ███╔╝  ██║██║     ██╔══╝  ██╔══██║██║╚██╗██║        ║
║     ███████╗██║███████╗███████╗██║  ██║██║ ╚████║        ║
║     ╚══════╝╚═╝╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝        ║
║                                                           ║
║     Torrent Metadata Aggregator - TypeScript Edition      ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`;

async function main() {
  console.log(banner);

  // Load configuration
  console.log("Loading configuration...");
  const config = loadConfig();

  // Display configuration summary
  console.log(`
Configuration:
  - Port: ${config.port}
  - Host: ${config.host}
  - API Key: ${config.apiKey.substring(0, 8)}...
  - DMM Scraping: ${config.dmm.enableScraping ? "enabled" : "disabled"}
  - DMM Endpoint: ${config.dmm.enableEndpoint ? "enabled" : "disabled"}
  - Torznab: ${config.torznab.enableEndpoint ? "enabled" : "disabled"}
  - IMDB: ${config.imdb.enableEndpoint ? "enabled" : "disabled"}
  - Generic Ingestion: ${config.ingestion.enableScraping ? "enabled" : "disabled"}
  - Zurg Instances: ${config.ingestion.zurgInstances.length}
  - Zilean Instances: ${config.ingestion.zileanInstances.length}
  - Generic Endpoints: ${config.ingestion.genericEndpoints.length}
`);

  // Initialize database
  console.log("Initializing database...");
  try {
    await initializeDatabase();
    console.log("Database initialized successfully");
  } catch (error) {
    console.error("Failed to initialize database:", error);
    process.exit(1);
  }

  // Create Hono app
  const app = new Hono();

  // Global middleware
  app.use("*", logger());
  app.use("*", cors());

  // Mount routes
  app.route("/dmm", dmmRoutes);
  app.route("/torznab", torznabRoutes);
  app.route("/imdb", imdbRoutes);
  app.route("/torrents", torrentsRoutes);
  app.route("/blacklist", blacklistRoutes);
  app.route("/health", healthRoutes);
  app.route("/healthchecks", healthRoutes); // Alias for compatibility

  // Root endpoint
  app.get("/", (c) => {
    return c.json({
      name: "Zilean",
      version: "1.0.0",
      description: "Torrent Metadata Aggregator",
      endpoints: {
        dmm: "/dmm",
        torznab: "/torznab/api",
        imdb: "/imdb",
        torrents: "/torrents",
        blacklist: "/blacklist",
        health: "/health",
      },
    });
  });

  // 404 handler
  app.notFound((c) => {
    return c.json({ error: "Not Found" }, 404);
  });

  // Error handler
  app.onError((err, c) => {
    console.error("Unhandled error:", err);
    return c.json({ error: "Internal Server Error" }, 500);
  });

  // Initialize scheduler
  console.log("Initializing scheduler...");
  initializeScheduler();

  // Start server
  const server = Bun.serve({
    port: config.port,
    hostname: config.host,
    fetch: app.fetch,
  });

  console.log(`
Server started successfully!
  - URL: http://${config.host}:${config.port}
  - Torznab URL: http://${config.host}:${config.port}/torznab/api
  - API Key: ${config.apiKey}

Press Ctrl+C to stop the server.
`);

  // Mark first run as complete
  if (config.firstRun) {
    updateConfig({ firstRun: false });

    // Run initial sync in background
    runInitialSync().catch((error) => {
      console.error("Initial sync failed:", error);
    });
  }

  // Graceful shutdown handler
  const shutdown = async () => {
    console.log("\nShutting down...");
    stopScheduler();
    await closeDatabase();
    server.stop();
    console.log("Goodbye!");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Run main
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
