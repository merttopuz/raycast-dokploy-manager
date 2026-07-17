import { Action, Icon, List } from "@raycast/api";
import { DokployClient } from "../api/client";
import { serviceKindConfig } from "../lib/service-kinds";
import { statusTag } from "../lib/status";
import { ServiceRef } from "../types/dokploy";
import { ServiceActions } from "./service-actions";
import { ServiceDetail } from "./service-detail";

interface ServiceListItemProps {
  client: DokployClient;
  service: ServiceRef;
  onDidChange: () => void;
  /** The search command shows which project a service belongs to; the project view doesn't need to. */
  showProject?: boolean;
  /** Records a frecency visit. Omitted by lists that aren't frecency-sorted. */
  onVisit?: () => void;
  onResetRanking?: () => void;
}

export function ServiceListItem({
  client,
  service,
  onDidChange,
  showProject = false,
  onVisit,
  onResetRanking,
}: ServiceListItemProps) {
  const config = serviceKindConfig(service.kind);
  const status = statusTag(service.status);

  return (
    <List.Item
      icon={{ source: config.icon, tintColor: config.color }}
      title={service.name || config.label}
      subtitle={showProject ? `${service.projectName} / ${service.environmentName}` : config.label}
      keywords={[config.label, config.kind, service.projectName, service.environmentName]}
      accessories={[{ tag: { value: status.value, color: status.color } }]}
      actions={
        <ServiceActions
          client={client}
          service={service}
          onDidChange={onDidChange}
          onVisit={onVisit}
          onResetRanking={onResetRanking}
          primaryAction={
            <Action.Push
              title="Show Details"
              icon={Icon.Sidebar}
              onPush={onVisit}
              target={<ServiceDetail client={client} service={service} onDidChange={onDidChange} />}
            />
          }
        />
      }
    />
  );
}
