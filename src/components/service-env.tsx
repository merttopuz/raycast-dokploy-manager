import { Action, ActionPanel, Detail, Form, Icon, Keyboard, showToast, Toast, useNavigation } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { DokployClient } from "../api/client";
import { readServiceEnv, saveServiceEnv } from "../api/dokploy-api";
import { toErrorMessage } from "../api/errors";
import { countVariables, maskValues, parseEnv } from "../lib/env";
import { ServiceRef } from "../types/dokploy";

interface ServiceEnvProps {
  client: DokployClient;
  service: ServiceRef;
}

/**
 * A service's environment variables.
 *
 * `usePromise`, deliberately, and never `useCachedPromise`: this is the most sensitive thing the
 * extension reads, and Raycast's on-disk cache is not encrypted. The same rule keeps `env` out of
 * the project tree in `use-projects.ts`.
 *
 * Values are masked until asked for. Reading your own env on your own machine is not the risk -
 * doing it while screen-sharing is, and that is exactly when you reach for Raycast.
 */
export function ServiceEnv({ client, service }: ServiceEnvProps) {
  const [revealed, setRevealed] = useState(false);

  const { data, isLoading, revalidate, error } = usePromise(
    async (ref: ServiceRef) => readServiceEnv(client, ref),
    [service],
  );

  const lines = data ? parseEnv(data) : [];
  const count = countVariables(lines);
  const isEmpty = !data || data.trim() === "";

  const body = error
    ? `> Could not load environment variables: ${toErrorMessage(error)}`
    : isEmpty
      ? isLoading
        ? ""
        : "_No environment variables set._"
      : `\`\`\`\n${revealed ? data.trimEnd() : maskValues(lines)}\n\`\`\``;

  const heading = count > 0 ? `## ${service.name} - Environment (${count})` : `## ${service.name} - Environment`;

  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={`${service.name} - Environment`}
      markdown={`${heading}\n\n${body}`}
      actions={
        <ActionPanel>
          {/* Only once the current value is actually in hand. `Action.Push` builds its target as it
              renders, so an Edit offered mid-fetch would seed the form with an empty string and the
              next Save would wipe every variable the service has. Same for a fetch that failed. */}
          {data !== undefined && (
            <Action.Push
              title="Edit Variables"
              icon={Icon.Pencil}
              shortcut={Keyboard.Shortcut.Common.Edit}
              target={<ServiceEnvForm client={client} service={service} initialEnv={data ?? ""} onSaved={revalidate} />}
            />
          )}
          {!isEmpty && (
            <Action
              title={revealed ? "Hide Values" : "Reveal Values"}
              icon={revealed ? Icon.EyeDisabled : Icon.Eye}
              shortcut={{ modifiers: ["cmd", "shift"], key: "v" }}
              onAction={() => setRevealed((current) => !current)}
            />
          )}
          {!isEmpty && (
            <Action.CopyToClipboard
              title="Copy Environment File"
              content={data}
              // Concealed: this is a file full of secrets, and it should not outlive the paste in
              // Raycast's clipboard history.
              concealed
              shortcut={Keyboard.Shortcut.Common.Copy}
            />
          )}
          <Action
            title="Refresh"
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={revalidate}
          />
        </ActionPanel>
      }
    />
  );
}

interface ServiceEnvFormProps {
  client: DokployClient;
  service: ServiceRef;
  initialEnv: string;
  onSaved: () => void;
}

function ServiceEnvForm({ client, service, initialEnv, onSaved }: ServiceEnvFormProps) {
  const [env, setEnv] = useState(initialEnv);
  const [isSaving, setIsSaving] = useState(false);
  const { pop } = useNavigation();

  async function submit() {
    setIsSaving(true);
    const toast = await showToast({ style: Toast.Style.Animated, title: `Saving ${service.name}…` });

    try {
      await saveServiceEnv(client, service, env);
      toast.style = Toast.Style.Success;
      toast.title = "Saved Environment";
      // Dokploy writes the variables now but the container keeps the ones it started with, so
      // saying "saved" without this reads as "applied" and it isn't.
      toast.message = "Redeploy the service to apply them.";
      onSaved();
      pop();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Could Not Save Environment";
      toast.message = toErrorMessage(error);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Form
      isLoading={isSaving}
      navigationTitle={`${service.name} - Edit Environment`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save" icon={Icon.Check} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="env"
        title="Environment"
        placeholder={"DATABASE_URL=postgresql://…\nPORT=3000"}
        value={env}
        onChange={setEnv}
        info="One KEY=value per line. Comments starting with # are kept. Saving does not restart the service."
      />
    </Form>
  );
}
