import { Action, ActionPanel, Clipboard, Icon, showToast, Toast } from "@raycast/api";
import { DokployClient } from "../api/client";
import { getDatabase, resolveExternalHost } from "../api/dokploy-api";
import { toErrorMessage } from "../api/errors";
import { externalConnectionUri, internalConnectionUri } from "../lib/connection-string";
import { DatabaseKind, ServiceRef } from "../types/dokploy";

interface DatabaseActionsProps {
  client: DokployClient;
  service: ServiceRef;
  kind: DatabaseKind;
}

type Scope = "internal" | "external";

/**
 * The connection actions for a database service.
 *
 * Credentials are fetched when an action runs rather than when the list renders: `<kind>.one`
 * returns the password in the clear, and a list of twenty databases has no business holding twenty
 * passwords in memory because one of them might get copied.
 *
 * That also means `externalPort` isn't known at render time, so both actions are always shown and
 * the external one explains itself if the database isn't published. A missing port is a thing the
 * user can go and fix, so it's worth a sentence rather than a hidden action.
 */
export function DatabaseActions({ client, service, kind }: DatabaseActionsProps) {
  async function copyUri(scope: Scope) {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Reading credentials…" });

    try {
      const database = await getDatabase(client, kind, service.id);

      if (scope === "internal") {
        const uri = internalConnectionUri(kind, database);
        if (!uri) {
          toast.style = Toast.Style.Failure;
          toast.title = "No Connection String";
          toast.message = `Dokploy has not finished setting ${service.name} up yet.`;
          return;
        }
        await copyConcealed(
          uri,
          toast,
          "Copied Internal Connection String",
          "Reachable from other services on this Dokploy instance.",
        );
        return;
      }

      if (!database.externalPort) {
        toast.style = Toast.Style.Failure;
        toast.title = "Not Published";
        toast.message = `${service.name} has no external port. Add one in Dokploy to reach it from outside the server.`;
        return;
      }

      const host = await resolveExternalHost(client, database.serverId);
      if (!host) {
        toast.style = Toast.Style.Failure;
        toast.title = "No Server Address";
        toast.message = "This Dokploy instance has no IP address set, so an external URL cannot be built.";
        return;
      }

      const uri = externalConnectionUri(kind, database, host);
      if (!uri) {
        toast.style = Toast.Style.Failure;
        toast.title = "No Connection String";
        toast.message = `Dokploy has not finished setting ${service.name} up yet.`;
        return;
      }

      await copyConcealed(uri, toast, "Copied External Connection String", `Port ${database.externalPort} on ${host}.`);
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Could Not Read Credentials";
      toast.message = toErrorMessage(error);
    }
  }

  async function copyPassword() {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Reading credentials…" });
    try {
      const database = await getDatabase(client, kind, service.id);
      if (!database.databasePassword) {
        toast.style = Toast.Style.Failure;
        toast.title = "No Password";
        toast.message = `${service.name} has no password set.`;
        return;
      }
      await copyConcealed(database.databasePassword, toast, "Copied Password");
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Could Not Read Credentials";
      toast.message = toErrorMessage(error);
    }
  }

  // `u` for URL: `cmd+shift+c` is Raycast's Copy shortcut and already belongs to "Copy Service ID"
  // in this same panel, where a second claim on it would simply shadow the first.
  return (
    <ActionPanel.Section title="Connection">
      <Action
        title="Copy External Connection String"
        icon={Icon.Globe}
        shortcut={{ modifiers: ["cmd", "shift"], key: "u" }}
        onAction={() => copyUri("external")}
      />
      <Action
        title="Copy Internal Connection String"
        icon={Icon.Link}
        shortcut={{ modifiers: ["cmd", "opt"], key: "u" }}
        onAction={() => copyUri("internal")}
      />
      <Action title="Copy Password" icon={Icon.Key} onAction={copyPassword} />
    </ActionPanel.Section>
  );
}

/**
 * `concealed` keeps the value out of Raycast's clipboard history. A connection string is a password
 * with a hostname attached, and it should not still be sitting in a searchable list tomorrow.
 */
async function copyConcealed(value: string, toast: Toast, title: string, message?: string): Promise<void> {
  await Clipboard.copy(value, { concealed: true });
  toast.style = Toast.Style.Success;
  toast.title = title;
  if (message) toast.message = message;
}
