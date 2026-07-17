import { Action, ActionPanel, Color, Icon, List, Keyboard } from "@raycast/api";
import { DokployClient } from "./api/client";
import { AccountDropdown } from "./components/account-dropdown";
import { NoAccounts } from "./components/no-accounts";
import { ServiceListItem } from "./components/service-list-item";
import { useAccounts } from "./hooks/use-accounts";
import { useProjectFrecency, useServiceFrecency } from "./hooks/use-frecency";
import { ProjectNode, useProjects } from "./hooks/use-projects";
import { projectUrl } from "./lib/urls";

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
      <List.EmptyView icon={Icon.Folder} title="No Projects" description="This Dokploy account has no projects yet." />

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
              <Action title="Reset Ranking" icon={Icon.ArrowCounterClockwise} onAction={() => resetRanking(project)} />
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
