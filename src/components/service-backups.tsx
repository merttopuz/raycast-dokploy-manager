import { Action, ActionPanel, Color, Icon, Keyboard, List, showToast, Toast } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { DokployClient } from "../api/client";
import { listServiceBackups, runManualBackup } from "../api/dokploy-api";
import { toErrorMessage } from "../api/errors";
import { relativeTime } from "../lib/format";
import { deploymentIcon, deploymentPresentation } from "../lib/status";
import { Backup, ServiceRef } from "../types/dokploy";

interface ServiceBackupsProps {
  client: DokployClient;
  service: ServiceRef;
}

/** The most recent run, which is the only one worth putting on the row. */
function lastRun(backup: Backup) {
  return backup.deployments?.[0];
}

/**
 * The backups configured for a service, and a way to run one now.
 *
 * Running is all this offers, and the reason is worth stating: every backup writes to an S3
 * destination, and Dokploy's whole `destination` router is owner/admin only - so there is no
 * honest way to *create* a backup from here for most keys. Configure it in Dokploy once; from then
 * on the useful question is "run it now, without waiting for the cron", and that is what this is.
 */
export function ServiceBackups({ client, service }: ServiceBackupsProps) {
  const {
    data: backups,
    isLoading,
    revalidate,
  } = usePromise(async (ref: ServiceRef) => listServiceBackups(client, ref), [service], {
    failureToastOptions: { title: "Could Not Load Backups" },
  });

  async function run(backup: Backup) {
    const toast = await showToast({ style: Toast.Style.Animated, title: `Backing up ${backup.database}…` });
    try {
      await runManualBackup(client, service, backup.backupId);
      toast.style = Toast.Style.Success;
      toast.title = `Backed up ${backup.database}`;
      toast.message = `Written to ${backup.destination?.name ?? "its destination"}.`;
      revalidate();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Backup Failed";
      toast.message = toErrorMessage(error);
    }
  }

  return (
    <List isLoading={isLoading} navigationTitle={`${service.name} - Backups`}>
      <List.EmptyView
        icon={Icon.ArrowCounterClockwise}
        title="No Backups Configured"
        // Says where to go rather than implying the extension is missing something: creating one
        // needs an S3 destination, which the API only lets an owner or admin set up.
        description={`${service.name} has no backup set up. Add one in Dokploy, then run it from here.`}
      />

      {(backups ?? []).map((backup) => {
        const latest = lastRun(backup);
        return (
          <List.Item
            key={backup.backupId}
            icon={{
              source: Icon.SaveDocument,
              // Enabled is nullable, and a null one is a backup whose cron was never registered -
              // it exists but will never fire by itself.
              tintColor: backup.enabled ? Color.Green : Color.SecondaryText,
            }}
            title={backup.database}
            subtitle={backup.schedule}
            accessories={[
              ...(backup.destination?.name ? [{ tag: backup.destination.name, icon: Icon.Cloud }] : []),
              ...(latest
                ? [
                    {
                      icon: deploymentIcon(latest.status),
                      text: `${deploymentPresentation(latest.status).label} ${relativeTime(latest.createdAt)}`.trim(),
                    },
                  ]
                : [{ text: "never run" }]),
              ...(backup.enabled ? [] : [{ tag: { value: "Paused", color: Color.Orange } }]),
            ]}
            actions={
              <ActionPanel>
                <Action title="Back up Now" icon={Icon.SaveDocument} onAction={() => run(backup)} />
                <Action
                  title="Refresh"
                  icon={Icon.ArrowClockwise}
                  shortcut={Keyboard.Shortcut.Common.Refresh}
                  onAction={revalidate}
                />
                <Action.CopyToClipboard
                  title="Copy Backup ID"
                  content={backup.backupId}
                  shortcut={Keyboard.Shortcut.Common.Copy}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
