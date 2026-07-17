import { Action, ActionPanel, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { useState } from "react";
import { DokployClient } from "../api/client";
import { createProject } from "../api/dokploy-api";
import { toErrorMessage } from "../api/errors";

interface ProjectFormProps {
  client: DokployClient;
  onCreated: () => void;
}

export function ProjectForm({ client, onCreated }: ProjectFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const { pop } = useNavigation();

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("A project needs a name.");
      return;
    }

    setIsSaving(true);
    const toast = await showToast({ style: Toast.Style.Animated, title: `Creating ${trimmed}…` });

    try {
      const { project } = await createProject(client, {
        name: trimmed,
        description: description.trim() || undefined,
      });
      toast.style = Toast.Style.Success;
      toast.title = `Created ${project.name}`;
      // Dokploy makes the project and its default environment, and nothing else - the services
      // are still to come, and they are not added from here.
      toast.message = "Add services to it in Dokploy.";
      onCreated();
      pop();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Could Not Create Project";
      toast.message = toErrorMessage(error);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Form
      isLoading={isSaving}
      navigationTitle="New Project"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Project" icon={Icon.Plus} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="name"
        title="Name"
        placeholder="my-project"
        value={name}
        error={nameError}
        onChange={(value) => {
          setName(value);
          if (nameError) setNameError(undefined);
        }}
      />
      <Form.TextArea
        id="description"
        title="Description"
        placeholder="What lives in this project"
        value={description}
        onChange={setDescription}
      />
    </Form>
  );
}
