import { useCachedPromise } from "@raycast/utils";
import { DokployAccount } from "../accounts/types";
import { DokployClient } from "../api/client";
import { getDockerDiskUsage, readServerMetrics } from "../api/dokploy-api";
import { DiskUsage, resolveThreshold, ServerHealth, toDiskUsage, toServerHealth } from "../lib/health";

/** Used when Dokploy has no threshold of its own configured. */
const DEFAULT_CPU_THRESHOLD = 90;
const DEFAULT_MEMORY_THRESHOLD = 90;

export interface AccountHealth {
  accountId: string;
  accountLabel: string;
  /** Empty when the instance runs no monitoring container - the common case, not a failure. */
  health: ServerHealth;
  /** Undefined when the API key is not an admin one, or on Dokploy Cloud. */
  disk?: DiskUsage;
}

/**
 * Whether this account knows anything about its server at all.
 *
 * An instance with no monitoring container *and* a non-admin key - which is a perfectly ordinary
 * combination - yields an entry with both halves empty. It still gets a row, because the account
 * exists; there is just nothing to say about it, and the menu has to know that before it draws a
 * section header over the top of nothing.
 */
export function hasServerInfo(entry: AccountHealth): boolean {
  return entry.health.disk !== undefined || entry.disk !== undefined;
}

/**
 * What the two halves of "is this server healthy" cost, and why both are here.
 *
 * They answer different questions and neither replaces the other. `getDockerDiskUsage` always
 * works for an admin and says how much Docker is holding and how much a prune would give back -
 * but it knows nothing about the filesystem, so it can never say the disk is 90% full. The
 * percentage only exists in the monitoring container's sample, which most instances don't run.
 *
 * So: metrics drive the warning when they are available, disk usage drives the cleanup actions,
 * and each degrades to absent on its own without taking the other with it.
 */
async function loadHealth(
  client: DokployClient,
  diskThreshold: number,
): Promise<Omit<AccountHealth, "accountId" | "accountLabel">> {
  const [metrics, disk] = await Promise.all([
    readServerMetrics(client),
    // Admin-only, and `[]` on Cloud. A scoped key is not an error worth a toast in the menu bar.
    getDockerDiskUsage(client).catch(() => undefined),
  ]);

  const health = toServerHealth(metrics?.metrics, {
    disk: diskThreshold,
    cpu: resolveThreshold(metrics?.thresholds?.cpu, DEFAULT_CPU_THRESHOLD),
    memory: resolveThreshold(metrics?.thresholds?.memory, DEFAULT_MEMORY_THRESHOLD),
  });

  return { health, disk: disk && disk.length > 0 ? toDiskUsage(disk) : undefined };
}

/**
 * Server health for every watched account.
 *
 * Cached, and safe to cache: `readServerMetrics` keeps the monitoring bearer token inside its own
 * scope and hands back only the sample, so nothing secret reaches Raycast's unencrypted store -
 * the same boundary `use-projects.ts` draws around `env` and database passwords.
 *
 * `allSettled`, so one unreachable instance costs its own row and not everyone else's.
 */
export function useAllServerHealth(accounts: DokployAccount[], diskThreshold: number) {
  const accountIds = accounts.map((account) => account.id).join(",");

  return useCachedPromise(
    async (ids: string, threshold: number): Promise<AccountHealth[]> => {
      if (!ids) return [];

      const results = await Promise.allSettled(
        accounts.map((account) => loadHealth(new DokployClient(account), threshold)),
      );

      return accounts.map((account, index) => {
        const result = results[index];
        return {
          accountId: account.id,
          accountLabel: account.label,
          ...(result.status === "fulfilled" ? result.value : { health: { isUnderPressure: false } }),
        };
      });
    },
    [accountIds, diskThreshold],
    {
      execute: accounts.length > 0,
      initialData: [] as AccountHealth[],
    },
  );
}
