import {
  Action,
  ActionPanel,
  Alert,
  Color,
  confirmAlert,
  Form,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { DokployClient } from "../api/client";
import {
  createDomain,
  deleteDomain,
  generateDomain,
  getService,
  listComposeContainers,
  listDomains,
  resolveExternalHost,
  validateDomain,
} from "../api/dokploy-api";
import { toErrorMessage } from "../api/errors";
import { CertificateType, Compose, Domain, ServiceRef } from "../types/dokploy";

interface ServiceDomainsProps {
  client: DokployClient;
  service: ServiceRef;
}

export function domainUrl(domain: Domain): string {
  const path = domain.path && domain.path !== "/" ? domain.path : "";
  return `${domain.https ? "https" : "http"}://${domain.host}${path}`;
}

/** The domains pointing at one service. */
export function ServiceDomains({ client, service }: ServiceDomainsProps) {
  const {
    data: domains,
    isLoading,
    revalidate,
  } = usePromise(async (ref: ServiceRef) => listDomains(client, ref), [service], {
    failureToastOptions: { title: "Could Not Load Domains" },
  });

  async function confirmDelete(domain: Domain) {
    const confirmed = await confirmAlert({
      title: `Delete ${domain.host}?`,
      message: "The service stops answering on this domain. Nothing else about it changes.",
      icon: Icon.Trash,
      primaryAction: { title: "Delete Domain", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;

    const toast = await showToast({ style: Toast.Style.Animated, title: `Deleting ${domain.host}…` });
    try {
      await deleteDomain(client, domain.domainId);
      toast.style = Toast.Style.Success;
      toast.title = `Deleted ${domain.host}`;
      revalidate();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Could Not Delete Domain";
      toast.message = toErrorMessage(error);
    }
  }

  const addAction = (
    <Action.Push
      title="Add Domain"
      icon={Icon.Plus}
      shortcut={Keyboard.Shortcut.Common.New}
      target={<DomainForm client={client} service={service} onSaved={revalidate} />}
    />
  );

  return (
    <List isLoading={isLoading} navigationTitle={`${service.name} - Domains`}>
      <List.EmptyView
        icon={Icon.Globe}
        title="No Domains"
        description={`${service.name} is not reachable on any domain yet.`}
        actions={<ActionPanel>{addAction}</ActionPanel>}
      />

      {(domains ?? []).map((domain) => (
        <List.Item
          key={domain.domainId}
          icon={{ source: Icon.Globe, tintColor: domain.https ? Color.Green : Color.SecondaryText }}
          title={domain.host}
          subtitle={domain.path && domain.path !== "/" ? domain.path : undefined}
          accessories={[
            // The container the domain resolves to is the thing worth checking on a compose stack,
            // where getting it wrong is what makes a domain quietly serve nothing.
            ...(domain.serviceName ? [{ tag: domain.serviceName, icon: Icon.Box }] : []),
            ...(domain.port ? [{ text: String(domain.port) }] : []),
            { tag: domain.https ? { value: "HTTPS", color: Color.Green } : { value: "HTTP", color: Color.Orange } },
          ]}
          actions={
            <ActionPanel>
              <Action.OpenInBrowser title="Open Domain" url={domainUrl(domain)} />
              {addAction}
              <Action.CopyToClipboard
                title="Copy URL"
                content={domainUrl(domain)}
                shortcut={Keyboard.Shortcut.Common.Copy}
              />
              <Action
                title="Refresh"
                icon={Icon.ArrowClockwise}
                shortcut={Keyboard.Shortcut.Common.Refresh}
                onAction={revalidate}
              />
              <Action
                title="Delete Domain"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                shortcut={Keyboard.Shortcut.Common.Remove}
                onAction={() => confirmDelete(domain)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

interface DomainFormProps {
  client: DokployClient;
  service: ServiceRef;
  onSaved: () => void;
}

const CERTIFICATE_LABELS: Record<CertificateType, string> = {
  none: "None",
  letsencrypt: "Let's Encrypt",
  custom: "Custom resolver",
};

/**
 * Adds a domain.
 *
 * Dokploy's API accepts far less than this form asks for - `host` alone would be taken - but the
 * rules that make a domain actually *work* are enforced only in its dashboard and never run for an
 * API call. So they are enforced here instead: HTTPS with no certificate type issues no
 * certificate, and a compose domain with no service name points traefik at nothing. Both would be
 * accepted and both are broken.
 */
function DomainForm({ client, service, onSaved }: DomainFormProps) {
  const isCompose = service.kind === "compose";
  const { pop } = useNavigation();

  const [host, setHost] = useState("");
  const [path, setPath] = useState("/");
  const [port, setPort] = useState("3000");
  const [https, setHttps] = useState(true);
  const [certificateType, setCertificateType] = useState<CertificateType>("letsencrypt");
  const [serviceName, setServiceName] = useState("");
  const [hostError, setHostError] = useState<string>();
  const [serviceNameError, setServiceNameError] = useState<string>();
  const [portError, setPortError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);

  // Both are only needed to help fill the form in, and both are optional extras rather than
  // requirements: a failure here costs a convenience, not the ability to add a domain.
  const { data: detail } = usePromise(async () => {
    try {
      return (await getService(client, service.kind, service.id)) as Compose;
    } catch {
      return undefined;
    }
  }, []);

  const { data: containers } = usePromise(
    async () => {
      if (!isCompose) return [];
      try {
        return await listComposeContainers(client, service);
      } catch {
        return [];
      }
    },
    [],
    { execute: isCompose },
  );

  async function generate() {
    const appName = detail?.appName ?? service.appName;
    if (!appName) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could Not Generate a Domain",
        message: "No container name.",
      });
      return;
    }

    const toast = await showToast({ style: Toast.Style.Animated, title: "Generating a domain…" });
    try {
      const generated = await generateDomain(client, appName, detail?.serverId);
      setHost(generated);
      setHostError(undefined);
      // sslip.io encodes the server's IP in the name, so it resolves with no DNS to set up - which
      // is the whole reason to offer this rather than make someone go and own a domain first.
      setCertificateType("none");
      setHttps(false);
      toast.style = Toast.Style.Success;
      toast.title = "Generated a Domain";
      toast.message = "It resolves to this server already. HTTPS is off - sslip.io has no certificate.";
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Could Not Generate a Domain";
      toast.message = toErrorMessage(error);
    }
  }

  async function validate() {
    const value = host.trim();
    if (!value) {
      setHostError("Enter a domain first.");
      return;
    }

    const toast = await showToast({ style: Toast.Style.Animated, title: `Checking ${value}…` });
    try {
      // Without the server's own address this only asks "does it resolve at all", which is not the
      // question. Passing it makes Dokploy compare the answer against this server.
      const serverIp = await resolveExternalHost(client, detail?.serverId).catch(() => undefined);
      const result = await validateDomain(client, value, serverIp);

      // `error` is populated on success too - it carries the CDN warning - so it is `isValid` that
      // decides, and the message is only ever a detail hung off that.
      toast.style = result.isValid ? Toast.Style.Success : Toast.Style.Failure;
      toast.title = result.isValid ? `${value} resolves here` : `${value} does not point at this server`;
      toast.message =
        result.error ??
        (result.resolvedIp ? `Resolves to ${result.resolvedIp}.` : undefined) ??
        (serverIp ? undefined : "No server IP configured, so DNS was only checked for an answer.");
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Could Not Check the Domain";
      toast.message = toErrorMessage(error);
    }
  }

  function validateForm(): boolean {
    let ok = true;

    if (!host.trim()) {
      setHostError("A domain is required.");
      ok = false;
    }

    const parsedPort = Number.parseInt(port, 10);
    if (port.trim() !== "" && (!Number.isFinite(parsedPort) || parsedPort < 1 || parsedPort > 65535)) {
      setPortError("Must be between 1 and 65535.");
      ok = false;
    }

    // The container dropdown starts on its empty prompt, so this is the default path and not an
    // edge case. Dokploy would accept the domain without it and then route it at nothing - the
    // domain would exist, resolve, and serve nothing, which is worse than being refused here.
    if (isCompose && !serviceName.trim()) {
      setServiceNameError("Choose which container serves this domain.");
      ok = false;
    }

    return ok;
  }

  async function submit() {
    if (!validateForm()) return;

    const parsedPort = Number.parseInt(port, 10);
    setIsSaving(true);
    const toast = await showToast({ style: Toast.Style.Animated, title: `Adding ${host.trim()}…` });

    try {
      await createDomain(client, service, {
        host: host.trim(),
        path: path.trim() || "/",
        port: Number.isFinite(parsedPort) ? parsedPort : undefined,
        https,
        // Dokploy would take `https` with no certificate type and then issue nothing, leaving a
        // domain that serves an HTTPS scheme it has no certificate for.
        certificateType: https ? certificateType : "none",
        serviceName: isCompose ? serviceName.trim() || undefined : undefined,
      });

      toast.style = Toast.Style.Success;
      toast.title = `Added ${host.trim()}`;
      toast.message = https ? "Redeploy the service to issue its certificate." : undefined;
      onSaved();
      pop();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Could Not Add the Domain";
      toast.message = toErrorMessage(error);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Form
      isLoading={isSaving}
      navigationTitle={`${service.name} - Add Domain`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Add Domain" icon={Icon.Plus} onSubmit={submit} />
          <Action
            title="Generate a Domain"
            icon={Icon.Wand}
            shortcut={{ modifiers: ["cmd"], key: "g" }}
            onAction={generate}
          />
          <Action title="Check DNS" icon={Icon.Check} shortcut={{ modifiers: ["cmd"], key: "t" }} onAction={validate} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="host"
        title="Domain"
        placeholder="app.example.com"
        value={host}
        error={hostError}
        onChange={(value) => {
          setHost(value);
          if (hostError) setHostError(undefined);
        }}
        info="Point your DNS at this server first, or press ⌘G to generate a domain that already resolves to it."
      />

      {isCompose &&
        (containers && containers.length > 0 ? (
          <Form.Dropdown
            id="serviceName"
            title="Container"
            value={serviceName}
            error={serviceNameError}
            onChange={(value) => {
              setServiceName(value);
              if (serviceNameError) setServiceNameError(undefined);
            }}
            info="Which container in the stack serves this domain."
          >
            <Form.Dropdown.Item value="" title="Choose a container…" />
            {containers.map((container) => (
              <Form.Dropdown.Item key={container.containerId} value={container.name} title={container.name} />
            ))}
          </Form.Dropdown>
        ) : (
          <Form.TextField
            id="serviceName"
            title="Container"
            placeholder="web"
            value={serviceName}
            error={serviceNameError}
            onChange={(value) => {
              setServiceName(value);
              if (serviceNameError) setServiceNameError(undefined);
            }}
            info="The compose service that serves this domain, as named in the compose file."
          />
        ))}

      <Form.TextField
        id="port"
        title="Port"
        placeholder="3000"
        value={port}
        error={portError}
        onChange={(value) => {
          setPort(value);
          if (portError) setPortError(undefined);
        }}
        info="The port the container listens on."
      />

      <Form.TextField id="path" title="Path" placeholder="/" value={path} onChange={setPath} />

      <Form.Checkbox id="https" label="Serve over HTTPS" value={https} onChange={setHttps} />

      {https && (
        <Form.Dropdown
          id="certificateType"
          title="Certificate"
          value={certificateType}
          onChange={(value) => setCertificateType(value as CertificateType)}
        >
          {(Object.keys(CERTIFICATE_LABELS) as CertificateType[])
            // Only meaningful with a resolver name, which this form has nowhere to ask for.
            .filter((type) => type !== "custom")
            .map((type) => (
              <Form.Dropdown.Item key={type} value={type} title={CERTIFICATE_LABELS[type]} />
            ))}
        </Form.Dropdown>
      )}
    </Form>
  );
}
