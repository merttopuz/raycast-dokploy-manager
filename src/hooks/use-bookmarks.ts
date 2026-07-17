import { showToast, Toast } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useCallback } from "react";
import { DokployClient } from "../api/client";
import { listBookmarkedTemplates, toggleTemplateBookmark } from "../api/dokploy-api";
import { toErrorMessage } from "../api/errors";

/**
 * The templates this account has bookmarked.
 *
 * Cached, and safe to cache: these are public registry slugs, nothing more.
 *
 * Bookmarks are stored per user on the Dokploy side, so they are keyed by account id here - two
 * connected instances have two separate sets, and switching accounts must not show the other's.
 */
export function useBookmarkedTemplates(client?: DokployClient) {
  const { data, isLoading, revalidate, mutate } = useCachedPromise(
    async (accountId?: string): Promise<string[]> => {
      if (!client || !accountId) return [];
      return listBookmarkedTemplates(client);
    },
    [client?.account.id],
    {
      execute: client !== undefined,
      initialData: [] as string[],
      // A bookmark list that won't load is not worth interrupting a template search over: the
      // command's job is deploying templates, and it still does that without them.
      onError: () => {},
    },
  );

  const bookmarked = new Set(data ?? []);

  const toggle = useCallback(
    async (templateId: string, templateName: string) => {
      if (!client) return;

      const wasBookmarked = bookmarked.has(templateId);

      try {
        // Optimistic: the list reorders under the cursor the moment the key is pressed, and the
        // request is only confirming it. `mutate` rolls the row back on its own if it fails.
        await mutate(toggleTemplateBookmark(client, templateId), {
          optimisticUpdate: (current) =>
            wasBookmarked ? (current ?? []).filter((id) => id !== templateId) : [...(current ?? []), templateId],
        });
        await showToast({
          style: Toast.Style.Success,
          title: wasBookmarked ? `Removed ${templateName}` : `Bookmarked ${templateName}`,
        });
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Could Not Update Bookmark",
          message: toErrorMessage(error),
        });
      }
    },
    [client, bookmarked, mutate],
  );

  return { bookmarked, isLoading, revalidate, toggle };
}
