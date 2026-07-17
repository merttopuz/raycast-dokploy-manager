import { parse } from "smol-toml";

/**
 * What a template will create once it is installed, read out of its `template.toml`.
 *
 * This is a *preview*, and the distinction matters: the real values do not exist yet. Dokploy
 * generates them at install time - a fresh domain, a fresh secret - so nothing here can show what
 * they will be. What it can show is the shape: which variables, which domain, which port. That is
 * the question worth answering before installing something, and it is the only one this can answer
 * honestly.
 */
export interface TemplatePreview {
  domains: TemplateDomain[];
  env: TemplateEnvVar[];
  /** Config files the template writes into the stack. Their contents are not included - see below. */
  mountPaths: string[];
  /**
   * Every `${…}` that survives into the values above, explained.
   *
   * Built from what is actually rendered rather than from the `[variables]` table, which is the
   * only way the two can agree. A legend keyed by the table would list `${api_key}` beside an
   * environment that says `${password:32}` - describing tokens the reader cannot see, and leaving
   * the ones they can see unexplained.
   */
  legend: TemplateToken[];
}

export interface TemplateToken {
  /** The token as written, without the `${}` - `main_domain`, or `password:32`. */
  token: string;
  /** What it will become: a generator in words, or a plain value. */
  description: string;
}

export interface TemplateDomain {
  serviceName?: string;
  port?: number;
  /**
   * Undefined does *not* mean "no domain" - it means Dokploy generates one. A template that names
   * no host still gets an sslip.io address; the file just doesn't say what it will be.
   */
  host?: string;
  path?: string;
}

export interface TemplateEnvVar {
  key: string;
  value: string;
  /**
   * True when Dokploy will *not* substitute this value's `${…}` - it writes the token through
   * verbatim, so the service really does receive the seventeen characters `${admin_password}`.
   *
   * Only the single-pair-table form of `[config.env]`'s array shape does this, and only because
   * Dokploy's array branch returns `` `${key}=${value}` `` without ever calling its substituter.
   * It is almost certainly an upstream oversight, and it is the difference between a template that
   * works and one that ships a literal string as its admin password - so the legend says so
   * instead of promising a generated value that is never generated.
   */
  literal?: boolean;
}

/**
 * Reads a `template.toml`.
 *
 * Throws on malformed TOML, and that is the right outcome rather than something to paper over:
 * Dokploy parses this same file with the same grammar when it installs a template, so a file this
 * cannot read is a template Dokploy cannot deploy either. (Four of the registry's ~476 blueprints
 * are in exactly that state today.) Saying so beforehand is worth more than an empty preview.
 *
 * Note what is deliberately *not* done: `${main_domain}` is left alone rather than substituted for
 * the `${domain}` behind it. Resolving reads as more helpful and is worse. It flattens four
 * distinct secrets - `api_key`, `jwt_secret`, `encryption_key`, `postgres_password` - into four
 * identical lines of `${password:32}`, which says they are the same value when they are not. The
 * names are the only thing distinguishing them, and they are what the legend then explains.
 */
export function parseTemplateConfig(raw: string): TemplatePreview {
  const config = parse(raw) as RawTemplateConfig;

  const variables = readVariables(config);
  const domains = readDomains(config);
  const env = readEnv(config);
  const mountPaths = readMountPaths(config);

  return {
    domains,
    env,
    mountPaths,
    legend: readLegend(domains, env, mountPaths, variables),
  };
}

/* ------------------------------------------------------------------ the shape on disk */

/**
 * `template.toml` as it actually arrives.
 *
 * Every field is optional and unknown-typed on purpose. Dokploy parses these files with a bare
 * `parse(...) as CompleteTemplate` and no validation whatsoever, so the registry is free to
 * contain - and does contain - files that do not match the documented shape. Nothing below may
 * assume a field is there or is the type it should be.
 */
interface RawTemplateConfig {
  variables?: Record<string, unknown>;
  config?: {
    domains?: unknown;
    env?: unknown;
    mounts?: unknown;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Values arrive as strings, numbers or booleans; only strings carry `${...}` to resolve. */
function toText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/* ------------------------------------------------------------------ variables */

/**
 * A variable may be written in terms of another, and Dokploy settles the table against itself
 * before it resolves anything else - so this does too. Iterated to a fixed point rather than passed
 * over once, and bounded because a template is free to write `a = "${b}"` alongside `b = "${a}"`
 * and nothing upstream stops it.
 */
const MAX_VARIABLE_PASSES = 5;

function readVariables(config: RawTemplateConfig): Record<string, string> {
  const map: Record<string, string> = {};

  for (const [name, value] of Object.entries(config.variables ?? {})) {
    const expression = toText(value);
    if (expression !== undefined) map[name] = expression;
  }

  for (let pass = 0; pass < MAX_VARIABLE_PASSES; pass += 1) {
    let changed = false;
    for (const [name, expression] of Object.entries(map)) {
      // Self-reference would resolve to itself forever; leaving it be is the honest outcome.
      const resolved = substitute(expression, { ...map, [name]: `\${${name}}` });
      if (resolved !== expression) {
        map[name] = resolved;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return map;
}

/**
 * Substitutes `${name}` with what the `[variables]` table says it is.
 *
 * Only used to settle the table against itself - the rendered values keep their names, see
 * `parseTemplateConfig`.
 *
 * Generators are left standing, and they *win* over a variable of the same name. That is not a
 * detail worth guessing at: Dokploy tests the generator branches before it ever looks at the
 * table, so a template that declares `password = "${password:16}"` and then writes `${password}`
 * gets a **fresh random password**, not the variable it appears to name. Three templates in the
 * registry are written exactly that way.
 */
function substitute(value: string, variables: Record<string, string>): string {
  return value.replace(GENERATOR_PATTERN, (match, name: string) =>
    isGenerator(name) ? match : (variables[name] ?? match),
  );
}

/* ------------------------------------------------------------------ legend */

function tokensIn(value: string): string[] {
  return [...value.matchAll(GENERATOR_PATTERN)].map((match) => match[1]);
}

/**
 * Explains every `${…}` the reader can actually see, and nothing they can't.
 *
 * Order follows the values, so the legend reads in the order the questions arise. A token that is
 * neither a generator nor a declared variable is still listed: Dokploy leaves such a reference in
 * the environment verbatim, so a literal `${nope}` really is what the service ends up with, and
 * that is worth knowing before installing rather than after.
 */
function readLegend(
  domains: TemplateDomain[],
  env: TemplateEnvVar[],
  mountPaths: string[],
  variables: Record<string, string>,
): TemplateToken[] {
  // Every surface that gets shown and that Dokploy substitutes. Mount paths belong here: their
  // `filePath` goes through the same substituter, so a token can legitimately appear in one.
  const substituted = [
    ...domains.flatMap((domain) => [domain.host, domain.path]),
    ...mountPaths,
    ...env.filter((entry) => !entry.literal).map((entry) => entry.value),
  ];
  const written = env.filter((entry) => entry.literal).map((entry) => entry.value);

  const isSubstituted = new Set(substituted.flatMap((value) => tokensIn(value ?? "")));

  const seen = new Set<string>();
  const legend: TemplateToken[] = [];

  // Substituted surfaces first, so a token used in both places is described by what it becomes
  // rather than by the one place it doesn't.
  for (const value of [...substituted, ...written]) {
    for (const token of tokensIn(value ?? "")) {
      if (seen.has(token)) continue;
      seen.add(token);

      legend.push({
        token,
        description: isSubstituted.has(token)
          ? describeToken(token, variables)
          : "written through as-is - Dokploy does not fill this one in",
      });
    }
  }

  return legend;
}

/** Always answers. A token in the legend with nothing beside it is worse than no legend. */
function describeToken(token: string, variables: Record<string, string>): string {
  // Generators first, exactly as Dokploy resolves them - a variable of the same name is shadowed.
  if (isGenerator(token)) return describeGenerator(token);

  const expression = variables[token];
  if (expression === undefined) return "not defined by this template - left as written";

  // An empty variable is a deliberate blank, not a missing description: a couple of dozen
  // templates declare `mailer_host = ""` and the like, meaning "this is yours to fill in once it
  // is installed". Saying so is the single most useful thing this legend does - it is the setup
  // the template needs and cannot do for you.
  if (expression.trim() === "") return "blank - the template leaves this for you to fill in";

  // A variable that is exactly one generator is best described as that generator; anything else
  // (a literal, or a string built around one) is best shown as what it says.
  return describeSoleGenerator(expression) ?? expression;
}

/* ------------------------------------------------------------------ generators */

const GENERATOR_PATTERN = /\$\{([^}]+)\}/g;

/** Bare generator names, and the prefixes of the ones that take an argument. */
const GENERATOR_NAMES = new Set([
  "domain",
  "base64",
  "password",
  "hash",
  "uuid",
  "timestamp",
  "timestampms",
  "timestamps",
  "randomPort",
  "jwt",
  "username",
  "email",
]);

const GENERATOR_PREFIXES = ["base64:", "password:", "hash:", "timestampms:", "timestamps:", "jwt:"];

/**
 * Mirrors the tests Dokploy runs, prefixes included: it accepts `${base64:oops}` as a generator
 * and quietly falls back to a default length, so matching only well-formed arguments here would
 * hand that token to the variable lookup and disagree.
 */
function isGenerator(token: string): boolean {
  return GENERATOR_NAMES.has(token) || GENERATOR_PREFIXES.some((prefix) => token.startsWith(prefix));
}

/** What each sized generator produces when its argument is missing or unreadable. */
const DEFAULT_SIZES: Record<string, number> = { base64: 32, password: 16, hash: 8 };

const SIZED_LABELS: Record<string, string> = { base64: "base64 string", password: "password", hash: "hash" };

/**
 * A generator in words.
 *
 * Every token `isGenerator` accepts must get an answer here, and the two are easy to drift apart:
 * `isGenerator` matches the `base64:` *prefix* because Dokploy does, so `${base64:oops}` is a real
 * generator - Dokploy parses the length, gets NaN and falls back to 32. Describing only well-formed
 * arguments would leave that token in the legend with nothing beside it. Hence the same fallback.
 */
function describeGenerator(token: string): string {
  if (token === "domain") return "a generated sslip.io domain";
  if (token === "randomPort") return "a random port";
  if (token === "uuid") return "a random UUID";
  if (token === "username") return "a random username";
  if (token === "email") return "a random email address";
  if (token === "timestamp" || token === "timestampms" || token.startsWith("timestampms:")) {
    return "a timestamp in milliseconds";
  }
  if (token === "timestamps" || token.startsWith("timestamps:")) return "a timestamp in seconds";
  // Exactly `isGenerator`'s rule. `startsWith("jwt")` would also swallow `${jwtSecret}`, which is
  // a variable reference and not a generator at all.
  if (token === "jwt" || token.startsWith("jwt:")) return "a generated JWT";

  const [name, argument] = token.split(":", 2);
  const label = SIZED_LABELS[name];
  if (label) {
    const size = Number.parseInt(argument ?? "", 10);
    const length = Number.isFinite(size) && size > 0 ? size : DEFAULT_SIZES[name];
    return `a random ${label}, ${length} characters`;
  }

  return "generated on install";
}

/**
 * Describes a variable that is exactly one generator, and nothing else.
 *
 * Deliberately narrow. `api_key = "${password:32}"` becomes "a random password, 32 characters",
 * but `url = "https://${domain}/api"` does not become "a generated sslip.io domain" - it is a URL
 * built around one, and the caller shows the expression itself instead, which says more.
 */
function describeSoleGenerator(expression: string): string | undefined {
  const match = expression.match(/^\$\{([^}]+)\}$/);
  if (!match || !isGenerator(match[1])) return undefined;
  return describeGenerator(match[1]);
}

/* ------------------------------------------------------------------ domains */

function readDomains(config: RawTemplateConfig): TemplateDomain[] {
  const rows = config.config?.domains;
  if (!Array.isArray(rows)) return [];

  const records = rows.filter(isRecord);

  // Dokploy throws the whole list away unless at least one entry names a service - not just the
  // nameless ones, all of them. So a template like that publishes nothing, and saying it will
  // publish something would be the preview's worst possible mistake.
  if (records.every((row) => !toText(row.serviceName))) return [];

  return records.map((row) => ({
    serviceName: toText(row.serviceName),
    // TOML numbers, so `port = 3_001` has already become 3001 by the time it gets here. Which is
    // the reason this is parsed rather than pattern-matched: the registry writes ports that way.
    port: typeof row.port === "number" ? row.port : undefined,
    host: toText(row.host),
    path: toText(row.path),
  }));
}

/* ------------------------------------------------------------------ env */

/**
 * Reads `[config.env]`, which comes in two shapes.
 *
 * Usually a table (`KEY = "value"`), but Dokploy also accepts an array - of `"KEY=value"` strings,
 * or of single-pair tables. Both are handled here because both are handled there, and a template
 * using the array form would otherwise preview as having no environment at all.
 */
function readEnv(config: RawTemplateConfig): TemplateEnvVar[] {
  const env = config.config?.env;

  if (Array.isArray(env)) {
    return env.flatMap(readEnvArrayEntry);
  }

  if (isRecord(env)) {
    return Object.entries(env).flatMap(([key, value]) => {
      const text = toText(value);
      return text === undefined ? [] : [{ key, value: text }];
    });
  }

  return [];
}

function readEnvArrayEntry(entry: unknown): TemplateEnvVar[] {
  if (typeof entry === "string") {
    const separator = entry.indexOf("=");
    if (separator === -1) return [];
    return [{ key: entry.slice(0, separator).trim(), value: entry.slice(separator + 1) }];
  }

  // A single-pair table. Dokploy takes the first key, ignores the rest, and - unlike every other
  // shape - never substitutes the value. See `TemplateEnvVar.literal`.
  if (isRecord(entry)) {
    const [key] = Object.keys(entry);
    const text = key === undefined ? undefined : toText(entry[key]);
    if (key === undefined || text === undefined) return [];
    return [{ key, value: text, literal: true }];
  }

  return [];
}

/* ------------------------------------------------------------------ mounts */

/**
 * The paths of the config files a template writes - names only, never contents.
 *
 * The contents are why: a mount is a whole file inlined into the toml, and templates like Plausible
 * carry several hundred lines of XML in theirs. Showing them would bury the four things anyone
 * opened this to read.
 *
 * `filePath` is the field Dokploy reads. Some templates write `name`/`mountPath` instead, which
 * Dokploy silently drops on the floor - so those mounts do not happen, and listing them here would
 * promise a file that never appears.
 */
function readMountPaths(config: RawTemplateConfig): string[] {
  const mounts = config.config?.mounts;
  if (!Array.isArray(mounts)) return [];

  return mounts
    .filter(isRecord)
    .map((mount) => toText(mount.filePath))
    .filter((path): path is string => path !== undefined && path.length > 0);
}
