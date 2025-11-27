import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { nanoid } from "nanoid";

const GenericEndpointSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  apiKey: z.string().optional(),
});

const KubernetesConfigSchema = z.object({
  enableServiceDiscovery: z.boolean().default(false),
  kubeConfigPath: z.string().optional(),
  namespace: z.string().default("default"),
  serviceLabel: z.string().default("app=zurg"),
});

const DmmConfigSchema = z.object({
  enableScraping: z.boolean().default(true),
  enableEndpoint: z.boolean().default(true),
  scrapeSchedule: z.string().default("0 * * * *"), // Every hour
  maxFilteredResults: z.number().default(200),
  minimumScoreMatch: z.number().default(0.85),
});

const IngestionConfigSchema = z.object({
  enableScraping: z.boolean().default(true),
  scrapeSchedule: z.string().default("0 */6 * * *"), // Every 6 hours
  zurgInstances: z.array(GenericEndpointSchema).default([]),
  zileanInstances: z.array(GenericEndpointSchema).default([]),
  genericEndpoints: z.array(GenericEndpointSchema).default([]),
  zurgEndpointSuffix: z.string().default("/debug/torrents"),
  zileanEndpointSuffix: z.string().default("/torrents/all"),
  requestTimeout: z.number().default(30000), // 30 seconds
  kubernetes: KubernetesConfigSchema.default({}),
});

const TorznabConfigSchema = z.object({
  enableEndpoint: z.boolean().default(true),
});

const ImdbConfigSchema = z.object({
  enableEndpoint: z.boolean().default(true),
  minimumScoreMatch: z.number().default(0.85),
});

const TorrentsConfigSchema = z.object({
  enableEndpoint: z.boolean().default(true),
  enableScrapeEndpoint: z.boolean().default(true),
  maxHashesToCheck: z.number().default(100),
});

const DatabaseConfigSchema = z.object({
  connectionString: z.string().default("./data/zilean.db"),
});

const ConfigSchema = z.object({
  apiKey: z.string().default(""),
  port: z.number().default(8181),
  host: z.string().default("0.0.0.0"),
  dataDir: z.string().default("./data"),
  firstRun: z.boolean().default(true),
  database: DatabaseConfigSchema.default({}),
  dmm: DmmConfigSchema.default({}),
  ingestion: IngestionConfigSchema.default({}),
  torznab: TorznabConfigSchema.default({}),
  imdb: ImdbConfigSchema.default({}),
  torrents: TorrentsConfigSchema.default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type GenericEndpoint = z.infer<typeof GenericEndpointSchema>;
export type DmmConfig = z.infer<typeof DmmConfigSchema>;
export type IngestionConfig = z.infer<typeof IngestionConfigSchema>;

let config: Config | null = null;
let configPath: string;

function getConfigPath(): string {
  const dataDir = process.env.ZILEAN_DATA_DIR || "./data";
  return join(dataDir, "config.json");
}

function loadConfigFromFile(path: string): Partial<Config> {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content);
  } catch {
    console.warn(`Failed to load config from ${path}, using defaults`);
    return {};
  }
}

function loadConfigFromEnv(): Partial<Config> {
  const env: Partial<Config> = {};

  if (process.env.ZILEAN_API_KEY) {
    env.apiKey = process.env.ZILEAN_API_KEY;
  }
  if (process.env.ZILEAN_PORT) {
    env.port = parseInt(process.env.ZILEAN_PORT, 10);
  }
  if (process.env.ZILEAN_HOST) {
    env.host = process.env.ZILEAN_HOST;
  }
  if (process.env.ZILEAN_DATA_DIR) {
    env.dataDir = process.env.ZILEAN_DATA_DIR;
  }
  if (process.env.DATABASE_URL) {
    env.database = {
      ...env.database,
      connectionString: process.env.DATABASE_URL
    };
  }

  // DMM settings
  if (process.env.ZILEAN_DMM_ENABLE_SCRAPING !== undefined) {
    env.dmm = { ...env.dmm, enableScraping: process.env.ZILEAN_DMM_ENABLE_SCRAPING === "true" };
  }
  if (process.env.ZILEAN_DMM_SCHEDULE) {
    env.dmm = { ...env.dmm, scrapeSchedule: process.env.ZILEAN_DMM_SCHEDULE };
  }

  // Ingestion settings
  if (process.env.ZILEAN_INGESTION_ENABLE_SCRAPING !== undefined) {
    env.ingestion = { ...env.ingestion, enableScraping: process.env.ZILEAN_INGESTION_ENABLE_SCRAPING === "true" };
  }
  if (process.env.ZILEAN_INGESTION_SCHEDULE) {
    env.ingestion = { ...env.ingestion, scrapeSchedule: process.env.ZILEAN_INGESTION_SCHEDULE };
  }

  return env;
}

function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const output = { ...target };
  for (const key in source) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === "object" &&
        source[key] !== null &&
        !Array.isArray(source[key])
      ) {
        output[key] = deepMerge(
          (target[key] as Record<string, unknown>) || {},
          source[key] as Record<string, unknown>
        ) as T[Extract<keyof T, string>];
      } else {
        output[key] = source[key] as T[Extract<keyof T, string>];
      }
    }
  }
  return output;
}

export function loadConfig(): Config {
  if (config) {
    return config;
  }

  configPath = getConfigPath();

  // Ensure data directory exists
  const dataDir = dirname(configPath);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // Load from file and env
  const fileConfig = loadConfigFromFile(configPath);
  const envConfig = loadConfigFromEnv();

  // Merge configs: defaults < file < env
  const merged = deepMerge(
    ConfigSchema.parse({}), // defaults
    deepMerge(fileConfig as Record<string, unknown>, envConfig as Record<string, unknown>) as Partial<Config>
  );

  // Generate API key if not set
  if (!merged.apiKey) {
    merged.apiKey = nanoid(32);
    merged.firstRun = true;
    console.log(`Generated new API key: ${merged.apiKey}`);
  }

  // Validate final config
  config = ConfigSchema.parse(merged);

  // Save config to file (for persistence)
  saveConfig(config);

  return config;
}

export function saveConfig(cfg: Config): void {
  const path = configPath || getConfigPath();
  const dataDir = dirname(path);

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  writeFileSync(path, JSON.stringify(cfg, null, 2));
}

export function getConfig(): Config {
  if (!config) {
    return loadConfig();
  }
  return config;
}

export function updateConfig(updates: Partial<Config>): Config {
  const current = getConfig();
  config = deepMerge(current, updates);
  saveConfig(config);
  return config;
}
