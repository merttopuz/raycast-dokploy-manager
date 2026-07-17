import { CleanupTask, cleanupTaskConfig } from "../lib/cleanup-tasks";
import { ServiceAction, serviceKindConfig, SERVICE_KIND_LIST } from "../lib/service-kinds";
import {
  Application,
  Backup,
  CentralizedDeployment,
  CertificateType,
  Compose,
  ContainerInfo,
  Database,
  DatabaseKind,
  Deployment,
  DockerDiskUsageRow,
  Domain,
  DomainValidation,
  Environment,
  MetricsToken,
  NestedService,
  Organization,
  Project,
  Schedule,
  Server,
  ServerMetricsPoint,
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

/**
 * Creates a project, and with it the default environment every service has to live in.
 *
 * The response is `{ project, environment }` and not a bare project - Dokploy makes the two
 * together, because a project with no environment could not hold anything.
 */
export function createProject(
  client: DokployClient,
  input: { name: string; description?: string },
): Promise<{ project: Project; environment: Environment }> {
  return client.post<{ project: Project; environment: Environment }>("project.create", input);
}

/** Deletes the project and everything in it. Dokploy does not ask twice; callers must. */
export function removeProject(client: DokployClient, projectId: string): Promise<Project> {
  return client.post<Project>("project.remove", { projectId });
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

/**
 * The registry slugs this user has bookmarked - ids only, not templates.
 *
 * Per *user*, not per organization: they live in a `bookmarkedTemplates` column on the user row,
 * so they follow whoever the account's API key belongs to. Nothing validates that a slug still
 * exists in the registry, which is why callers match these against the catalogue rather than
 * rendering them.
 */
export async function listBookmarkedTemplates(client: DokployClient): Promise<string[]> {
  const ids = await client.get<string[]>("user.getBookmarkedTemplates");
  return Array.isArray(ids) ? ids : [];
}

/** Adds or removes a bookmark, and answers with which of the two it just did. */
export function toggleTemplateBookmark(client: DokployClient, templateId: string): Promise<{ isBookmarked: boolean }> {
  return client.post<{ isBookmarked: boolean }>("user.toggleTemplateBookmark", { templateId });
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
 * Everything `application.saveEnvironment` writes in one go.
 *
 * Grouped rather than passed separately because the route takes them together and there is no way
 * to write one without the others - see `saveServiceEnv`. `null` and `""` are kept apart all the
 * way through: Dokploy distinguishes "never set" from "set to nothing", and so does this.
 */
export interface ServiceEnvironment {
  env: string | null;
  /** Applications only. `--build-arg` values, in the same `KEY=value` format as `env`. */
  buildArgs: string | null;
  /** Applications only. BuildKit secrets - mounted during the build, never baked into the image. */
  buildSecrets: string | null;
  /** Whether Dokploy materialises `env` into a `.env` file next to the source. */
  createEnvFile: boolean;
  /** False for the seven kinds that have no build of their own to configure. */
  supportsBuildFields: boolean;
}

/**
 * A service's environment variables, as the single newline-separated `KEY=value` string Dokploy
 * stores - comments and blank lines included, since they round-trip through the save route.
 *
 * Applications carry two more of these strings, and they are read here rather than on demand
 * because the save route cannot write one without all three anyway.
 */
export async function readServiceEnv(client: DokployClient, service: ServiceRef): Promise<ServiceEnvironment> {
  const config = serviceKindConfig(service.kind);
  const detail = await client.get<Application>(`${config.namespace}.one`, {
    [config.idField]: service.id,
  });

  const isApplication = service.kind === "application";

  return {
    env: detail.env ?? null,
    buildArgs: isApplication ? (detail.buildArgs ?? null) : null,
    buildSecrets: isApplication ? (detail.buildSecrets ?? null) : null,
    createEnvFile: isApplication ? (detail.createEnvFile ?? false) : false,
    supportsBuildFields: isApplication,
  };
}

/**
 * Writes a service's environment back.
 *
 * `application.saveEnvironment` is the trap here. Every other kind takes `{ <kind>Id, env }`, but
 * the application route *requires* `buildArgs`, `buildSecrets` and `createEnvFile` on every call:
 * sending only `env` fails validation, and sending them as empty defaults silently wipes the
 * user's build secrets. Which is why this takes the whole `ServiceEnvironment` rather than a
 * string - a caller that only wants to change `env` still has to say what the rest are, and the
 * only safe answer is the values it was shown.
 */
export async function saveServiceEnv(
  client: DokployClient,
  service: ServiceRef,
  environment: ServiceEnvironment,
): Promise<void> {
  const config = serviceKindConfig(service.kind);

  if (service.kind === "application") {
    await client.post("application.saveEnvironment", {
      applicationId: service.id,
      env: environment.env,
      buildArgs: environment.buildArgs,
      buildSecrets: environment.buildSecrets,
      createEnvFile: environment.createEnvFile,
    });
    return;
  }

  await client.post(`${config.namespace}.saveEnvironment`, {
    [config.idField]: service.id,
    env: environment.env,
  });
}

/* ------------------------------------------------------------------ containers */

/** What Docker reports when Dokploy could not parse a field out of `docker ps`. */
const CONTAINER_STATE_UNKNOWN = "No state";

export function isContainerRunning(container: ContainerInfo): boolean {
  return container.state === "running";
}

/** Containers whose name Dokploy couldn't read can't be asked for logs either. */
export function isUsableContainer(container: ContainerInfo): boolean {
  return container.containerId.length > 0 && !container.containerId.startsWith("No container");
}

/**
 * The containers a compose stack is actually running.
 *
 * This is the route to use rather than `compose.loadServices`, which is a tempting near-miss:
 * `loadServices` parses the compose *file* and returns its service keys, but `compose.readLogs`
 * runs `docker container logs <containerId>` against the raw value it is given and never resolves
 * a name to an id. A service key from `loadServices` is not a container, so it fails.
 *
 * `appType` matters - `docker-compose` filters on the compose project label, anything else falls
 * back to matching the container name - and `serverId` more so: omit it for a stack pinned to a
 * remote server and Docker is queried on the wrong machine, which reports no containers rather
 * than an error.
 *
 * Which is the caveat worth knowing: this route swallows *every* failure and answers `[]`. A stack
 * that is stopped, a server that is unreachable and a name that doesn't exist are indistinguishable
 * here, so an empty list is only ever "nothing to show", never "the stack is down".
 *
 * The detail round-trip is not avoidable: `appType` and `serverId` are both on the compose row and
 * neither survives into the project tree.
 */
export async function listComposeContainers(client: DokployClient, service: ServiceRef): Promise<ContainerInfo[]> {
  if (service.kind !== "compose") return [];

  const compose = (await getService(client, "compose", service.id)) as Compose;
  if (!compose.appName) return [];

  const containers = await client.get<ContainerInfo[]>("docker.getContainersByAppNameMatch", {
    appName: compose.appName,
    appType: compose.composeType ?? "docker-compose",
    serverId: compose.serverId ?? undefined,
  });

  return (containers ?? []).filter(isUsableContainer);
}

/** A container's state, for display - Docker's own string, tidied only when it's a parse failure. */
export function containerStateLabel(container: ContainerInfo): string {
  return container.state === CONTAINER_STATE_UNKNOWN ? "unknown" : container.state;
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

/* ------------------------------------------------------------------ backups & schedules */

export function supportsBackups(kind: ServiceKind): boolean {
  return serviceKindConfig(kind).manualBackupRoute !== undefined;
}

export function supportsSchedules(kind: ServiceKind): boolean {
  return serviceKindConfig(kind).scheduleType !== undefined;
}

/**
 * The backups configured for a service.
 *
 * Read off the service's own detail route, because there is no route that lists them: Dokploy has
 * a `findBackupsByDbId` internally but never exposes it, and `<kind>.one` hydrates `backups` with
 * their destinations and run history anyway. One request, everything needed.
 *
 * The detail row carries the database's password, so this must not be called from a cached hook -
 * only the backups are returned, but the response it is read out of is a secret.
 */
export async function listServiceBackups(client: DokployClient, service: ServiceRef): Promise<Backup[]> {
  const config = serviceKindConfig(service.kind);
  if (!config.manualBackupRoute) return [];

  const detail = await client.get<{ backups?: Backup[] }>(`${config.namespace}.one`, {
    [config.idField]: service.id,
  });

  return detail.backups ?? [];
}

/**
 * Runs a configured backup now, rather than when its cron next fires.
 *
 * Takes the backup and not the service: Dokploy has no ad-hoc backup route, so there is nothing to
 * run until one has been configured with a destination to write to.
 */
export async function runManualBackup(client: DokployClient, service: ServiceRef, backupId: string): Promise<void> {
  const config = serviceKindConfig(service.kind);
  if (!config.manualBackupRoute) {
    throw new Error(`${config.label} services cannot be backed up this way.`);
  }
  await client.post(`backup.${config.manualBackupRoute}`, { backupId });
}

/** The schedules attached to one application or compose stack. */
export async function listSchedules(client: DokployClient, service: ServiceRef): Promise<Schedule[]> {
  const config = serviceKindConfig(service.kind);
  if (!config.scheduleType) return [];

  const schedules = await client.get<Schedule[]>("schedule.list", {
    id: service.id,
    scheduleType: config.scheduleType,
  });

  return Array.isArray(schedules) ? schedules : [];
}

/**
 * Runs a schedule's command now.
 *
 * Dokploy records the run as a deployment and streams the command's output into its log, which is
 * why the result is not here: this returns as soon as the run is started, and what it printed is
 * read back from the run history.
 */
export async function runSchedule(client: DokployClient, scheduleId: string): Promise<void> {
  await client.post("schedule.runManually", { scheduleId });
}

/* ------------------------------------------------------------------ disk & metrics */

/**
 * What Docker is using on the Dokploy host, one row per `docker system df` type.
 *
 * Host only - the route takes no `serverId`, so a remote server's disk is out of reach. It is also
 * admin-only, and answers `[]` on Dokploy Cloud. Callers treat a failure as "no disk information"
 * rather than an error worth showing, because a scoped user isn't doing anything wrong.
 */
export async function getDockerDiskUsage(client: DokployClient): Promise<DockerDiskUsageRow[]> {
  const rows = await client.get<DockerDiskUsageRow[]>("settings.getDockerDiskUsage");
  return Array.isArray(rows) ? rows : [];
}

/**
 * Runs one of Docker's prune commands.
 *
 * `serverId` is optional and means the Dokploy host when omitted - unlike `getDockerDiskUsage`,
 * these routes *can* reach a remote server.
 */
export async function runCleanupTask(client: DokployClient, task: CleanupTask, serverId?: string): Promise<void> {
  await client.post(cleanupTaskConfig(task).route, serverId ? { serverId } : {});
}

/**
 * The most recent sample from the monitoring container, or undefined when there isn't one.
 *
 * Two calls, because `server.getServerMetrics` is a *proxy*, not a data source: it forwards to a
 * metrics container that Dokploy does not itself host, so the caller has to supply that
 * container's URL and bearer token. `user.getMetricsToken` is where both come from.
 *
 * Monitoring is an opt-in feature and most instances don't run it, so "no metrics" is an ordinary
 * outcome and not an error: this returns undefined when the route throws - which it does for a
 * container that isn't running, a user without `monitoring:read`, or an empty series - rather than
 * making every caller wrap it. The precheck below only saves an obviously doomed request; nothing
 * in `getMetricsToken` proves the container is up, so the catch is what actually does the work.
 *
 * `dataPoints: "1"` is the newest sample, not the oldest: the series is cut newest-first and then
 * re-sorted oldest-to-newest, so the freshest point is always the last element.
 */
export interface ServerMetricsResult {
  metrics: ServerMetricsPoint;
  /**
   * The CPU and memory limits configured in Dokploy's own monitoring settings, in percent.
   * Reused rather than re-asked for, so the menu bar alerts on the same numbers the dashboard does.
   */
  thresholds?: { cpu: number; memory: number };
}

export async function readServerMetrics(client: DokployClient): Promise<ServerMetricsResult | undefined> {
  try {
    const config = await client.get<MetricsToken>("user.getMetricsToken");

    const server = config.metricsConfig?.server;
    if (!config.serverIp || !server?.token) return undefined;

    const metrics = await client.get<ServerMetricsPoint[]>("server.getServerMetrics", {
      url: `http://${config.serverIp}:${server.port ?? DEFAULT_METRICS_PORT}/metrics`,
      token: server.token,
      dataPoints: "1",
    });

    const latest = Array.isArray(metrics) ? metrics.at(-1) : undefined;
    // The token dies with this scope. Only the sample and the thresholds go back to the caller,
    // which is what lets the result be cached at all.
    return latest ? { metrics: latest, thresholds: server.thresholds } : undefined;
  } catch {
    return undefined;
  }
}

/** Dokploy's default port for the monitoring container. */
const DEFAULT_METRICS_PORT = 4500;

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

/** Only applications and compose stacks can have a domain; the six database kinds cannot. */
export function supportsDomains(kind: ServiceKind): boolean {
  return kind === "application" || kind === "compose";
}

export interface NewDomain {
  host: string;
  path?: string;
  port?: number;
  https: boolean;
  certificateType: CertificateType;
  /** Which container of a compose stack traffic goes to. Meaningless for an application. */
  serviceName?: string;
}

/**
 * Points a domain at a service.
 *
 * Dokploy's own validation is thinner than it looks - `host` is the only field its schema insists
 * on, and the cross-field rules its dashboard applies (https needs a certificate type, and so on)
 * live in the browser and never run for an API call. So the form is where those rules have to be
 * kept, and this sends a complete, coherent row rather than the minimum that would be accepted.
 *
 * `domainType` is derived from the service and always sent - see `DomainType` for why that is not
 * merely tidy.
 */
export async function createDomain(client: DokployClient, service: ServiceRef, domain: NewDomain): Promise<Domain> {
  const isCompose = service.kind === "compose";

  return client.post<Domain>("domain.create", {
    ...domain,
    domainType: isCompose ? "compose" : "application",
    ...(isCompose ? { composeId: service.id, serviceName: domain.serviceName } : { applicationId: service.id }),
  });
}

export function deleteDomain(client: DokployClient, domainId: string): Promise<Domain> {
  return client.post<Domain>("domain.delete", { domainId });
}

/**
 * Asks Dokploy for a working hostname, so the user doesn't need one of their own to get started.
 *
 * Two things the name doesn't tell you: it answers with a bare JSON string rather than an object,
 * and despite being called `generateTraefikMeDomain` internally it produces an **sslip.io** host -
 * `<app>-<hash>-<server-ip>.sslip.io`, which resolves to the server without any DNS being set up.
 */
export function generateDomain(client: DokployClient, appName: string, serverId?: string | null): Promise<string> {
  return client.post<string>("domain.generateDomain", { appName, ...(serverId ? { serverId } : {}) });
}

/**
 * Checks that a domain's DNS actually points here.
 *
 * DNS only: it does not know whether the host is already used by another service, so a "valid"
 * answer is not a promise that the create will succeed. Without `serverIp` it resolves the name
 * and calls anything that resolves valid, so passing the server's address is what makes it a real
 * check rather than a spell-check.
 */
export function validateDomain(client: DokployClient, domain: string, serverIp?: string): Promise<DomainValidation> {
  return client.post<DomainValidation>("domain.validateDomain", { domain, ...(serverIp ? { serverIp } : {}) });
}
