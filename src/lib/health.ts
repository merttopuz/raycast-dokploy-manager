import { Color, Icon, Image } from "@raycast/api";
import { DockerDiskUsageRow, ServerMetricsPoint } from "../types/dokploy";

/**
 * Every number the monitoring container sends is a `%.2f`-formatted string, so nothing can be
 * compared against a threshold until it has been through here. Undefined rather than 0 for
 * anything unparseable: 0% and "we don't know" must not render the same.
 */
export function parsePercent(value?: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(Math.max(parsed, 0), 100);
}

export interface ResourceReading {
  /** Percent, 0-100. */
  percent: number;
  /** True once the reading is at or past the threshold it is judged against. */
  isOverThreshold: boolean;
}

export function reading(percent: number | undefined, threshold: number): ResourceReading | undefined {
  if (percent === undefined) return undefined;
  return { percent, isOverThreshold: percent >= threshold };
}

/**
 * Dokploy carries CPU and memory thresholds in its own settings but has none for disk, so the
 * disk limit is the extension's to ask for. A Dokploy threshold of 0 means "unset", not "alert
 * at all times", which is why it is not simply passed through.
 */
export function resolveThreshold(configured: number | undefined, fallback: number): number {
  return configured && configured > 0 ? configured : fallback;
}

export interface ServerHealth {
  disk?: ResourceReading;
  cpu?: ResourceReading;
  memory?: ResourceReading;
  /** Gigabytes, for the "72% of 40 GB" line. */
  totalDiskGb?: string;
  /** True when anything being watched is over its threshold. */
  isUnderPressure: boolean;
}

export interface HealthThresholds {
  disk: number;
  cpu: number;
  memory: number;
}

/**
 * Turns one metrics sample into the three readings the menu bar shows.
 *
 * `diskUsed`, `cpu` and `memUsed` are all already percentages despite `totalDisk` and `memTotal`
 * sitting next to them in gigabytes - dividing one by the other is the mistake this function
 * exists to keep out of the UI.
 */
export function toServerHealth(metrics: ServerMetricsPoint | undefined, thresholds: HealthThresholds): ServerHealth {
  if (!metrics) return { isUnderPressure: false };

  const disk = reading(parsePercent(metrics.diskUsed), thresholds.disk);
  const cpu = reading(parsePercent(metrics.cpu), thresholds.cpu);
  const memory = reading(parsePercent(metrics.memUsed), thresholds.memory);

  return {
    disk,
    cpu,
    memory,
    totalDiskGb: metrics.totalDisk,
    // CPU spiking is normal and passes on its own; only disk is worth changing the icon over,
    // because a full disk is the thing that takes services down and never recovers by itself.
    isUnderPressure: disk?.isOverThreshold ?? false,
  };
}

/** Used gigabytes, which the payload only implies: the percentage against the total. */
export function usedDiskGb(health: ServerHealth): string | undefined {
  const total = Number.parseFloat(health.totalDiskGb ?? "");
  if (!health.disk || !Number.isFinite(total)) return undefined;
  return ((health.disk.percent / 100) * total).toFixed(1);
}

export function resourceIcon(value: ResourceReading | undefined): Image.ImageLike {
  if (!value) return { source: Icon.QuestionMarkCircle, tintColor: Color.SecondaryText };
  return {
    source: value.isOverThreshold ? Icon.ExclamationMark : Icon.CircleProgress,
    tintColor: value.isOverThreshold ? Color.Red : Color.SecondaryText,
  };
}

export function formatPercent(value: ResourceReading | undefined): string {
  return value ? `${Math.round(value.percent)}%` : "unknown";
}

/**
 * How much of Docker's disk usage a prune would give back.
 *
 * Has to come out of `reclaimable`, which Docker writes as a human string and sometimes suffixes
 * with a percentage ("1.2GB (50%)"). Dokploy parses `size` into `sizeBytes` but never does the
 * same for `reclaimable`, so this is the only route to the number.
 */
const SIZE_PATTERN = /^([\d.]+)\s*([KMGT]?B)/i;

const MULTIPLIERS: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
};

export function parseSize(value?: string | null): number {
  const match = value?.trim().match(SIZE_PATTERN);
  if (!match) return 0;

  const amount = Number.parseFloat(match[1]);
  const multiplier = MULTIPLIERS[match[2].toUpperCase()];
  if (!Number.isFinite(amount) || !multiplier) return 0;

  return amount * multiplier;
}

export interface DiskUsage {
  /** What Docker is holding, in bytes. */
  totalBytes: number;
  /** How much of that a prune would return. */
  reclaimableBytes: number;
}

export function toDiskUsage(rows: DockerDiskUsageRow[]): DiskUsage {
  return {
    totalBytes: rows.reduce((total, row) => total + (row.sizeBytes || 0), 0),
    reclaimableBytes: rows.reduce((total, row) => total + parseSize(row.reclaimable), 0),
  };
}
