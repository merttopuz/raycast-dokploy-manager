import { isContainerRunning, listComposeContainers, readServiceLogs } from "../api/dokploy-api";
import { requireClient, resolveService } from "../lib/ai";
import { ContainerInfo, ServiceKind } from "../types/dokploy";

/** Logs can be long; keep what goes to the model bounded. */
const MAX_LINES = 500;
const DEFAULT_LINES = 100;

type Input = {
  /** Name or id of the service. */
  service: string;
  /** How many lines from the end of the log to read. Defaults to 100, capped at 500. */
  lines?: number;
  /** Only return lines containing this text. */
  search?: string;
  /** Narrows the lookup when several projects have a service with the same name. */
  project?: string;
  /** Narrows the lookup to one type of service. */
  kind?: ServiceKind;
  /**
   * Which container of a compose stack to read. Only meaningful for compose services, which run
   * several; defaults to the first running one. Ignored by every other kind.
   */
  container?: string;
  /** Name of the Dokploy account. Defaults to the active one. */
  account?: string;
};

/** Matched by name so the model can pass what a previous call showed it, not an opaque id. */
function findContainer(containers: ContainerInfo[], requested: string): ContainerInfo | undefined {
  return containers.find((container) => container.name === requested || container.containerId === requested);
}

/** A stopped container's last lines are usually the answer, but a running one is the default. */
function defaultContainer(containers: ContainerInfo[]): ContainerInfo | undefined {
  return containers.find(isContainerRunning) ?? containers[0];
}

/**
 * The runtime log of a service - what the container is printing right now.
 * For why a *build* failed, use the deployment build log instead.
 */
export default async function tool(input: Input) {
  const client = await requireClient(input.account);
  const service = await resolveService(client, input.service, { kind: input.kind, project: input.project });

  // Compose is the one kind whose log route demands a container id: a stack runs several and
  // Dokploy neither picks one nor merges them, so the choice has to be made here.
  const containers = service.kind === "compose" ? await listComposeContainers(client, service) : [];
  const isCompose = service.kind === "compose";

  const identity = { service: service.name, project: service.projectName, status: service.status ?? "unknown" };

  if (isCompose && containers.length === 0) {
    return { ...identity, logs: "(no containers found - the stack may be stopped, or its server unreachable)" };
  }

  // A container that was asked for by name and doesn't exist is answered with a list, never with a
  // different container's logs: silently substituting one gives the model a confident answer to a
  // question nobody asked, and it has no way to tell.
  if (isCompose && input.container && !findContainer(containers, input.container)) {
    return {
      ...identity,
      error: `This stack has no container named "${input.container}".`,
      availableContainers: containers.map((item) => ({ name: item.name, state: item.state })),
    };
  }

  const container = isCompose
    ? input.container
      ? findContainer(containers, input.container)
      : defaultContainer(containers)
    : undefined;

  // Rounded, floored and capped. Dokploy wants an integer of at least 1, and none of that is the
  // model's job to know: `lines: 0` and `lines: 2.5` are both expressible and both would 400.
  const tail = Math.min(Math.max(Math.round(input.lines ?? DEFAULT_LINES), 1), MAX_LINES);
  const logs = await readServiceLogs(client, service, {
    tail,
    search: input.search,
    containerId: container?.containerId,
  });

  return {
    ...identity,
    lines: tail,
    ...(container && {
      container: container.name,
      containerState: container.state,
      // So the model can offer the others rather than assume it read the whole stack.
      otherContainers: containers.filter((item) => item.containerId !== container.containerId).map((item) => item.name),
    }),
    logs: logs.trim() || "(no log output)",
  };
}
