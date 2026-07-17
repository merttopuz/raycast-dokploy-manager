import { Action, ActionPanel, Color, Detail, Icon, Keyboard, List, showToast, Toast } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { DokployClient } from "../api/client";
import { listSchedules, readDeploymentLogs, runSchedule } from "../api/dokploy-api";
import { toErrorMessage } from "../api/errors";
import { relativeTime } from "../lib/format";
import { deploymentIcon, deploymentPresentation } from "../lib/status";
import { Deployment, Schedule, ServiceRef } from "../types/dokploy";

interface ServiceSchedulesProps {
  client: DokployClient;
  service: ServiceRef;
}

/**
 * The cron commands attached to a service, and a way to run one now.
 *
 * A schedule run is recorded as a deployment, which is what makes its output readable at all: the
 * command's stdout goes to that deployment's log. Dokploy keeps only the last ten runs.
 */
export function ServiceSchedules({ client, service }: ServiceSchedulesProps) {
  const {
    data: schedules,
    isLoading,
    revalidate,
  } = usePromise(async (ref: ServiceRef) => listSchedules(client, ref), [service], {
    failureToastOptions: { title: "Could Not Load Schedules" },
  });

  async function run(schedule: Schedule) {
    const toast = await showToast({ style: Toast.Style.Animated, title: `Running ${schedule.name}…` });
    try {
      await runSchedule(client, schedule.scheduleId);
      toast.style = Toast.Style.Success;
      toast.title = `Ran ${schedule.name}`;
      // The command runs in the container and its output lands in the run's log, so "ran" is only
      // "started" - whether it worked is in the log, not in this response.
      toast.message = "Open its last run to read the output.";
      revalidate();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Could Not Run the Schedule";
      toast.message = toErrorMessage(error);
    }
  }

  return (
    <List isLoading={isLoading} navigationTitle={`${service.name} - Schedules`}>
      <List.EmptyView
        icon={Icon.Clock}
        title="No Schedules"
        description={`${service.name} has no scheduled commands. Add one in Dokploy, then run it from here.`}
      />

      {(schedules ?? []).map((schedule) => {
        const last = schedule.deployments?.[0];
        return (
          <List.Item
            key={schedule.scheduleId}
            icon={{ source: Icon.Clock, tintColor: schedule.enabled ? Color.Green : Color.SecondaryText }}
            title={schedule.name}
            subtitle={schedule.cronExpression}
            accessories={[
              ...(schedule.serviceName ? [{ tag: schedule.serviceName, icon: Icon.Box }] : []),
              ...(last
                ? [
                    {
                      icon: deploymentIcon(last.status),
                      text: `${deploymentPresentation(last.status).label} ${relativeTime(last.createdAt)}`.trim(),
                    },
                  ]
                : [{ text: "never run" }]),
              ...(schedule.enabled ? [] : [{ tag: { value: "Paused", color: Color.Orange } }]),
            ]}
            actions={
              <ActionPanel>
                <Action title="Run Now" icon={Icon.Play} onAction={() => run(schedule)} />
                {last && (
                  <Action.Push
                    title="View Last Run"
                    icon={Icon.Terminal}
                    shortcut={{ modifiers: ["cmd"], key: "l" }}
                    target={<ScheduleRunLog client={client} schedule={schedule} run={last} />}
                  />
                )}
                <Action
                  title="Refresh"
                  icon={Icon.ArrowClockwise}
                  shortcut={Keyboard.Shortcut.Common.Refresh}
                  onAction={revalidate}
                />
                <Action.CopyToClipboard
                  title="Copy Command"
                  content={schedule.command}
                  shortcut={Keyboard.Shortcut.Common.Copy}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

interface ScheduleRunLogProps {
  client: DokployClient;
  schedule: Schedule;
  run: Deployment;
}

/** What the command printed. Same route as a build log - a schedule run is a deployment. */
function ScheduleRunLog({ client, schedule, run }: ScheduleRunLogProps) {
  const { data, isLoading, revalidate, error } = usePromise(
    async (deploymentId: string) => readDeploymentLogs(client, deploymentId),
    [run.deploymentId],
  );

  const status = deploymentPresentation(run.status);

  const body = error
    ? `> Could not load the run log: ${toErrorMessage(error)}`
    : data?.trim()
      ? `\`\`\`\n${data.trimEnd()}\n\`\`\``
      : isLoading
        ? ""
        : "_This run produced no output._";

  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={`${schedule.name} - Last Run`}
      markdown={`## ${schedule.name}\n\n\`${schedule.command}\`\n\n${body}`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.TagList title="Result">
            <Detail.Metadata.TagList.Item text={status.label} color={status.color} />
          </Detail.Metadata.TagList>
          <Detail.Metadata.Label title="Schedule" text={schedule.cronExpression} />
          {schedule.shellType && <Detail.Metadata.Label title="Shell" text={schedule.shellType} />}
          {run.createdAt && <Detail.Metadata.Label title="Ran" text={new Date(run.createdAt).toLocaleString()} />}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action
            title="Refresh"
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={revalidate}
          />
          <Action.CopyToClipboard title="Copy Output" content={data ?? ""} />
        </ActionPanel>
      }
    />
  );
}
