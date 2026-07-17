import { ServiceAction, serviceKindConfig, SERVICE_KIND_LIST } from "../lib/service-kinds";
import {
  Application,
  CentralizedDeployment,
  Compose,
  Database,
  DatabaseKind,
  Deployment,
  Domain,
  Environment,
  NestedService,
  Organization,
  Project,
  Server,
  ServiceKind,
  ServiceRef,
  ServiceStatus,
  SessionUser,
  Template,
} from "../types/dokploy";
import { DokployClient } from "./client";

/* ------------------------------------------------------------------ account / identity */

export function getSession(client: DokployClient): Promise<SessionUser> {
  return client.get<SessionUser>("user.get");
}

export function listOrganizations(client: DokployClient): Promise<Organization[]> {
  return client.get<Organization[]>("organization.all");
}

export function listServers(client: DokployClient): Promise<Server[]> {
  return client.get<Server[]>("server.all");
}

/**
 * Cheapest authenticated call we can make to prove a URL + API key pair actually works,
 * used when adding an account so the user finds out immediately rather than on first use.
 */
export async function verifyCredentials(client: DokployClient): Promise<SessionUser> {
  return getSession(client);
}

/* ------------------------------------------------------------------ projects */

export function listProjects(client: DokployClient): Promise<Project[]> {
  return client.get<Project[]>("project.all");
}

export function getProject(client: DokployClient, projectId: string): Promise<Project> {
  return client.get<Project>("project.one", { projectId });
}

export function createProject(client: DokployClient, input: { name: string; description?: string }): Promise<Project> {
  return client.post<Project>("project.create", input);
}

export function removeProject(client: DokployClient, projectId: string): Promise<unknown> {
  return client.post("project.remove", { projectId });
}

export function listEnvironments(client: DokployClient, projectId: string): Promise<Environment[]> {
  return client.get<Environment[]>("environment.byProjectId", { projectId });
}

/* ------------------------------------------------------------------ services */

/** Reads the id off a raw nested row, whatever its kind-specific id field is called. */
function readServiceId(row: NestedService, kind: ServiceKind): string | undefined {
  const value = row[serviceKindConfig(kind).idField];
  return typeof value === "string" ? value : undefined;
}

function readServiceStatus(row: NestedService, kind: ServiceKind): ServiceStatus | undefined {
  return row[serviceKindConfig(kind).statusField] as ServiceStatus | undefined;
}

/**
 * Walks the project -> environment -> service tree and flattens it into a single list.
 * Rows without an id are skipped rather than rendered as broken entries.
 */
export function flattenServices(projects: Project[]): ServiceRef[] {
  const services: ServiceRef[] = [];

  for (const project of projects) {
    for (const environment of project.environments ?? []) {
      for (const config of SERVICE_KIND_LIST) {
        // `environmentKey`, not `namespace`: applications live under `applications` (plural),
        // while the other seven kinds happen to match their route namespace.
        const rows = environment[config.environmentKey];
        if (!Array.isArray(rows)) continue;

        for (const row of rows) {
          const id = readServiceId(row, config.kind);
          if (!id) continue;

          services.push({
            kind: config.kind,
            id,
            // Left empty rather than defaulted to the kind label, because an empty name is a fact
            // (`project.all` didn't send one) that `enrichServices` can then go and fix. Defaulting
            // here is what made every database render as a nameless "PostgreSQL - Unknown".
            name: row.name ?? "",
            status: readServiceStatus(row, config.kind),
            appName: row.appName,
            description: row.description ?? null,
            projectId: project.projectId,
            projectName: project.name,
            environmentId: environment.environmentId,
            environmentName: environment.name,
          });
        }
      }
    }
  }

  return services;
}

/**
 * Fills in services that `project.all` returned only an id for.
 *
 * Dokploy's project tree is not uniform: applications and compose stacks come back with their
 * name and status, but **database rows carry nothing but their id**. Those services would
 * otherwise render as a nameless row with an unknown status, so each one is topped up from its
 * own detail route.
 *
 * Only the incomplete services cost a request, so this is free when Dokploy sends everything -
 * and it fixes itself if a future version starts doing so.
 */
export async function enrichServices(client: DokployClient, services: ServiceRef[]): Promise<ServiceRef[]> {
  const incomplete = services.filter((service) => !service.name || !service.status);
  if (incomplete.length === 0) return services;

  const details = await Promise.allSettled(incomplete.map((service) => getService(client, service.kind, service.id)));

  const filled = new Map<string, ServiceRef>();
  incomplete.forEach((service, index) => {
    const result = details[index];
    // A service we can't reach keeps whatever the tree gave us rather than dropping out of the list.
    if (result.status !== "fulfilled") return;

    const detail = result.value as NestedService;
    filled.set(`${service.kind}:${service.id}`, {
      ...service,
      name: detail.name ?? service.name,
      appName: detail.appName ?? service.appName,
      status: readServiceStatus(detail, service.kind) ?? service.status,
      description: detail.description ?? service.description ?? null,
    });
  });

  return services.map((service) => filled.get(`${service.kind}:${service.id}`) ?? service);
}

export function getService(client: DokployClient, kind: ServiceKind, id: string): Promise<Application | Compose> {
  const config = serviceKindConfig(kind);
  return client.get<Application | Compose>(`${config.namespace}.one`, { [config.idField]: id });
}

/**
 * Runs a lifecycle action against a service.
 *
 * Two routes need more than the id, which is why this goes through one place:
 * `reload` also wants `appName`, and `compose.delete` requires `deleteVolumes`.
 */
export async function runServiceAction(
  client: DokployClient,
  service: ServiceRef,
  action: ServiceAction,
  options: { deleteVolumes?: boolean } = {},
): Promise<void> {
  const config = serviceKindConfig(service.kind);
  const route = config.routes[action];
  if (!route) {
    throw new Error(`${config.label} does not support ${action}.`);
  }

  const body: Record<string, unknown> = { [config.idField]: service.id };

  if (action === "reload") {
    const appName = service.appName ?? (await resolveAppName(client, service));
    if (!appName) {
      throw new Error(`Could not resolve the container name for ${service.name}.`);
    }
    body.appName = appName;
  }

  if (action === "remove" && service.kind === "compose") {
    body.deleteVolumes = options.deleteVolumes ?? false;
  }

  await client.post(`${config.namespace}.${route}`, body);
}

/** `appName` isn't in the project tree for scoped users, so fall back to the detail route. */
async function resolveAppName(client: DokployClient, service: ServiceRef): Promise<string | undefined> {
  const detail = (await getService(client, service.kind, service.id)) as NestedService;
  return detail.appName;
}

/* ------------------------------------------------------------------ templates */

/**
 * The ready-made compose stacks available to this instance.
 *
 * Dokploy proxies a registry here rather than answering from its own database, so this is a
 * network call to `templates.dokploy.com` made *by the server* - it's slow and it's ~270KB for
 * around 500 templates, which is why the command caches it.
 */
export function listTemplates(client: DokployClient, baseUrl?: string): Promise<Template[]> {
  return client.get<Template[]>("compose.templates", { baseUrl });
}

/**
 * Installs a template into an environment, creating the compose service and deploying it.
 *
 * `id` is the template's registry slug (`uptime-kuma`), not an id from this instance: the server
 * resolves it back to `<baseUrl>/blueprints/<id>/` to fetch the compose file. `serverId` picks
 * which machine runs it, and omitting it means the Dokploy host itself.
 */
export function deployTemplate(
  client: DokployClient,
  input: { environmentId: string; id: string; serverId?: string },
): Promise<unknown> {
  return client.post("compose.deployTemplate", input);
}

/* ------------------------------------------------------------------ databases */

/**
 * The typed sibling of `getService` for the six database kinds.
 *
 * What comes back carries the database password in the clear, so - like every other route that
 * returns a secret - callers must fetch it through `usePromise`. `useCachedPromise` would write it
 * to Raycast's unencrypted on-disk cache.
 */
export function getDatabase(client: DokployClient, kind: DatabaseKind, id: string): Promise<Database> {
  const config = serviceKindConfig(kind);
  return client.get<Database>(`${config.namespace}.one`, { [config.idField]: id });
}

/**
 * The address a service is reachable at from outside the server.
 *
 * Mirrors the dashboard's own rule (`server?.ipAddress || settings.getIp`): a service pinned to a
 * remote server answers on that server's IP, everything else on the Dokploy host's configured one.
 * Undefined when no IP is set at all, which Dokploy also treats as "no external URL can be formed"
 * rather than guessing.
 */
export async function resolveExternalHost(
  client: DokployClient,
  serverId?: string | null,
): Promise<string | undefined> {
  if (serverId) {
    const server = await client.get<Server>("server.one", { serverId });
    return server.ipAddress || undefined;
  }
  const ip = await client.get<string>("settings.getIp");
  return typeof ip === "string" && ip.length > 0 ? ip : undefined;
}

/* ------------------------------------------------------------------ environment variables */

/**
 * A service's environment variables, as the single newline-separated `KEY=value` string Dokploy
 * stores - comments and blank lines included, since they round-trip through the save route.
 *
 * `null` means the service has never had any set, which Dokploy reports differently from an empty
 * string; both are rendered the same way, but neither is invented on the way back out.
 */
export async function readServiceEnv(client: DokployClient, service: ServiceRef): Promise<string | null> {
  const config = serviceKindConfig(service.kind);
  const detail = await client.get<{ env?: string | null }>(`${config.namespace}.one`, {
    [config.idField]: service.id,
  });
  return detail.env ?? null;
}

/**
 * Writes a service's environment variables back.
 *
 * `application.saveEnvironment` is the trap here. Every other kind takes `{ <kind>Id, env }`, but
 * the application route *requires* `buildArgs`, `buildSecrets` and `createEnvFile` on every call:
 * sending only `env` fails validation, and sending them as empty defaults silently wipes the user's
 * build secrets. So the current values are read back and echoed in untouched.
 */
export async function saveServiceEnv(client: DokployClient, service: ServiceRef, env: string): Promise<void> {
  const config = serviceKindConfig(service.kind);

  if (service.kind === "application") {
    const current = await client.get<Application>("application.one", { applicationId: service.id });
    await client.post("application.saveEnvironment", {
      applicationId: service.id,
      env,
      buildArgs: current.buildArgs ?? null,
      buildSecrets: current.buildSecrets ?? null,
      createEnvFile: current.createEnvFile ?? false,
    });
    return;
  }

  await client.post(`${config.namespace}.saveEnvironment`, {
    [config.idField]: service.id,
    env,
  });
}

/* ------------------------------------------------------------------ logs */

export interface LogOptions {
  tail?: number;
  since?: string;
  search?: string;
  /** Compose stacks are multi-container, so logs can be scoped to one of them. */
  containerId?: string;
}

/** Log routes answer with plain text, which the client passes through untouched. */
export async function readServiceLogs(
  client: DokployClient,
  service: ServiceRef,
  options: LogOptions = {},
): Promise<string> {
  const config = serviceKindConfig(service.kind);
  const result = await client.get<unknown>(`${config.namespace}.readLogs`, {
    [config.idField]: service.id,
    tail: options.tail,
    since: options.since,
    search: options.search,
    ...(service.kind === "compose" && options.containerId ? { containerId: options.containerId } : {}),
  });

  if (typeof result === "string") return result;
  if (Array.isArray(result)) return result.join("\n");
  return result ? JSON.stringify(result, null, 2) : "";
}

/* ------------------------------------------------------------------ deployments & domains */

/** Only applications and compose stacks keep a deployment history. */
export function listDeployments(client: DokployClient, service: ServiceRef): Promise<Deployment[]> {
  if (service.kind === "application") {
    return client.get<Deployment[]>("deployment.all", { applicationId: service.id });
  }
  if (service.kind === "compose") {
    return client.get<Deployment[]>("deployment.allByCompose", { composeId: service.id });
  }
  return Promise.resolve([]);
}

/**
 * Every deployment on the instance in one request, with the owning application or compose stack
 * nested in. The menu bar uses this instead of asking each service for its history in turn.
 */
export function listAllDeployments(client: DokployClient): Promise<CentralizedDeployment[]> {
  return client.get<CentralizedDeployment[]>("deployment.allCentralized");
}

/**
 * Rebuilds the ServiceRef a centralized deployment belongs to, so it can be linked and acted on.
 *
 * Returns undefined for deployments that aren't a service build at all - the same table also
 * stores schedule, backup and volume-backup runs, and those have neither an application nor a
 * compose stack attached.
 */
export function deploymentServiceRef(deployment: CentralizedDeployment): ServiceRef | undefined {
  const owner = deployment.application ?? deployment.compose;
  if (!owner) return undefined;

  const kind: ServiceKind = deployment.application ? "application" : "compose";
  const id = deployment.application?.applicationId ?? deployment.compose?.composeId;
  const environment = owner.environment;
  const project = environment?.project;

  if (!id || !environment?.environmentId || !project?.projectId) return undefined;

  return {
    kind,
    id,
    name: owner.name ?? kind,
    appName: owner.appName,
    projectId: project.projectId,
    projectName: project.name ?? "",
    environmentId: environment.environmentId,
    environmentName: environment.name ?? "",
  };
}

/**
 * The build log of a single deployment - the thing you actually want when a deploy fails.
 * Like the service log routes, this answers with plain text.
 */
export async function readDeploymentLogs(client: DokployClient, deploymentId: string, tail?: number): Promise<string> {
  const result = await client.get<unknown>("deployment.readLogs", { deploymentId, tail });
  if (typeof result === "string") return result;
  if (Array.isArray(result)) return result.join("\n");
  return result ? JSON.stringify(result, null, 2) : "";
}

/** Kills the build process behind a running deployment. */
export function killDeployment(client: DokployClient, deploymentId: string): Promise<unknown> {
  return client.post("deployment.killProcess", { deploymentId });
}

export function removeDeployment(client: DokployClient, deploymentId: string): Promise<unknown> {
  return client.post("deployment.removeDeployment", { deploymentId });
}

/** Cancels whatever deployment is currently queued or running for a service. */
export function cancelDeployment(client: DokployClient, service: ServiceRef): Promise<unknown> {
  const config = serviceKindConfig(service.kind);
  if (!config.hasDeployments) {
    throw new Error(`${config.label} services do not have deployments.`);
  }
  return client.post(`${config.namespace}.cancelDeployment`, { [config.idField]: service.id });
}

/**
 * Restores a previous deployment. Only deployments that produced a rollback point carry a
 * `rollbackId`, and that id - not the deployment's - is what the route takes.
 */
export function rollbackToDeployment(client: DokployClient, rollbackId: string): Promise<unknown> {
  return client.post("rollback.rollback", { rollbackId });
}

export function listDomains(client: DokployClient, service: ServiceRef): Promise<Domain[]> {
  if (service.kind === "application") {
    return client.get<Domain[]>("domain.byApplicationId", { applicationId: service.id });
  }
  if (service.kind === "compose") {
    return client.get<Domain[]>("domain.byComposeId", { composeId: service.id });
  }
  return Promise.resolve([]);
}
