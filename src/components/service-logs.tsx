import { Action, ActionPanel, Color, Detail, getPreferenceValues, Icon, Keyboard } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";
import { DokployClient } from "../api/client";
import { containerStateLabel, isContainerRunning, listComposeContainers, readServiceLogs } from "../api/dokploy-api";
import { toErrorMessage } from "../api/errors";
import { serviceUrl } from "../lib/urls";
import { ContainerInfo, ServiceRef } from "../types/dokploy";

interface Preferences {
  logTail?: string;
}

const DEFAULT_TAIL = 200;

/** Dokploy rejects anything above this, so a bigger preference is a failed request, not more logs. */
const MAX_TAIL = 10_000;

/** Slow enough to stay out of the instance's way, quick enough to watch a deploy scroll past. */
const FOLLOW_INTERVAL_MS = 3_000;

function resolveTail(): number {
  const raw = getPreferenceValues<Preferences>().logTail;
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TAIL;
  return Math.min(parsed, MAX_TAIL);
}

/**
 * Which container a compose stack's logs open on.
 *
 * A stopped container is still worth showing - its last words are usually why it stopped - but a
 * running one is what you came for, so it wins when there is a choice.
 */
function defaultContainer(containers?: ContainerInfo[]): ContainerInfo | undefined {
  if (!containers?.length) return undefined;
  return containers.find(isContainerRunning) ?? containers[0];
}

function containerIcon(container: ContainerInfo, isSelected: boolean) {
  if (isSelected) return { source: Icon.Checkmark, tintColor: Color.Green };
  return {
    source: Icon.Circle,
    tintColor: isContainerRunning(container) ? Color.Green : Color.SecondaryText,
  };
}

interface ServiceLogsProps {
  client: DokployClient;
  service: ServiceRef;
}

/**
 * A service's runtime logs.
 *
 * Compose stacks are the awkward one. Every other kind takes its own id and nothing else, but
 * `compose.readLogs` **requires** a `containerId` - a stack has many containers and Dokploy will
 * not pick one for you, nor merge them. So a compose stack has to resolve its containers first and
 * ask for one of them by id; asking for the stack itself is a validation error, not a combined log.
 */
export function ServiceLogs({ client, service }: ServiceLogsProps) {
  const tail = resolveTail();
  const isCompose = service.kind === "compose";

  const [selectedName, setSelectedName] = useState<string>();
  const [isFollowing, setIsFollowing] = useState(false);

  const {
    data: containers,
    isLoading: containersLoading,
    error: containersError,
    revalidate: revalidateContainers,
  } = usePromise(async (ref: ServiceRef) => listComposeContainers(client, ref), [service], {
    execute: isCompose,
    // Swallowed deliberately, and the empty body is the whole point: the view renders this error
    // itself, and follow mode re-reads on a timer - so a server that stays unreachable would
    // otherwise raise the same toast every few seconds for as long as it stayed down.
    onError: () => {},
  });

  /**
   * The user's choice wins, but only once they have made one - otherwise the default, which cannot
   * be computed until the containers land.
   *
   * Remembered by *name* rather than by container id, and the difference shows up exactly when it
   * matters: a deploy replaces a container, so its id is gone, but Compose names it from the
   * service (`app-web-1`) and that survives. Holding the id would silently drop the user back to
   * whichever container happened to be first, mid-deploy, having explicitly chosen another.
   */
  const active = containers?.find((container) => container.name === selectedName) ?? defaultContainer(containers);
  const containerId = active?.containerId;

  // A compose stack with no container resolved has nothing to ask for, and asking anyway is a 400.
  const canReadLogs = !isCompose || containerId !== undefined;

  const { data, isLoading, revalidate, error } = usePromise(
    async (ref: ServiceRef, container?: string) => readServiceLogs(client, ref, { tail, containerId: container }),
    [service, containerId],
    {
      execute: canReadLogs,
      // Swallowed for the same reason as the container list above: the view renders the error, and
      // following would otherwise toast on every tick for as long as the failure lasted.
      onError: () => {},
    },
  );

  /**
   * What Refresh does: re-read the containers as well as the log.
   *
   * `revalidate` ignores `execute`, so calling it for a stack with no container resolved would
   * send `compose.readLogs` without the `containerId` it requires and take a 400 for it. Re-reading
   * the containers is also the only way out of that state - the stack may have started since.
   */
  function refresh() {
    if (isCompose) revalidateContainers();
    if (canReadLogs) revalidate();
  }

  /**
   * One tick of follow mode, and deliberately cheaper than a Refresh: while the log is readable it
   * asks for the log alone. Re-listing containers means a `docker ps` on the server - over SSH for
   * a remote one - and doing that every few seconds for the whole of a deploy is not worth it.
   *
   * It re-lists in the two cases where the log alone cannot make progress, both of which mean the
   * container we are pointed at is gone: nothing resolved yet, or the last read failed. A deploy
   * replaces a stack's containers outright, so the id dies with them - and that is exactly when
   * someone is watching. Reattaching costs one extra call on the tick that noticed, and recovers
   * on the next one.
   *
   * Doing this here rather than from the log request's own error handler is what bounds it: a
   * reattach finds a *new* id, which refetches, which can fail again - left to run at network
   * speed that is a request amplifier, and a crash-looping container is the likeliest reason to be
   * on this screen. On the tick, the interval is the ceiling.
   */
  function followTick() {
    // A read still in flight means the last tick hasn't landed yet, and starting another would
    // discard it - a server slower than the interval would then never apply a single result,
    // leaving stale logs under a spinner that never stops. Slow reads just follow more slowly.
    if (isLoading || containersLoading) return;

    if (!canReadLogs) {
      if (isCompose) revalidateContainers();
      return;
    }
    if (isCompose && error) revalidateContainers();
    revalidate();
  }

  // Through a ref, not the dependency list: this is a new function on every render, so depending
  // on it would clear and restart the interval before it ever got to fire.
  const tickRef = useRef(followTick);
  tickRef.current = followTick;

  useEffect(() => {
    if (!isFollowing) return;
    const timer = setInterval(() => tickRef.current(), FOLLOW_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isFollowing]);

  const noContainers = isCompose && !containersLoading && !containersError && (containers?.length ?? 0) === 0;

  const body = containersError
    ? `> Could not list the containers in this stack: ${toErrorMessage(containersError)}`
    : noContainers
      ? // Dokploy answers with an empty list for a stopped stack, an unreachable server and a name
        // it can't match alike, so this cannot claim the stack is down - only that there is nothing
        // to read.
        "_No containers to read. The stack may be stopped, or its server unreachable._"
      : error
        ? `> Could not load logs: ${toErrorMessage(error)}`
        : data?.trim()
          ? `\`\`\`\n${data.trimEnd()}\n\`\`\``
          : isLoading || containersLoading
            ? ""
            : "_No log output._";

  const heading = active ? `## ${service.name} - ${active.name}` : `## ${service.name} - Logs`;
  const followNote = isFollowing ? `\n\n_Following - refreshing every ${FOLLOW_INTERVAL_MS / 1000}s._` : "";

  return (
    <Detail
      isLoading={isLoading || containersLoading}
      navigationTitle={`${service.name} - Logs${isFollowing ? " (Following)" : ""}`}
      markdown={`${heading}${followNote}\n\n${body}`}
      actions={
        <ActionPanel>
          <Action
            title="Refresh"
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={refresh}
          />
          {/* Offered even with nothing to read: following a stack you are about to start is a
              reasonable thing to ask for, and the tick picks its containers up when they appear. */}
          <Action
            title={isFollowing ? "Stop Following" : "Follow Logs"}
            icon={isFollowing ? Icon.Pause : Icon.Play}
            shortcut={{ modifiers: ["cmd"], key: "f" }}
            onAction={() => setIsFollowing((following) => !following)}
          />
          {/* One container is no choice at all, so the submenu only earns its slot past that. */}
          {containers && containers.length > 1 && (
            <ActionPanel.Submenu title="Show Container" icon={Icon.Box} shortcut={{ modifiers: ["cmd"], key: "t" }}>
              {containers.map((container) => (
                <Action
                  key={container.containerId}
                  title={container.name}
                  // The state is the reason you would pick one: "web (exited)" is where the answer is.
                  icon={containerIcon(container, container.containerId === containerId)}
                  onAction={() => setSelectedName(container.name)}
                />
              ))}
            </ActionPanel.Submenu>
          )}
          <Action.CopyToClipboard title="Copy Logs" content={data ?? ""} />
          <Action.OpenInBrowser title="Open in Dokploy" url={serviceUrl(client.webUrl, service)} />
        </ActionPanel>
      }
      metadata={
        active ? (
          <Detail.Metadata>
            <Detail.Metadata.TagList title="Container">
              <Detail.Metadata.TagList.Item
                text={containerStateLabel(active)}
                color={isContainerRunning(active) ? Color.Green : Color.SecondaryText}
              />
            </Detail.Metadata.TagList>
            <Detail.Metadata.Label title="Name" text={active.name} />
            {active.status && <Detail.Metadata.Label title="Status" text={active.status} />}
            {containers && containers.length > 1 && (
              <Detail.Metadata.Label title="Containers" text={String(containers.length)} />
            )}
          </Detail.Metadata>
        ) : undefined
      }
    />
  );
}
