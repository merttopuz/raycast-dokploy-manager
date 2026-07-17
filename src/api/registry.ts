import { DEFAULT_TEMPLATE_BASE_URL } from "../lib/templates";

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The blueprint files a template is made of.
 *
 * `instructions.md` is deliberately absent. It exists in exactly one of the registry's ~476
 * blueprints and Dokploy's server never reads it, so there is nothing to show and no reason to ask.
 */
export type BlueprintFile = "template.toml" | "docker-compose.yml";

/**
 * Reads one of a template's blueprint files straight from the registry.
 *
 * This is the only thing in the extension that talks to a host other than the user's Dokploy
 * instance, and it has to: `compose.templates` returns the catalogue's metadata and nothing else -
 * there is no route that serves a template's compose file or its toml, so the registry is the only
 * source. Nothing here is authenticated or private; it is the same public catalogue the Dokploy
 * server itself fetches.
 */
export async function fetchBlueprintFile(
  templateId: string,
  file: BlueprintFile,
  baseUrl: string = DEFAULT_TEMPLATE_BASE_URL,
): Promise<string | undefined> {
  const url = `${baseUrl.replace(/\/+$/, "")}/blueprints/${templateId}/${file}`;

  const response = await fetch(url, {
    headers: { Accept: "text/plain, */*" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) return undefined;

  const body = await response.text();
  return looksLikeTheSpa(response, body) ? undefined : body;
}

/**
 * Whether the registry answered with its own web page instead of the file that was asked for.
 *
 * This is the whole reason this module is not three lines. `templates.dokploy.com` is a
 * single-page app on a static host, and **it never returns 404**: a missing blueprint file comes
 * back as `200 text/html` with the app's `index.html` in the body. So `response.ok` is always
 * true, and a caller that trusts it hands `<!doctype html>` to a TOML parser and reports a
 * mangled syntax error for what is really a file that does not exist.
 *
 * Content type is the reliable signal - the real files are served as `application/toml` and
 * `application/yaml`. The body sniff is there for a self-hosted registry that serves everything
 * as `text/plain` or with no type at all.
 */
function looksLikeTheSpa(response: Response, body: string): boolean {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) return true;
  return /^\s*<!doctype html/i.test(body);
}
