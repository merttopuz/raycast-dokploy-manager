import { Icon } from "@raycast/api";

/**
 * The four prune commands Dokploy exposes. `prune` is the aggressive one and `volumes` is the
 * dangerous one - see `CLEANUP_TASKS` for why they are not the same thing.
 */
export type CleanupTask = "images" | "containers" | "volumes" | "prune";

export interface CleanupTaskConfig {
  task: CleanupTask;
  route: string;
  label: string;
  icon: Icon;
  /** What the user is agreeing to, in the confirmation dialog. */
  description: string;
  /**
   * Whether this can destroy something the user wanted to keep.
   *
   * Only volume pruning can: images and containers are rebuildable artifacts, but a volume is
   * data. Dokploy takes the same view - its own "clean all" deliberately leaves volumes alone.
   */
  destroysData: boolean;
}

export const CLEANUP_TASKS: Record<CleanupTask, CleanupTaskConfig> = {
  images: {
    task: "images",
    route: "settings.cleanUnusedImages",
    label: "Clean Unused Images",
    icon: Icon.Layers,
    description: "Removes every image no container is using. They will be pulled or rebuilt again on the next deploy.",
    destroysData: false,
  },
  containers: {
    task: "containers",
    route: "settings.cleanStoppedContainers",
    label: "Clean Stopped Containers",
    icon: Icon.Stop,
    description: "Removes containers that have exited. Running services are not touched.",
    destroysData: false,
  },
  volumes: {
    task: "volumes",
    route: "settings.cleanUnusedVolumes",
    label: "Clean Unused Volumes",
    icon: Icon.HardDrive,
    // A volume that no container currently references is not the same thing as a volume nobody
    // wants: a stopped database still owns its data. This is the one cleanup that cannot be undone
    // by redeploying, which is why it is called out rather than listed alongside the others.
    description:
      "Permanently deletes every volume no container is currently using - including data belonging to services that are merely stopped. This cannot be undone.",
    destroysData: true,
  },
  prune: {
    task: "prune",
    route: "settings.cleanDockerPrune",
    label: "Prune Docker",
    icon: Icon.Trash,
    description:
      "Removes all unused images, stopped containers, unused networks and the entire build cache. Volumes are kept. The next deploy will be slower because nothing is cached.",
    destroysData: false,
  },
};

/** Volumes deliberately last: it is the only one that can delete data, and distance helps. */
export const CLEANUP_TASK_LIST: CleanupTaskConfig[] = [
  CLEANUP_TASKS.images,
  CLEANUP_TASKS.containers,
  CLEANUP_TASKS.prune,
  CLEANUP_TASKS.volumes,
];

export function cleanupTaskConfig(task: CleanupTask): CleanupTaskConfig {
  return CLEANUP_TASKS[task];
}
