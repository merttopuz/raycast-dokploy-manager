import { useFrecencySorting } from "@raycast/utils";
import { DokployClient } from "../api/client";
import { ProjectNode } from "./use-projects";
import { ServiceRef } from "../types/dokploy";

/**
 * Frecency rankings are stored per account.
 *
 * "The api you deploy ten times a day" is a fact about one Dokploy instance, not about every
 * instance you've connected, and two instances routinely have a service called `api`. Without the
 * account in the namespace their rankings would be merged into one.
 *
 * The account *id* is safe to use here - it's a local uuid, not the URL or the API key.
 */
function namespaceFor(scope: string, client?: DokployClient): string {
  return `${scope}:${client?.account.id ?? "none"}`;
}

/**
 * Orders services by how often and how recently they've been acted on.
 *
 * `id` alone is not a usable key: it is only unique *within* a kind, so an application and a
 * database on the same instance can collide. The kind is part of the key for the same reason it is
 * part of every React key in this codebase.
 */
export function useServiceFrecency(services: ServiceRef[], client?: DokployClient) {
  return useFrecencySorting(services, {
    namespace: namespaceFor("services", client),
    key: (service) => `${service.kind}:${service.id}`,
  });
}

export function useProjectFrecency(projects: ProjectNode[], client?: DokployClient) {
  return useFrecencySorting(projects, {
    namespace: namespaceFor("projects", client),
    key: (project) => project.projectId,
  });
}
