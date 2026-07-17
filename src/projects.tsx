import { Action, ActionPanel, Alert, Color, confirmAlert, Icon, List, Keyboard, showToast, Toast } from "@raycast/api";
import { DokployClient } from "./api/client";
import { removeProject } from "./api/dokploy-api";
import { toErrorMessage } from "./api/errors";
import { AccountDropdown } from "./components/account-dropdown";
import { NoAccounts } from "./components/no-accounts";
import { ProjectForm } from "./components/project-form";
import { ServiceListItem } from "./components/service-list-item";
import { useAccounts } from "./hooks/use-accounts";
import { useProjectFrecency, useServiceFrecency } from "./hooks/use-frecency";
import { ProjectNode, useProjects } from "./hooks/use-projects";
import { projectUrl } from "./lib/urls";

/**
 * Deleting a project takes every service in it with it, so the prompt says how many rather than
 * leaving the user to remember. Dokploy itself makes you type the project's name to confirm; a
 * destructive alert is the Raycast-native equivalent and the count is what carries the weight.
 */
async function confirmDelete(client: DokployClient, project: ProjectNode, onDeleted: () => void) {
  const confirmed = await confirmAlert({
    title: `Delete ${project.name}?`,
    message:
      project.serviceCount > 0
        ? `This permanently deletes the project and the ${
            project.serviceCount === 1 ? "1 service" : `${project.serviceCount} services`
          } in it, including their volumes and data. This cannot be undone.`
        : "This permanently deletes the project. This cannot be undone.",
    icon: Icon.Trash,
    primaryAction: { title: "Delete Project", style: Alert.ActionStyle.Destructive },
  });
  if (!confirmed) return;

  const toast = await showToast({ style: Toast.Style.Animated, title: `Deleting ${project.name}…` });
  try {
    await removeProject(client, project.projectId);
    toast.style = Toast.Style.Success;
    toast.title = `Deleted ${project.name}`;
    onDeleted();
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = "Could Not Delete Project";
    toast.message = toErrorMessage(error);
  }
}

export default function BrowseProjects() {
  const {
    accounts,
    activeAccount,
    client,
    isLoading: accountsLoading,
    switchAccount,
    hasAccounts,
    reloadAccounts,
  } = useAccounts();
  const { data: projects, isLoading: projectsLoading, revalidate } = useProjects(client);
  const { data: sortedProjects, visitItem, resetRanking } = useProjectFrecency(projects, client);

  if (!accountsLoading && !hasAccounts) {
    return (
      <List>
        <NoAccounts onAccountAdded={reloadAccounts} />
      </List>
    );
  }

  return (
    <List
      isLoading={accountsLoading || projectsLoading}
      searchBarPlaceholder="Search projects…"
      searchBarAccessory={
        <AccountDropdown accounts={accounts} activeAccountId={activeAccount?.id} onChange={switchAccount} />
      }
    >
      <List.EmptyView
        icon={Icon.Folder}
        title="No Projects"
        description="This Dokploy account has no projects yet."
        actions={
          <ActionPanel>
            {client && (
              <Action.Push
                title="Create Project"
                icon={Icon.Plus}
                target={<ProjectForm client={client} onCreated={revalidate} />}
              />
            )}
          </ActionPanel>
        }
      />

      {sortedProjects.map((project) => (
        <List.Item
          key={project.projectId}
          icon={{ source: Icon.Folder, tintColor: Color.Blue }}
          title={project.name}
          subtitle={project.description ?? undefined}
          accessories={[
            {
              text: project.serviceCount === 1 ? "1 service" : `${project.serviceCount} services`,
              icon: Icon.Layers,
            },
          ]}
          actions={
            <ActionPanel>
              <Action.Push
                title="Open Project"
                icon={Icon.ArrowRight}
                onPush={() => visitItem(project)}
                target={
                  client ? <ProjectServices client={client} project={project} onDidChange={revalidate} /> : <List />
                }
              />
              {client && (
                <Action.OpenInBrowser
                  title="Open in Dokploy"
                  url={projectUrl(client.webUrl, project.projectId)}
                  onOpen={() => visitItem(project)}
                  shortcut={Keyboard.Shortcut.Common.Open}
                />
              )}
              <Action
                title="Refresh"
                icon={Icon.ArrowClockwise}
                shortcut={Keyboard.Shortcut.Common.Refresh}
                onAction={revalidate}
              />
              {client && (
                <Action.Push
                  title="Create Project"
                  icon={Icon.Plus}
                  shortcut={Keyboard.Shortcut.Common.New}
                  target={<ProjectForm client={client} onCreated={revalidate} />}
                />
              )}
              <Action title="Reset Ranking" icon={Icon.ArrowCounterClockwise} onAction={() => resetRanking(project)} />
              {client && (
                <Action
                  title="Delete Project"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  // Same slot as deleting a service, which is the same shape of decision.
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                  onAction={() => confirmDelete(client, project, revalidate)}
                />
              )}
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

interface ProjectServicesProps {
  client: DokployClient;
  project: ProjectNode;
  onDidChange: () => void;
}

/** One section per environment, because a service's identity is (project, environment, kind). */
function ProjectServices({ client, project, onDidChange }: ProjectServicesProps) {
  const allServices = project.environments.flatMap((environment) => environment.services);
  const { data: sortedServices, visitItem, resetRanking } = useServiceFrecency(allServices, client);

  const hasAnyService = allServices.length > 0;

  return (
    <List navigationTitle={project.name} searchBarPlaceholder={`Search services in ${project.name}…`}>
      {!hasAnyService && (
        <List.EmptyView
          icon={Icon.Box}
          title="No Services"
          description="This project has no applications, compose stacks or databases yet."
          actions={
            <ActionPanel>
              <Action.OpenInBrowser title="Open in Dokploy" url={projectUrl(client.webUrl, project.projectId)} />
            </ActionPanel>
          }
        />
      )}

      {project.environments.map((environment) => (
        <List.Section
          key={environment.environmentId}
          title={environment.name}
          subtitle={environment.isDefault ? "default" : undefined}
        >
          {/* Filtered out of the frecency-sorted list, so each environment keeps that order. */}
          {sortedServices
            .filter((service) => service.environmentId === environment.environmentId)
            .map((service) => (
              <ServiceListItem
                key={`${service.kind}:${service.id}`}
                client={client}
                service={service}
                onDidChange={onDidChange}
                onVisit={() => visitItem(service)}
                onResetRanking={() => resetRanking(service)}
              />
            ))}
        </List.Section>
      ))}
    </List>
  );
}
