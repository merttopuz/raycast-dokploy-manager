import { Icon, List } from "@raycast/api";
import { AccountDropdown } from "./components/account-dropdown";
import { NoAccounts } from "./components/no-accounts";
import { ServiceListItem } from "./components/service-list-item";
import { useAccounts } from "./hooks/use-accounts";
import { useServiceFrecency } from "./hooks/use-frecency";
import { useServices } from "./hooks/use-projects";
import { SERVICE_KIND_LIST } from "./lib/service-kinds";

export default function SearchServices() {
  const {
    accounts,
    activeAccount,
    client,
    isLoading: accountsLoading,
    switchAccount,
    hasAccounts,
    reloadAccounts,
  } = useAccounts();
  const { services, isLoading: servicesLoading, revalidate } = useServices(client);
  const { data: sortedServices, visitItem, resetRanking } = useServiceFrecency(services, client);

  if (!accountsLoading && !hasAccounts) {
    return (
      <List>
        <NoAccounts onAccountAdded={reloadAccounts} />
      </List>
    );
  }

  // Grouped by kind, so typing "post" surfaces the Postgres databases together rather than
  // interleaved with everything else. Kind names are in each item's keywords, so they're searchable.
  //
  // Filtering preserves order, so each section comes out in frecency order: the service you deploy
  // every day sits at the top of its section, rather than wherever Dokploy happened to return it.
  const grouped = SERVICE_KIND_LIST.map((config) => ({
    config,
    services: sortedServices.filter((service) => service.kind === config.kind),
  })).filter((group) => group.services.length > 0);

  return (
    <List
      isLoading={accountsLoading || servicesLoading}
      searchBarPlaceholder="Search applications, compose stacks and databases…"
      searchBarAccessory={
        <AccountDropdown accounts={accounts} activeAccountId={activeAccount?.id} onChange={switchAccount} />
      }
    >
      <List.EmptyView
        icon={Icon.MagnifyingGlass}
        title="No Services"
        description="This Dokploy account has no applications, compose stacks or databases yet."
      />

      {grouped.map((group) => (
        <List.Section key={group.config.kind} title={group.config.pluralLabel} subtitle={String(group.services.length)}>
          {group.services.map((service) =>
            client ? (
              <ServiceListItem
                key={`${service.kind}:${service.id}`}
                client={client}
                service={service}
                onDidChange={revalidate}
                onVisit={() => visitItem(service)}
                onResetRanking={() => resetRanking(service)}
                showProject
              />
            ) : null,
          )}
        </List.Section>
      ))}
    </List>
  );
}
