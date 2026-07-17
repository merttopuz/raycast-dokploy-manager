import { Action, ActionPanel, Color, Detail, Icon, Keyboard } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { ReactNode } from "react";
import { fetchBlueprintFile } from "../api/registry";
import { parseTemplateConfig, TemplateDomain, TemplatePreview } from "../lib/template-config";
import { templateLinks } from "../lib/templates";
import { Template } from "../types/dokploy";

interface TemplateDetailProps {
  template: Template;
  /** Rendered first, so the list can keep Deploy as the primary action here too. */
  primaryAction?: ReactNode;
}

/**
 * What a template will create, read from the registry before anything is installed.
 *
 * The two files come straight from the registry over HTTP rather than through Dokploy, because no
 * route serves them - see `api/registry.ts`. They are public, so this works before the user has
 * picked a project and regardless of what their API key can do.
 */
export function TemplateDetail({ template, primaryAction }: TemplateDetailProps) {
  const { data, isLoading } = useCachedPromise(
    async (id: string) => {
      const [toml, compose] = await Promise.all([
        fetchBlueprintFile(id, "template.toml"),
        fetchBlueprintFile(id, "docker-compose.yml"),
      ]);

      // Parsing here rather than in the component keeps the failure inside the hook, where it can
      // be told apart from the file simply being absent.
      let preview: TemplatePreview | undefined;
      let parseError: string | undefined;
      if (toml !== undefined) {
        try {
          preview = parseTemplateConfig(toml);
        } catch (error) {
          parseError = error instanceof Error ? error.message.split("\n")[0] : String(error);
        }
      }

      return { hasToml: toml !== undefined, preview, parseError, compose };
    },
    [template.id],
    { keepPreviousData: false },
  );

  const links = templateLinks(template);

  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={template.name}
      markdown={renderMarkdown(template, data, isLoading)}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Template" text={template.id} />
          <Detail.Metadata.Label title="Version" text={template.version} />
          {template.tags.length > 0 && (
            <Detail.Metadata.TagList title="Tags">
              {template.tags.slice(0, 6).map((tag) => (
                <Detail.Metadata.TagList.Item key={tag} text={tag} />
              ))}
            </Detail.Metadata.TagList>
          )}
          {links.length > 0 && <Detail.Metadata.Separator />}
          {links.map((link) => (
            <Detail.Metadata.Link key={link.title} title={link.title} target={link.url} text={link.url} />
          ))}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          {primaryAction}
          {data?.compose && (
            <Action.Push
              title="View Compose File"
              icon={Icon.Document}
              shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
              target={
                <Detail
                  navigationTitle={`${template.name} - docker-compose.yml`}
                  markdown={`\`\`\`yaml\n${data.compose.trimEnd()}\n\`\`\``}
                  actions={
                    <ActionPanel>
                      <Action.CopyToClipboard title="Copy Compose File" content={data.compose} />
                    </ActionPanel>
                  }
                />
              }
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

interface TemplateData {
  hasToml: boolean;
  preview?: TemplatePreview;
  parseError?: string;
  compose?: string;
}

function renderMarkdown(template: Template, data: TemplateData | undefined, isLoading: boolean): string {
  const header = `## ${template.name}\n\n${template.description}`;

  if (isLoading || !data) return header;

  if (!data.hasToml) {
    return `${header}\n\n_This template publishes no definition, so there is nothing to preview before installing it._`;
  }

  if (data.parseError) {
    // Worth stating plainly rather than softening: Dokploy reads this file with the same grammar
    // when it installs, so a template that cannot be parsed cannot be deployed either.
    return [
      header,
      `> **This template's definition is malformed and Dokploy will fail to install it.**`,
      `> \`${data.parseError}\``,
    ].join("\n\n");
  }

  const preview = data.preview;
  if (!preview) return header;

  return [header, renderDomains(preview), renderEnv(preview), renderMounts(preview), renderLegend(preview)]
    .filter(Boolean)
    .join("\n\n");
}

/** `undefined` host is not "no domain" - Dokploy generates one. See `TemplateDomain.host`. */
function describeDomain(domain: TemplateDomain): string {
  const host = domain.host ?? "_(a generated domain)_";
  const target = [domain.serviceName, domain.port].filter(Boolean).join(":");
  const path = domain.path && domain.path !== "/" ? domain.path : "";
  return `- \`${host}${path}\`${target ? ` → ${target}` : ""}`;
}

function renderDomains(preview: TemplatePreview): string {
  if (preview.domains.length === 0) return "";
  return `### Domains\n${preview.domains.map(describeDomain).join("\n")}`;
}

function renderEnv(preview: TemplatePreview): string {
  if (preview.env.length === 0) return "";
  const lines = preview.env.map((entry) => `${entry.key}=${entry.value}`).join("\n");
  return `### Environment (${preview.env.length})\n\`\`\`\n${lines}\n\`\`\``;
}

function renderMounts(preview: TemplatePreview): string {
  if (preview.mountPaths.length === 0) return "";
  return `### Config Files\n${preview.mountPaths.map((path) => `- \`${path}\``).join("\n")}`;
}

/**
 * The `${…}` tokens above are only meaningful if you know what fills them in, which is what this
 * section is for - it is the legend, not a list of values. There are no values yet.
 */
function renderLegend(preview: TemplatePreview): string {
  if (preview.legend.length === 0) return "";

  const lines = preview.legend.map((entry) => `- \`\${${entry.token}}\` - ${entry.description}`).join("\n");
  return `### Generated on Install\n${lines}`;
}

/** Kept next to the view that uses it, so the list and the detail agree on what a bookmark looks like. */
export function bookmarkIcon(isBookmarked: boolean) {
  return { source: isBookmarked ? Icon.StarCircle : Icon.Star, tintColor: isBookmarked ? Color.Yellow : undefined };
}
