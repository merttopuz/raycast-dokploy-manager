/** Status shared by applications and all six database kinds (`applicationStatus` column). */
export type ServiceStatus = "idle" | "running" | "done" | "error";

export type BuildType = "dockerfile" | "heroku_buildpacks" | "paketo_buildpacks" | "nixpacks" | "static" | "railpack";

export type SourceType = "docker" | "git" | "github" | "gitlab" | "bitbucket" | "gitea" | "drop";

/**
 * The eight deployable things Dokploy manages. They share a lifecycle (deploy/start/stop/logs…)
 * but each one has its own id field and route namespace - see `lib/service-kinds.ts`.
 */
export type ServiceKind = "application" | "compose" | "postgres" | "mysql" | "mariadb" | "mongo" | "redis" | "libsql";

/** The six kinds that are a database, i.e. the ones a connection URI can be built for. */
export type DatabaseKind = Exclude<ServiceKind, "application" | "compose">;

/**
 * `project.all` returns *different shapes depending on the caller's role*: owners and admins get
 * full rows, while a scoped user only gets `{ id, name, status }` per service. Everything past the
 * id is therefore optional, and detail views re-fetch through `<kind>.one`.
 */
export interface NestedService {
  name?: string;
  appName?: string;
  applicationStatus?: ServiceStatus;
  composeStatus?: ServiceStatus;
  description?: string | null;
  [key: string]: unknown;
}

/**
 * The keys services live under inside an environment.
 *
 * Note `applications` - it is the only plural one. The other seven match their route namespace
 * exactly, which makes it very easy to assume all eight do. They don't.
 */
export type EnvironmentServiceKey =
  "applications" | "compose" | "postgres" | "mysql" | "mariadb" | "mongo" | "redis" | "libsql";

export type Environment = {
  environmentId: string;
  name: string;
  isDefault?: boolean;
  description?: string | null;
  projectId?: string;
} & Partial<Record<EnvironmentServiceKey, NestedService[]>>;

export interface Project {
  projectId: string;
  name: string;
  description?: string | null;
  createdAt?: string;
  organizationId?: string;
  env?: string;
  environments?: Environment[];
  projectTags?: { tagId?: string; name?: string }[];
}

/** A service flattened out of the project tree, carrying enough context to act on it. */
export interface ServiceRef {
  kind: ServiceKind;
  id: string;
  name: string;
  status?: ServiceStatus;
  /** Docker/Swarm name. Required by the `reload` routes, so detail views fetch it when missing. */
  appName?: string;
  description?: string | null;
  projectId: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
}

export interface Application extends NestedService {
  applicationId: string;
  name: string;
  appName: string;
  applicationStatus: ServiceStatus;
  buildType?: BuildType;
  sourceType?: SourceType;
  repository?: string | null;
  owner?: string | null;
  branch?: string | null;
  dockerImage?: string | null;
  env?: string | null;
  /**
   * Build-time values, stored in the same `KEY=value` format as `env` but kept separate from it.
   * They matter here only because `application.saveEnvironment` demands them back on every write -
   * see `saveServiceEnv`.
   */
  buildArgs?: string | null;
  buildSecrets?: string | null;
  /** Whether Dokploy materialises `env` into a `.env` file. Also required on every env write. */
  createEnvFile?: boolean;
  replicas?: number;
  autoDeploy?: boolean | null;
  environmentId?: string;
  serverId?: string | null;
  createdAt?: string;
}

/**
 * The connection-relevant half of a database service.
 *
 * The six kinds are close but not identical, and the differences are exactly the ones a connection
 * URI cares about, so every field past the first three is optional:
 *
 * - `databaseName` - postgres, mysql and mariadb only. Mongo, Redis and LibSQL have no such column.
 * - `databaseUser` - absent on Redis, which authenticates with a password alone.
 * - `databaseRootPassword` - mysql and mariadb only. Postgres has no root password.
 * - `externalPort` - null when the database isn't published outside the Docker network.
 */
export interface Database extends NestedService {
  name: string;
  appName: string;
  applicationStatus: ServiceStatus;
  dockerImage?: string | null;
  databaseUser?: string | null;
  databasePassword?: string | null;
  databaseRootPassword?: string | null;
  databaseName?: string | null;
  externalPort?: number | null;
  env?: string | null;
  environmentId?: string;
  /** Null for services on the Dokploy host itself; set for a remote server. */
  serverId?: string | null;
  /** Mongo only - changes the URI. */
  replicaSets?: boolean | null;
  createdAt?: string;
}

/**
 * How a compose stack is run, and - because the two are the same enum - the `appType` its
 * containers are looked up with. Dokploy defaults it to `docker-compose`; `stack` is Swarm.
 */
export type ComposeType = "docker-compose" | "stack";

export interface Compose extends NestedService {
  composeId: string;
  name: string;
  appName: string;
  composeStatus: ServiceStatus;
  composeType?: ComposeType;
  sourceType?: string;
  repository?: string | null;
  branch?: string | null;
  composePath?: string;
  env?: string | null;
  environmentId?: string;
  serverId?: string | null;
  createdAt?: string;
}

/**
 * Which kind of service a domain is attached to.
 *
 * Always send this explicitly on create. Dokploy only defaults it at the *database* level, and its
 * authorization is written as `if (domainType === "compose" && composeId) … else if (domainType ===
 * "application" && applicationId) …` - so a create that omits it matches neither branch and skips
 * the access check entirely. Sending it is what makes the request take a checked path.
 */
export type DomainType = "application" | "compose" | "preview";

/** How the certificate is issued. `none` means plain HTTP with no certificate at all. */
export type CertificateType = "letsencrypt" | "none" | "custom";

export interface Domain {
  domainId: string;
  host: string;
  path?: string | null;
  port?: number | null;
  https?: boolean;
  domainType?: DomainType | null;
  serviceName?: string | null;
  certificateType?: CertificateType;
  applicationId?: string | null;
  composeId?: string | null;
  createdAt?: string;
}

/**
 * The verdict on whether a domain points at this server.
 *
 * Two traps. It checks **DNS only** - it says nothing about whether the host is already taken by
 * another service. And `error` is set even on success when the domain resolves to a CDN, where it
 * carries a warning rather than a failure, so the only field that decides the outcome is `isValid`.
 *
 * `isCloudflare` is in Dokploy's own return type but never assigned by its implementation, so it
 * is deliberately absent here: `cdnProvider` is the one that arrives.
 */
export interface DomainValidation {
  isValid: boolean;
  resolvedIp?: string;
  /** A reason when invalid, and a CDN warning when valid. Never the thing to branch on. */
  error?: string;
  cdnProvider?: string;
}

/** Deployments have their own status enum - note `cancelled`, which services never have. */
export type DeploymentStatus = "running" | "done" | "error" | "cancelled";

export interface Deployment {
  deploymentId: string;
  title?: string;
  description?: string | null;
  status?: DeploymentStatus;
  logPath?: string;
  /** Set while a build is running; this is the process the kill route targets. */
  pid?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt?: string;
  errorMessage?: string | null;
  /** Present when this deployment produced a rollback point that can be restored. */
  rollbackId?: string | null;
  isPreviewDeployment?: boolean | null;
}

/** The project/environment a service belongs to, as `deployment.allCentralized` nests it. */
interface DeploymentServiceOwner {
  name?: string;
  appName?: string;
  environment?: {
    environmentId?: string;
    name?: string;
    project?: { projectId?: string; name?: string };
  } | null;
}

/**
 * `deployment.allCentralized` returns every deployment on the instance in a single call, each with
 * its owning application or compose stack - and through that its environment and project - nested
 * inside. That is what makes a menu-bar deployments feed affordable: one request, not one per
 * service.
 */
export interface CentralizedDeployment extends Deployment {
  applicationId?: string | null;
  composeId?: string | null;
  application?: (DeploymentServiceOwner & { applicationId?: string }) | null;
  compose?: (DeploymentServiceOwner & { composeId?: string }) | null;
}

export interface Server {
  serverId: string;
  name: string;
  description?: string | null;
  ipAddress?: string;
  port?: number;
  username?: string;
  serverStatus?: string;
  createdAt?: string;
}

/* ------------------------------------------------------------------ containers */

/**
 * One running container, as `docker ps` describes it.
 *
 * Every field is passed through from Docker's own `{{.State}}`/`{{.Status}}` formatting rather
 * than being an enum Dokploy defines, so `state` is a free-form string ("running", "exited",
 * "created", "paused", "restarting", "dead"). Dokploy substitutes the literals below when it
 * cannot parse a line, which is why they are worth knowing about rather than rendering raw.
 */
export interface ContainerInfo {
  containerId: string;
  name: string;
  /** Docker's container state. Compared against `CONTAINER_STATE_UNKNOWN` before being trusted. */
  state: string;
  /** Human text, e.g. "Up 2 hours". */
  status: string;
}

/* ------------------------------------------------------------------ disk & metrics */

/**
 * One row of `docker system df`, which is what `settings.getDockerDiskUsage` answers with -
 * a flat array, one entry per type, and nothing else.
 *
 * Two things to know. `type` is Docker's own label ("Images", "Containers", "Local Volumes",
 * "Build Cache"), not a Dokploy enum. And of the three size fields only `sizeBytes` is a number:
 * `size` and `reclaimable` are human strings straight from Docker ("1.2GB", "1.2GB (50%)"), and
 * Dokploy never parses `reclaimable` into bytes - so anything numeric about reclaimable space has
 * to come out of that string.
 *
 * Note this describes **Docker's** consumption only. It carries no filesystem total and therefore
 * no "disk is N% full" - that lives in `ServerMetricsPoint.diskUsed`.
 */
export interface DockerDiskUsageRow {
  type: string;
  totalCount: number;
  active: number;
  /** Human string, e.g. "1.2GB". */
  size: string;
  /** Human string, and sometimes suffixed with a percentage: "1.2GB (50%)". */
  reclaimable: string;
  sizeBytes: number;
}

/**
 * One sample from Dokploy's monitoring container.
 *
 * **The units are mixed and the names do not warn you**: `cpu`, `memUsed` and `diskUsed` are
 * percentages (0-100), while `memUsedGB`, `memTotal` and `totalDisk` are gigabytes. So
 * `diskUsed / totalDisk` is meaningless - `diskUsed` already *is* the percentage, and the used
 * gigabytes are `diskUsed / 100 * totalDisk`.
 *
 * Everything numeric arrives as a string: the producer formats them with `%.2f` before sending.
 * `diskUsed` covers the root filesystem alone, not every mount.
 */
export interface ServerMetricsPoint {
  /** Percent, 0-100. */
  cpu: string;
  cpuModel?: string;
  cpuCores?: number;
  cpuPhysicalCores?: number;
  cpuSpeed?: number;
  os?: string;
  distro?: string;
  kernel?: string;
  arch?: string;
  /** Percent, 0-100 - *not* an amount, despite the name. */
  memUsed: string;
  /** Gigabytes. */
  memUsedGB?: string;
  /** Gigabytes. */
  memTotal?: string;
  /** Seconds. */
  uptime?: number;
  /** Percent, 0-100, for `/` only. */
  diskUsed: string;
  /** Gigabytes. */
  totalDisk?: string;
  networkIn?: string;
  networkOut?: string;
  timestamp?: string;
}

/**
 * Where the monitoring container lives and the bearer token to talk to it.
 *
 * `metricsConfig.server.token` is a live credential, so this must never reach a cached hook -
 * see the same rule for API keys in `use-projects.ts`. Fetch it, use it, drop it.
 *
 * `enabledFeatures` is *not* a "monitoring is set up" flag - it is Dokploy's paid-features
 * boolean, and Dokploy's own dashboard doesn't use it as the gate either. Nothing in this
 * response proves the metrics container is actually running.
 */
export interface MetricsToken {
  serverIp: string | null;
  enabledFeatures: boolean;
  metricsConfig: {
    server: {
      type?: "Dokploy" | "Remote";
      port: number;
      token: string;
      refreshRate?: number;
      retentionDays?: number;
      /** The CPU and memory limits configured in Dokploy itself, in percent. */
      thresholds?: { cpu: number; memory: number };
    };
  };
}

/**
 * One of the ready-made compose stacks Dokploy can install (n8n, Plausible, Uptime Kuma…).
 *
 * These come from a registry rather than the instance's own database: `compose.templates` fetches
 * `<baseUrl>/meta.json`, defaulting to `https://templates.dokploy.com`. The seven fields below are
 * the whole contract - Dokploy's `fetchTemplatesList` ends in a `.map()` that projects exactly
 * these, so nothing else can appear no matter what the registry serves.
 */
export interface Template {
  /** The registry's directory slug, e.g. `uptime-kuma`. This is what `deployTemplate` takes. */
  id: string;
  name: string;
  description: string;
  /** Free-form display text, not semver: about half of them are literally "latest". */
  version: string;
  /** A bare filename, not a URL - see `templateLogoUrl`. */
  logo: string;
  links: {
    github?: string;
    website?: string;
    docs?: string;
    discord?: string;
    docker?: string;
    dockerhub?: string;
  };
  tags: string[];
}

/* ------------------------------------------------------------------ backups & schedules */

/** Where a backup is written. The S3 credentials are stripped before this reaches the API. */
export interface BackupDestination {
  destinationId: string;
  name?: string;
  bucket?: string;
  provider?: string | null;
}

/**
 * A configured backup - a cron schedule, a destination and what to dump.
 *
 * There is no route that creates one of these from the extension, and that is not an omission:
 * every backup points at an S3 destination, and the whole `destination.*` router is owner/admin
 * only. So a backup has to be set up in Dokploy first, and what can be done from here is run one
 * that already exists without waiting for its cron.
 */
export interface Backup {
  backupId: string;
  /** A cron expression. Dokploy does not validate it at the API boundary. */
  schedule: string;
  prefix: string;
  /** Null is possible and means the cron was never registered - it will never run on its own. */
  enabled?: boolean | null;
  database: string;
  databaseType?: string;
  keepLatestCount?: number | null;
  destinationId: string;
  destination?: BackupDestination;
  /** Past runs. Backups share the deployment table, and only the last few are kept. */
  deployments?: Deployment[];
}

export type ScheduleType = "application" | "compose" | "server" | "dokploy-server";

/** A command Dokploy runs against a service on a cron. */
export interface Schedule {
  scheduleId: string;
  name: string;
  description?: string | null;
  cronExpression: string;
  scheduleType: ScheduleType;
  shellType?: "bash" | "sh";
  command: string;
  /** Which container of a compose stack the command runs in. */
  serviceName?: string | null;
  enabled: boolean;
  timezone?: string | null;
  createdAt?: string;
  /** Past runs - a schedule run is recorded as a deployment. Only the last ten are kept. */
  deployments?: Deployment[];
}

export interface Organization {
  id: string;
  name: string;
  slug?: string | null;
  logo?: string | null;
  createdAt?: string;
}

export interface SessionUser {
  id?: string;
  name?: string | null;
  email?: string;
  role?: string;
  [key: string]: unknown;
}
