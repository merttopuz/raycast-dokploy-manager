import { LaunchProps, showHUD, showToast, Toast } from "@raycast/api";
import { getActiveAccount } from "./accounts/storage";
import { DokployClient } from "./api/client";
import { runServiceAction } from "./api/dokploy-api";
import { toErrorMessage } from "./api/errors";
import { loadServices, matchServices } from "./lib/ai";
import { ACTION_PAST, ACTION_PROGRESS, ServiceAction, serviceKindConfig, supportsAction } from "./lib/service-kinds";
import { ServiceRef } from "./types/dokploy";

interface DeployArguments {
  service: string;
}

/** Applications and compose stacks rebuild from source; databases have `rebuild` instead. */
function deployAction(kind: ServiceRef["kind"]): ServiceAction {
  if (supportsAction(kind, "redeploy")) return "redeploy";
  if (supportsAction(kind, "rebuild")) return "rebuild";
  return "deploy";
}

function describe(service: ServiceRef): string {
  return `${service.name} (${service.projectName}/${service.environmentName})`;
}

/**
 * Deploys a service straight from Raycast's root search: type the command, type a name, press
 * Enter. No window opens, which is the whole point - the fastest path to a redeploy is not to
 * navigate to it.
 *
 * Typing the name *is* the confirmation, so there is no second one. Nothing here is destructive in
 * the way `stop` or `delete` are: this replaces a running service with a newer build of itself,
 * which is what the command's name promised.
 *
 * The name is matched the same way the AI tools match it - through `matchServices` - so "api"
 * means the same service whichever way you ask. What differs is what happens when it is
 * ambiguous: a person gets told which ones matched and picks a more specific name, rather than
 * having one chosen for them.
 */
export default async function Deploy(props: LaunchProps<{ arguments: DeployArguments }>) {
  const query = props.arguments.service.trim();

  if (!query) {
    await showHUD("⚠️ Enter a service name");
    return;
  }

  const toast = await showToast({ style: Toast.Style.Animated, title: `Looking for ${query}…` });

  try {
    const account = await getActiveAccount();
    if (!account) {
      toast.style = Toast.Style.Failure;
      toast.title = "No Dokploy Account";
      toast.message = "Add one with the Manage Accounts command.";
      return;
    }

    const client = new DokployClient(account);
    const matches = matchServices(await loadServices(client), query);

    if (matches.length === 0) {
      toast.style = Toast.Style.Failure;
      toast.title = `No service matching “${query}”`;
      toast.message = `Nothing on ${account.label} goes by that name.`;
      return;
    }

    if (matches.length > 1) {
      toast.style = Toast.Style.Failure;
      toast.title = `“${query}” matches ${matches.length} services`;
      // Naming them is what makes the next attempt work: the fix is a longer query, and this is
      // where the user finds out what to type.
      toast.message = `${matches.slice(0, 4).map(describe).join(", ")}. Be more specific.`;
      return;
    }

    const service = matches[0];
    const action = deployAction(service.kind);

    toast.title = `${ACTION_PROGRESS[action]} ${service.name}…`;
    await runServiceAction(client, service, action);

    toast.style = Toast.Style.Success;
    toast.title = `${ACTION_PAST[action]} ${service.name}`;
    // The build runs on the server and this returns the moment it is queued, so "deployed" would
    // be claiming something that hasn't happened yet.
    toast.message = `Queued on ${service.projectName}. ${serviceKindConfig(service.kind).label} builds on the server.`;
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = "Could Not Deploy";
    toast.message = toErrorMessage(error);
  }
}
