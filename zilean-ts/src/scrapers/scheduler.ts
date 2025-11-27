import { Cron } from "croner";
import { runDmmSync } from "./dmm.scraper";
import { runGenericSync } from "./generic.scraper";
import { vacuumIndexes } from "../services/torrent.service";
import { getConfig } from "../config";

// Job locks to prevent concurrent execution
let dmmJobRunning = false;
let genericJobRunning = false;

// Cron job references
let dmmCronJob: Cron | null = null;
let genericCronJob: Cron | null = null;

/**
 * Trigger DMM sync manually
 * Returns false if job is already running
 */
export async function triggerDmmSync(): Promise<boolean> {
  if (dmmJobRunning) {
    console.log("DMM sync already running, skipping");
    return false;
  }

  dmmJobRunning = true;
  try {
    await runDmmSync();
    // Vacuum indexes after sync
    await vacuumIndexes();
    return true;
  } catch (error) {
    console.error("DMM sync failed:", error);
    return false;
  } finally {
    dmmJobRunning = false;
  }
}

/**
 * Trigger generic sync manually
 * Returns false if job is already running
 */
export async function triggerGenericSync(): Promise<boolean> {
  if (genericJobRunning) {
    console.log("Generic sync already running, skipping");
    return false;
  }

  genericJobRunning = true;
  try {
    await runGenericSync();
    // Vacuum indexes after sync
    await vacuumIndexes();
    return true;
  } catch (error) {
    console.error("Generic sync failed:", error);
    return false;
  } finally {
    genericJobRunning = false;
  }
}

/**
 * Initialize scheduled jobs
 */
export function initializeScheduler(): void {
  const config = getConfig();

  // Schedule DMM sync
  if (config.dmm.enableScraping) {
    console.log(`Scheduling DMM sync: ${config.dmm.scrapeSchedule}`);

    dmmCronJob = new Cron(config.dmm.scrapeSchedule, async () => {
      if (dmmJobRunning) {
        console.log("DMM sync already running, skipping scheduled run");
        return;
      }

      console.log("Running scheduled DMM sync");
      await triggerDmmSync();
    });
  }

  // Schedule generic sync
  if (config.ingestion.enableScraping) {
    const hasEndpoints =
      config.ingestion.zurgInstances.length > 0 ||
      config.ingestion.zileanInstances.length > 0 ||
      config.ingestion.genericEndpoints.length > 0;

    if (hasEndpoints) {
      console.log(`Scheduling generic sync: ${config.ingestion.scrapeSchedule}`);

      genericCronJob = new Cron(config.ingestion.scrapeSchedule, async () => {
        if (genericJobRunning) {
          console.log("Generic sync already running, skipping scheduled run");
          return;
        }

        console.log("Running scheduled generic sync");
        await triggerGenericSync();
      });
    }
  }
}

/**
 * Stop all scheduled jobs
 */
export function stopScheduler(): void {
  if (dmmCronJob) {
    dmmCronJob.stop();
    dmmCronJob = null;
  }

  if (genericCronJob) {
    genericCronJob.stop();
    genericCronJob = null;
  }

  console.log("Scheduler stopped");
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus(): {
  dmmJob: { running: boolean; nextRun: Date | null };
  genericJob: { running: boolean; nextRun: Date | null };
} {
  return {
    dmmJob: {
      running: dmmJobRunning,
      nextRun: dmmCronJob?.nextRun() || null,
    },
    genericJob: {
      running: genericJobRunning,
      nextRun: genericCronJob?.nextRun() || null,
    },
  };
}

/**
 * Run initial sync on startup if configured
 */
export async function runInitialSync(): Promise<void> {
  const config = getConfig();

  // Run DMM sync on first run
  if (config.firstRun && config.dmm.enableScraping) {
    console.log("Running initial DMM sync...");
    await triggerDmmSync();
  }

  // Run generic sync on first run if endpoints are configured
  if (config.firstRun && config.ingestion.enableScraping) {
    const hasEndpoints =
      config.ingestion.zurgInstances.length > 0 ||
      config.ingestion.zileanInstances.length > 0 ||
      config.ingestion.genericEndpoints.length > 0;

    if (hasEndpoints) {
      console.log("Running initial generic sync...");
      await triggerGenericSync();
    }
  }
}
