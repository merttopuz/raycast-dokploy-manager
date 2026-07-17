import { Alert, Color, confirmAlert, Icon, MenuBarExtra, showHUD } from "@raycast/api";
import { DokployClient } from "../api/client";
import { runCleanupTask } from "../api/dokploy-api";
import { toErrorMessage } from "../api/errors";
import { CleanupTaskConfig, CLEANUP_TASK_LIST } from "../lib/cleanup-tasks";
import { formatBytes } from "../lib/format";
import { formatPercent, resourceIcon, usedDiskGb } from "../lib/health";
import { AccountHealth, hasServerInfo } from "../hooks/use-server-health";

interface ServerHealthMenuProps {
  entry: AccountHealth;
  client?: DokployClient;
  showAccountName: boolean;
  onDidChange: () => void;
}

/** The one line worth having in the menu without opening anything: how full the disk is. */
function headline(entry: AccountHealth): string {
  const { disk } = entry.health;
  if (disk) {
    const used = usedDiskGb(entry.health);
    return used && entry.health.totalDiskGb
      ? `Disk ${formatPercent(disk)} - ${used} of ${entry.health.totalDiskGb} GB`
      : `Disk ${formatPercent(disk)}`;
  }
  // No monitoring container: Docker's own footprint is all there is, and it is not a percentage.
  return entry.disk ? `Docker using ${formatBytes(entry.disk.totalBytes)}` : "Server";
}

/**
 * A question mark is right for a disk reading that should exist and doesn't, but wrong for an
 * instance that simply runs no monitoring - there is nothing unknown about that, so the entry
 * leads with the hard drive it *can* talk about instead.
 */
function headlineIcon(entry: AccountHealth) {
  if (entry.health.disk) return resourceIcon(entry.health.disk);
  return { source: Icon.HardDrive, tintColor: Color.SecondaryText };
}

/**
 * Disk, CPU and memory for one instance, with Docker's prune commands behind them.
 *
 * The two halves come from different places and either can be missing on its own. The percentages
 * need Dokploy's monitoring container, which is opt-in and most instances don't run; Docker's disk
 * usage needs an admin API key. Whichever is present is shown, and the submenu disappears entirely
 * only when neither is.
 */
export function ServerHealthMenu({ entry, client, showAccountName, onDidChange }: ServerHealthMenuProps) {
  const { health } = entry;
  if (!hasServerInfo(entry)) return null;

  async function clean(task: CleanupTaskConfig) {
    if (!client) return;

    const confirmed = await confirmAlert({
      title: `${task.label}?`,
      message: task.description,
      icon: task.icon,
      primaryAction: {
        title: task.label,
        style: task.destroysData ? Alert.ActionStyle.Destructive : Alert.ActionStyle.Default,
      },
    });
    if (!confirmed) return;

    try {
      await runCleanupTask(client, task.task);
      await showHUD(`✓ ${task.label}`);
      onDidChange();
    } catch (error) {
      await showHUD(`⚠️ ${toErrorMessage(error)}`);
    }
  }

  return (
    <MenuBarExtra.Submenu
      icon={headlineIcon(entry)}
      title={showAccountName ? `${entry.accountLabel} - ${headline(entry)}` : headline(entry)}
    >
      {health.cpu && <MenuBarExtra.Item icon={resourceIcon(health.cpu)} title={`CPU ${formatPercent(health.cpu)}`} />}
      {health.memory && (
        <MenuBarExtra.Item icon={resourceIcon(health.memory)} title={`Memory ${formatPercent(health.memory)}`} />
      )}

      {entry.disk && (
        <MenuBarExtra.Section title="Docker">
          <MenuBarExtra.Item icon={Icon.Box} title={`Using ${formatBytes(entry.disk.totalBytes)}`} />
          <MenuBarExtra.Item
            // The number that decides whether cleaning up is worth doing at all.
            icon={{
              source: Icon.Trash,
              tintColor: entry.disk.reclaimableBytes > 0 ? Color.Green : Color.SecondaryText,
            }}
            title={`${formatBytes(entry.disk.reclaimableBytes)} reclaimable`}
          />
        </MenuBarExtra.Section>
      )}

      {client && (
        <MenuBarExtra.Section title="Clean Up">
          {CLEANUP_TASK_LIST.map((task) => (
            <MenuBarExtra.Item
              key={task.task}
              icon={{ source: task.icon, tintColor: task.destroysData ? Color.Red : undefined }}
              title={task.label}
              onAction={() => clean(task)}
            />
          ))}
        </MenuBarExtra.Section>
      )}
    </MenuBarExtra.Submenu>
  );
}
