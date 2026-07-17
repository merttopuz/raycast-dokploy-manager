import { useCachedPromise } from "@raycast/utils";
import { DokployClient } from "../api/client";
import { listTemplates } from "../api/dokploy-api";
import { Template } from "../types/dokploy";

/**
 * The template registry.
 *
 * Cached, unlike the other things fetched through a client, and safely so: templates are a public
 * catalogue with nothing secret in them. Worth caching, too - `compose.templates` makes the Dokploy
 * server fetch ~270KB from an upstream registry on every single call.
 *
 * The cache key is the account id rather than the client, for the reason given in `use-projects.ts`:
 * a client carries an API key, and the cache is not encrypted. Keying per account is not just
 * hygiene here either - an instance can point at its own registry, so the catalogue is per account.
 */
export function useTemplates(client?: DokployClient) {
  return useCachedPromise(
    async (accountId?: string): Promise<Template[]> => {
      if (!client || !accountId) return [];
      return listTemplates(client);
    },
    [client?.account.id],
    {
      execute: client !== undefined,
      initialData: [] as Template[],
      failureToastOptions: { title: "Could Not Load Templates" },
    },
  );
}
