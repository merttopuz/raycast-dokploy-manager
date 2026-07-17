import { Action, ActionPanel, Form, Icon, Keyboard, List, showToast, Toast, useNavigation } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { DokployClient } from "./api/client";
import { deployTemplate, listServers } from "./api/dokploy-api";
import { toErrorMessage } from "./api/errors";
import { AccountDropdown } from "./components/account-dropdown";
import { NoAccounts } from "./components/no-accounts";
import { bookmarkIcon, TemplateDetail } from "./components/template-detail";
import { useAccounts } from "./hooks/use-accounts";
import { useBookmarkedTemplates } from "./hooks/use-bookmarks";
import { useProjects } from "./hooks/use-projects";
import { useTemplates } from "./hooks/use-templates";
import { normalizeTag, templateKeywords, templateLinks, templateLogoUrl } from "./lib/templates";
import { Template } from "./types/dokploy";

export default function DeployTemplate() {
  const {
    accounts,
    activeAccount,
    client,
    isLoading: accountsLoading,
    switchAccount,
    hasAccounts,
    reloadAccounts,
  } = useAccounts();
  const { data: templates, isLoading: templatesLoading } = useTemplates(client);
  const { bookmarked, isLoading: bookmarksLoading, toggle } = useBookmarkedTemplates(client);

  if (!accountsLoading && !hasAccounts) {
    return (
      <List>
        <NoAccounts onAccountAdded={reloadAccounts} />
      </List>
    );
  }

  // Bookmarks are matched against the catalogue rather than rendered from the stored ids: nothing
  // removes a bookmark when a template leaves the registry, so an id can outlive the template it
  // names. Intersecting means a stale one quietly does nothing instead of drawing an empty row.
  const favourites = templates.filter((template) => bookmarked.has(template.id));
  const rest = templates.filter((template) => !bookmarked.has(template.id));

  return (
    <List
      isLoading={accountsLoading || templatesLoading || bookmarksLoading}
      searchBarPlaceholder="Search templates by name or tag…"
      // The detail pane earns its place here: descriptions are a paragraph long and there are
      // hundreds of these, so a subtitle would truncate every one of them.
      isShowingDetail={templates.length > 0}
      searchBarAccessory={
        <AccountDropdown accounts={accounts} activeAccountId={activeAccount?.id} onChange={switchAccount} />
      }
    >
      <List.EmptyView
        icon={Icon.Box}
        title="No Templates"
        description="This Dokploy instance returned no templates from its registry."
      />

      {/* Sections rather than a sort, so the split survives filtering: Raycast searches within a
          section, and a bookmarked match stays visibly a bookmark instead of merely being first. */}
      {favourites.length > 0 && (
        <List.Section title="Bookmarked">
          {favourites.map((template) => (
            <TemplateItem
              key={template.id}
              client={client}
              template={template}
              isBookmarked
              onToggleBookmark={toggle}
            />
          ))}
        </List.Section>
      )}

      <List.Section title={favourites.length > 0 ? "All Templates" : undefined}>
        {rest.map((template) => (
          <TemplateItem
            key={template.id}
            client={client}
            template={template}
            isBookmarked={false}
            onToggleBookmark={toggle}
          />
        ))}
      </List.Section>
    </List>
  );
}

interface TemplateItemProps {
  client?: DokployClient;
  template: Template;
  isBookmarked: boolean;
  onToggleBookmark: (templateId: string, templateName: string) => void;
}

function TemplateItem({ client, template, isBookmarked, onToggleBookmark }: TemplateItemProps) {
  const logo = templateLogoUrl(template);
  const links = templateLinks(template);

  // `["AI", "ai"]` on one template is one tag shown once. The first spelling wins, so the registry's
  // own capitalisation survives where it has one.
  const tags = [...new Map(template.tags.map((tag) => [normalizeTag(tag), tag.trim()])).values()].filter(Boolean);

  return (
    <List.Item
      icon={logo ? { source: logo, fallback: Icon.Box } : Icon.Box}
      title={template.name}
      keywords={templateKeywords(template)}
      detail={
        <List.Item.Detail
          markdown={`# ${template.name}\n\n${template.description}`}
          metadata={
            <List.Item.Detail.Metadata>
              <List.Item.Detail.Metadata.Label title="Version" text={template.version} />
              {tags.length > 0 && (
                <List.Item.Detail.Metadata.TagList title="Tags">
                  {tags.map((tag) => (
                    <List.Item.Detail.Metadata.TagList.Item key={tag} text={tag} />
                  ))}
                </List.Item.Detail.Metadata.TagList>
              )}
              {links.length > 0 && <List.Item.Detail.Metadata.Separator />}
              {links.map((link) => (
                <List.Item.Detail.Metadata.Link key={link.title} title={link.title} target={link.url} text={link.url} />
              ))}
            </List.Item.Detail.Metadata>
          }
        />
      }
      actions={
        <ActionPanel>
          {client && (
            <Action.Push
              title="Deploy Template"
              icon={Icon.Rocket}
              target={<DeployTemplateForm client={client} template={template} />}
            />
          )}
          {/* What the template will actually create - the question you have before installing it,
              and the one the catalogue's description never answers. */}
          <Action.Push
            title="Show Template Details"
            icon={Icon.Eye}
            shortcut={{ modifiers: ["cmd"], key: "d" }}
            target={
              <TemplateDetail
                template={template}
                primaryAction={
                  client ? (
                    <Action.Push
                      title="Deploy Template"
                      icon={Icon.Rocket}
                      target={<DeployTemplateForm client={client} template={template} />}
                    />
                  ) : undefined
                }
              />
            }
          />
          {client && (
            <Action
              title={isBookmarked ? "Remove Bookmark" : "Bookmark Template"}
              icon={bookmarkIcon(isBookmarked)}
              shortcut={{ modifiers: ["cmd"], key: "b" }}
              onAction={() => onToggleBookmark(template.id, template.name)}
            />
          )}
          {links.map((link) => (
            <Action.OpenInBrowser key={link.title} title={`Open ${link.title}`} url={link.url} />
          ))}
          <Action.CopyToClipboard
            title="Copy Template ID"
            content={template.id}
            shortcut={Keyboard.Shortcut.Common.Copy}
          />
        </ActionPanel>
      }
    />
  );
}

interface DeployTemplateFormProps {
  client: DokployClient;
  template: Template;
}

/**
 * Picks where a template lands.
 *
 * Dokploy installs a template into an *environment*, so a project alone isn't enough - and since
 * most projects have more than one, dropping it into the wrong one is the easy mistake this form
 * exists to prevent.
 */
function DeployTemplateForm({ client, template }: DeployTemplateFormProps) {
  const { data: projects, isLoading: projectsLoading } = useProjects(client);
  const { pop } = useNavigation();
  const [isDeploying, setIsDeploying] = useState(false);

  // Servers are an optional Dokploy feature and a scoped key may not be allowed to list them.
  // Failing to read them means "deploy to the Dokploy host", not "the whole form is broken".
  const { data: servers } = usePromise(async () => {
    try {
      return await listServers(client);
    } catch {
      return [];
    }
  }, []);

  const [projectId, setProjectId] = useState<string | undefined>();
  const [environmentId, setEnvironmentId] = useState<string | undefined>();
  const [serverId, setServerId] = useState<string>("");

  // Selection is derived rather than synced in an effect: when the project changes, the environment
  // id held in state stops matching anything in the new project and the fallbacks below take over,
  // which is exactly the wanted behaviour and needs no effect to achieve.
  const selectedProject = projects.find((project) => project.projectId === projectId) ?? projects[0];
  const environments = selectedProject?.environments ?? [];
  const selectedEnvironment =
    environments.find((environment) => environment.environmentId === environmentId) ??
    environments.find((environment) => environment.isDefault) ??
    environments[0];

  const hasSomewhereToDeploy = !projectsLoading && selectedEnvironment !== undefined;

  async function submit() {
    if (!selectedEnvironment || !selectedProject) return;

    setIsDeploying(true);
    const toast = await showToast({ style: Toast.Style.Animated, title: `Deploying ${template.name}…` });

    try {
      await deployTemplate(client, {
        environmentId: selectedEnvironment.environmentId,
        id: template.id,
        serverId: serverId === "" ? undefined : serverId,
      });
      toast.style = Toast.Style.Success;
      toast.title = `Deployed ${template.name}`;
      toast.message = `Added to ${selectedProject.name} / ${selectedEnvironment.name}.`;
      pop();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = `Could Not Deploy ${template.name}`;
      toast.message = toErrorMessage(error);
    } finally {
      setIsDeploying(false);
    }
  }

  return (
    <Form
      isLoading={projectsLoading || isDeploying}
      navigationTitle={`Deploy ${template.name}`}
      actions={
        <ActionPanel>
          {hasSomewhereToDeploy && <Action.SubmitForm title="Deploy" icon={Icon.Rocket} onSubmit={submit} />}
        </ActionPanel>
      }
    >
      <Form.Description title={template.name} text={`${template.description}\n\nVersion: ${template.version}`} />

      {!projectsLoading && projects.length === 0 && (
        <Form.Description
          title="No Projects"
          text="Templates are installed into a project's environment, and this account has none yet. Create one in Dokploy first."
        />
      )}

      {/* Held back until there is something to put in them: a controlled dropdown whose value
          matches none of its (zero) items is not a state worth rendering. */}
      {projects.length > 0 && (
        <>
          <Form.Dropdown id="project" title="Project" value={selectedProject?.projectId ?? ""} onChange={setProjectId}>
            {projects.map((project) => (
              <Form.Dropdown.Item key={project.projectId} value={project.projectId} title={project.name} />
            ))}
          </Form.Dropdown>

          <Form.Dropdown
            id="environment"
            title="Environment"
            value={selectedEnvironment?.environmentId ?? ""}
            onChange={setEnvironmentId}
          >
            {environments.map((environment) => (
              <Form.Dropdown.Item
                key={environment.environmentId}
                value={environment.environmentId}
                title={environment.isDefault ? `${environment.name} (default)` : environment.name}
              />
            ))}
          </Form.Dropdown>

          {servers && servers.length > 0 && (
            <Form.Dropdown id="server" title="Server" value={serverId} onChange={setServerId}>
              <Form.Dropdown.Item value="" title="Dokploy host" />
              {servers.map((server) => (
                <Form.Dropdown.Item key={server.serverId} value={server.serverId} title={server.name} />
              ))}
            </Form.Dropdown>
          )}
        </>
      )}
    </Form>
  );
}
