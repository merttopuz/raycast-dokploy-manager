import { Template } from "../types/dokploy";

/** What `compose.templates` falls back to when no `baseUrl` is given. */
export const DEFAULT_TEMPLATE_BASE_URL = "https://templates.dokploy.com";

/**
 * Where a template's logo actually lives.
 *
 * `logo` is a bare filename and nothing more - no path, no URL - and it is *not* unique: dozens of
 * templates call theirs `logo.png`. It only means anything namespaced by the template's id, which
 * is the registry's directory slug:
 *
 *     https://templates.dokploy.com/blueprints/uptime-kuma/uptime-kuma.png
 */
export function templateLogoUrl(template: Template, baseUrl: string = DEFAULT_TEMPLATE_BASE_URL): string | undefined {
  if (!template.logo) return undefined;
  return `${baseUrl.replace(/\/+$/, "")}/blueprints/${template.id}/${template.logo}`;
}

/**
 * The registry's tags are not normalised: `monitoring` and `Monitoring` are both in there, as are
 * `open-source` and `Open Source`. Folding case and spaces means a search for one finds the other.
 */
export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * What to make searchable for a template.
 *
 * Tags carry most of the discovery value here - "monitoring" should find Uptime Kuma even though
 * the word appears nowhere in its name - so they go in alongside the id. Both the raw and the
 * normalised form are kept, so "Open Source" and "open-source" each match.
 */
export function templateKeywords(template: Template): string[] {
  const keywords = new Set<string>([template.id]);
  for (const tag of template.tags) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    keywords.add(trimmed);
    keywords.add(normalizeTag(trimmed));
  }
  return [...keywords];
}

/** Registry links are sometimes present but empty, which would render a broken action. */
export function templateLinks(template: Template): { title: string; url: string }[] {
  const candidates: { title: string; url: string | undefined }[] = [
    { title: "Website", url: template.links.website },
    { title: "GitHub", url: template.links.github },
    { title: "Documentation", url: template.links.docs },
    { title: "Docker Hub", url: template.links.dockerhub ?? template.links.docker },
    { title: "Discord", url: template.links.discord },
  ];

  return candidates.filter((link): link is { title: string; url: string } => Boolean(link.url && link.url.trim()));
}
