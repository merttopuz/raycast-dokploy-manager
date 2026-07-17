/**
 * Dokploy puts the commit in a deployment's `description`, but the format varies by how the
 * deploy was triggered: `"Commit: <40-char sha>"` for a git push, and `""`, `"NEW CHANGES"` or
 * `"Manual deployment"` otherwise. A 40-char sha eats the whole row and pushes the status and
 * date off the right edge, so shorten it the way git itself does.
 */
const COMMIT_PATTERN = /^\s*commit:\s*([0-9a-f]{7,40})\s*$/i;

export function formatDeploymentSubtitle(description?: string | null): string | undefined {
  const value = description?.trim();
  if (!value) return undefined;

  const commit = value.match(COMMIT_PATTERN);
  if (commit) return commit[1].slice(0, 7);

  return value;
}

/** The full description, for the tooltip and the copy action - nothing is lost, just moved. */
export function fullDeploymentDescription(description?: string | null): string | undefined {
  return description?.trim() || undefined;
}

/**
 * A deployment's `title` is the *whole* commit message - subject line, blank line and body. Passed
 * straight to a menu-bar item it renders as a wall of text, so only the subject line survives.
 */
export function firstLine(text?: string | null): string {
  return (text ?? "").split(/\r?\n/, 1)[0].trim();
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The one-line summary of a deployment, for a menu item that has no room for more. */
export function deploymentHeadline(title?: string | null, max = 64): string {
  const line = firstLine(title);
  return line ? truncate(line, max) : "Deployment";
}

/** Everything after the commit's subject line, for the one view with room to show it. */
export function commitMessageBody(title?: string | null): string | undefined {
  const lines = (title ?? "").split(/\r?\n/);
  if (lines.length < 2) return undefined;
  return lines.slice(1).join("\n").trim() || undefined;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/**
 * Sizes, 1024-based - which is deliberate, and worth explaining because 1024 is arguably the
 * wrong base here.
 *
 * `docker system df` prints base-*1000* sizes ("1.2GB" is 1.2e9), but Dokploy parses them back
 * with 1024 multipliers, so the `sizeBytes` it reports is ~7% higher than the real byte count.
 * That number is not ours to correct - it is the only one the route gives.
 *
 * Formatting it back with the same 1024 base is what makes this add up: the two errors cancel, and
 * a single row round-trips to exactly the string Docker printed. A *sum* of rows doesn't - it
 * inherits the ~7% and matches no one string - but it does match what Dokploy's own dashboard
 * shows, which is the number the user is comparing against. Switching this to 1000 would "fix" the
 * base and disagree with both. The rule is that the parse and the format share a base - see
 * `parseSize`.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1) return "0 B";

  // Clamped at both ends: a fraction of a byte would index UNITS off the front.
  const magnitude = Math.floor(Math.log(bytes) / Math.log(1024));
  const exponent = Math.min(Math.max(magnitude, 0), UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  // Bytes and kilobytes are never interesting to a decimal place; gigabytes always are.
  return `${value.toFixed(exponent < 2 ? 0 : 1)} ${UNITS[exponent]}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Menu-bar items have no date accessory, so the age goes in the subtitle as text. */
export function relativeTime(value?: string | null): string {
  if (!value) return "";

  const elapsed = Date.now() - new Date(value).getTime();
  if (Number.isNaN(elapsed)) return "";
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  return `${Math.floor(elapsed / DAY)}d ago`;
}
