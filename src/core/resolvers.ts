import type { LinearClient } from "@linear/sdk";
import { CliError } from "./errors.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

const PRIORITY_NAMES: Record<number, string> = {
  0: "No priority",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

export function formatPriorityName(priority: number | null | undefined): string {
  return PRIORITY_NAMES[priority ?? 0] ?? `Priority ${String(priority)}`;
}

export function parsePriority(raw: string | number): number {
  const norm = String(raw).trim().toLowerCase();
  if (norm === "0" || norm === "none" || norm === "no-priority" || norm === "no priority") return 0;
  if (norm === "1" || norm === "urgent") return 1;
  if (norm === "2" || norm === "high") return 2;
  if (norm === "3" || norm === "medium" || norm === "normal") return 3;
  if (norm === "4" || norm === "low") return 4;
  throw new CliError(
    "VALIDATION_ERROR",
    `Invalid priority '${String(raw)}': expected none|urgent|high|medium|low or 0..4.`,
  );
}

function assertSingleMatch<T>(
  entityType: string,
  query: string,
  candidates: T[],
  describeCandidate: (c: T) => Record<string, unknown>,
): T {
  if (candidates.length === 0) {
    throw new CliError("NOT_FOUND", `${entityType} '${query}' not found.`);
  }
  if (candidates.length > 1) {
    throw new CliError(
      "AMBIGUOUS_RESOURCE",
      `${entityType} '${query}' matched ${candidates.length} records; specify a UUID or unique key.`,
      {
        details: {
          query,
          candidates: candidates.map(describeCandidate),
        },
      },
    );
  }
  return candidates[0]!;
}

export interface ResolvedTeam {
  id: string;
  key: string;
  name: string;
  description: string | null;
}

export async function resolveTeam(client: LinearClient, ref: string): Promise<ResolvedTeam> {
  const q = ref.trim();
  if (!q) throw new CliError("VALIDATION_ERROR", "Team reference cannot be empty.");
  if (isUuid(q)) {
    try {
      const t = await client.team(q);
      return { id: t.id, key: t.key, name: t.name, description: t.description ?? null };
    } catch (cause) {
      throw new CliError("NOT_FOUND", `Team '${q}' not found.`, { cause });
    }
  }
  const conn = await client.teams({
    first: 100,
    filter: {
      or: [{ key: { eqIgnoreCase: q } }, { name: { eqIgnoreCase: q } }],
    },
  });
  const nodes = conn.nodes.map((t) => ({
    id: t.id,
    key: t.key,
    name: t.name,
    description: t.description ?? null,
  }));
  const exactKey = nodes.filter((t) => t.key.toLowerCase() === q.toLowerCase());
  if (exactKey.length === 1) return exactKey[0]!;
  const exactName = nodes.filter((t) => t.name.toLowerCase() === q.toLowerCase());
  return assertSingleMatch("Team", q, exactName.length > 0 ? exactName : exactKey, (t) => ({
    id: t.id,
    key: t.key,
    name: t.name,
  }));
}

export interface ResolvedUser {
  id: string;
  name: string;
  displayName: string;
  email: string | null;
  active: boolean;
  admin: boolean;
  guest: boolean;
  isApp: boolean;
}

function mapUserNode(u: unknown): ResolvedUser {
  const raw = u as {
    id: string;
    name: string;
    displayName?: string;
    email?: string | null;
    active?: boolean;
    admin?: boolean;
    guest?: boolean;
    app?: boolean;
  };
  const email = raw.email ?? null;
  return {
    id: raw.id,
    name: raw.name,
    displayName: raw.displayName ?? raw.name,
    email,
    active: raw.active ?? true,
    admin: Boolean(raw.admin),
    guest: Boolean(raw.guest),
    isApp: Boolean(raw.app) || Boolean(email && email.endsWith("@oauthapp.linear.app")),
  };
}

export async function resolveUser(client: LinearClient, ref: string): Promise<ResolvedUser> {
  const q = ref.trim();
  if (!q) throw new CliError("VALIDATION_ERROR", "User reference cannot be empty.");
  if (q.toLowerCase() === "me") {
    const viewer = await client.viewer;
    return mapUserNode(viewer);
  }
  if (isUuid(q)) {
    try {
      const u = await client.user(q);
      return mapUserNode(u);
    } catch (cause) {
      throw new CliError("NOT_FOUND", `User '${q}' not found.`, { cause });
    }
  }
  const conn = await client.users({
    first: 100,
    includeDisabled: true,
    filter: {
      or: [
        { email: { containsIgnoreCase: q } },
        { displayName: { containsIgnoreCase: q } },
        { name: { containsIgnoreCase: q } },
      ],
    },
  });
  const users = conn.nodes.map(mapUserNode);
  const lower = q.toLowerCase();
  const byEmail = users.filter((u) => (u.email ?? "").toLowerCase() === lower);
  if (byEmail.length > 0) {
    return assertSingleMatch("User", q, byEmail, (u) => ({ id: u.id, name: u.name, email: u.email }));
  }
  const exactActive = users.filter(
    (u) => u.active && (u.displayName.toLowerCase() === lower || u.name.toLowerCase() === lower),
  );
  if (exactActive.length > 0) {
    return assertSingleMatch("User", q, exactActive, (u) => ({
      id: u.id,
      name: u.name,
      displayName: u.displayName,
      email: u.email,
    }));
  }
  const partialActive = users.filter(
    (u) =>
      u.active &&
      ((u.email ?? "").toLowerCase().includes(lower) ||
        u.displayName.toLowerCase().includes(lower) ||
        u.name.toLowerCase().includes(lower)),
  );
  const pool = partialActive.length > 0 ? partialActive : users;
  return assertSingleMatch("User", q, pool, (u) => ({
    id: u.id,
    name: u.name,
    displayName: u.displayName,
    email: u.email,
  }));
}

export interface ResolvedWorkflowState {
  id: string;
  name: string;
  type: string;
  color: string;
  position: number;
}

export async function resolveWorkflowState(
  client: LinearClient,
  teamId: string,
  ref: string,
): Promise<ResolvedWorkflowState> {
  const q = ref.trim();
  if (!q) throw new CliError("VALIDATION_ERROR", "Workflow status reference cannot be empty.");
  if (isUuid(q)) {
    try {
      const s = await client.workflowState(q);
      return { id: s.id, name: s.name, type: s.type, color: s.color, position: s.position };
    } catch (cause) {
      throw new CliError("NOT_FOUND", `Workflow status '${q}' not found.`, { cause });
    }
  }
  const conn = await client.workflowStates({
    first: 100,
    filter: { team: { id: { eq: teamId } } },
  });
  const states = conn.nodes
    .map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      color: s.color,
      position: s.position,
    }))
    .sort((a, b) => a.position - b.position);

  const lower = q.toLowerCase();
  const byName = states.filter((s) => s.name.toLowerCase() === lower);
  if (byName.length > 0) {
    return assertSingleMatch("Workflow status", q, byName, (s) => ({ id: s.id, name: s.name, type: s.type }));
  }
  const byType = states.filter((s) => s.type.toLowerCase() === lower);
  return assertSingleMatch("Workflow status", q, byType, (s) => ({ id: s.id, name: s.name, type: s.type }));
}

export interface ResolvedLabel {
  id: string;
  name: string;
  color: string;
  description: string | null;
  isGroup: boolean;
  retiredAt: string | null;
}

export async function resolveIssueLabel(
  client: LinearClient,
  ref: string,
  options?: { teamId?: string; allowGroup?: boolean; includeArchived?: boolean },
): Promise<ResolvedLabel> {
  const q = ref.trim();
  if (!q) throw new CliError("VALIDATION_ERROR", "Label reference cannot be empty.");
  if (isUuid(q)) {
    try {
      const lbl = await client.issueLabel(q);
      const raw = lbl as unknown as {
        id: string;
        name: string;
        color: string;
        description?: string | null;
        isGroup?: boolean;
        retiredAt?: Date | string | null;
      };
      if (!options?.allowGroup && raw.isGroup) {
        throw new CliError("VALIDATION_ERROR", `Label '${raw.name}' (${raw.id}) is a label group and cannot be applied directly.`);
      }
      return {
        id: raw.id,
        name: raw.name,
        color: raw.color,
        description: raw.description ?? null,
        isGroup: Boolean(raw.isGroup),
        retiredAt: raw.retiredAt ? new Date(raw.retiredAt).toISOString() : null,
      };
    } catch (cause) {
      if (cause instanceof CliError) throw cause;
      throw new CliError("NOT_FOUND", `Label '${q}' not found.`, { cause });
    }
  }

  const filter: Record<string, unknown> = { name: { eqIgnoreCase: q } };
  if (options?.teamId) {
    filter.or = [{ team: { id: { eq: options.teamId } } }, { team: { null: true } }];
  }

  const conn = await client.issueLabels({
    first: 100,
    includeArchived: options?.includeArchived ?? false,
    filter: filter as Parameters<LinearClient["issueLabels"]>[0] extends { filter?: infer F } ? F : never,
  });
  const mapped: ResolvedLabel[] = conn.nodes.map((l) => {
    const raw = l as unknown as {
      id: string;
      name: string;
      color: string;
      description?: string | null;
      isGroup?: boolean;
      retiredAt?: Date | string | null;
    };
    return {
      id: raw.id,
      name: raw.name,
      color: raw.color,
      description: raw.description ?? null,
      isGroup: Boolean(raw.isGroup),
      retiredAt: raw.retiredAt ? new Date(raw.retiredAt).toISOString() : null,
    };
  });
  const exactMatches = mapped.filter((l) => l.name.toLowerCase() === q.toLowerCase());
  const candidates = options?.allowGroup ? exactMatches : exactMatches.filter((l) => !l.isGroup);
  if (candidates.length === 0 && exactMatches.some((l) => l.isGroup)) {
    throw new CliError("VALIDATION_ERROR", `Label '${q}' is a label group and cannot be applied directly.`);
  }
  return assertSingleMatch("Label", q, candidates, (l) => ({ id: l.id, name: l.name }));
}

export async function resolveIssueLabels(
  client: LinearClient,
  refs: string[],
  options?: { teamId?: string; allowGroup?: boolean },
): Promise<ResolvedLabel[]> {
  const results: ResolvedLabel[] = [];
  for (const ref of refs) {
    results.push(await resolveIssueLabel(client, ref, options));
  }
  return results;
}

export interface ResolvedProject {
  id: string;
  name: string;
  slugId: string;
  url: string;
}

export async function resolveProject(client: LinearClient, ref: string): Promise<ResolvedProject> {
  const q = ref.trim();
  if (!q) throw new CliError("VALIDATION_ERROR", "Project reference cannot be empty.");
  if (isUuid(q) || /^P-[A-Z0-9]+-\d+$/i.test(q)) {
    try {
      const p = await client.project(q);
      return { id: p.id, name: p.name, slugId: p.slugId, url: p.url };
    } catch (cause) {
      throw new CliError("NOT_FOUND", `Project '${q}' not found.`, { cause });
    }
  }
  const conn = await client.projects({
    first: 100,
    filter: {
      or: [{ slugId: { eq: q } }, { name: { eqIgnoreCase: q } }],
    } as Parameters<LinearClient["projects"]>[0] extends { filter?: infer F } ? F : never,
  });
  const nodes = conn.nodes.map((p) => ({
    id: p.id,
    name: p.name,
    slugId: p.slugId,
    url: p.url,
  }));
  const exactSlug = nodes.filter((p) => p.slugId === q);
  if (exactSlug.length === 1) return exactSlug[0]!;
  return assertSingleMatch("Project", q, nodes, (p) => ({ id: p.id, name: p.name, slugId: p.slugId }));
}

export async function resolveProjectStatus(
  client: LinearClient,
  ref: string,
): Promise<{ id: string; name: string; type: string }> {
  const q = ref.trim();
  if (!q) throw new CliError("VALIDATION_ERROR", "Project status reference cannot be empty.");
  const conn = await client.projectStatuses({ first: 100 });
  const statuses = conn.nodes.map((s) => ({ id: s.id, name: s.name, type: s.type }));
  if (isUuid(q)) {
    const found = statuses.find((s) => s.id.toLowerCase() === q.toLowerCase());
    if (!found) throw new CliError("NOT_FOUND", `Project status '${q}' not found.`);
    return found;
  }
  const lower = q.toLowerCase();
  const byName = statuses.filter((s) => s.name.toLowerCase() === lower);
  if (byName.length > 0) {
    return assertSingleMatch("Project status", q, byName, (s) => s);
  }
  const byType = statuses.filter((s) => s.type.toLowerCase() === lower);
  return assertSingleMatch("Project status", q, byType, (s) => s);
}

export interface ResolvedCycle {
  id: string;
  number: number;
  name: string | null;
  startsAt: string;
  endsAt: string;
}

function mapCycleNode(c: {
  id: string;
  number: number;
  name?: string | null;
  startsAt: Date | string;
  endsAt: Date | string;
}): ResolvedCycle {
  return {
    id: c.id,
    number: c.number,
    name: c.name ?? null,
    startsAt: new Date(c.startsAt).toISOString(),
    endsAt: new Date(c.endsAt).toISOString(),
  };
}

export async function resolveCycle(
  client: LinearClient,
  ref: string,
  teamId?: string,
): Promise<ResolvedCycle> {
  const q = ref.trim();
  if (!q) throw new CliError("VALIDATION_ERROR", "Cycle reference cannot be empty.");
  if (isUuid(q)) {
    try {
      const c = await client.cycle(q);
      return mapCycleNode(c);
    } catch (cause) {
      throw new CliError("NOT_FOUND", `Cycle '${q}' not found.`, { cause });
    }
  }
  if (!teamId) {
    throw new CliError(
      "VALIDATION_ERROR",
      `Resolving cycle '${q}' by selector/number/name requires '--team <team>'.`,
    );
  }
  const lower = q.toLowerCase();
  if (lower === "current") {
    const team = await client.team(teamId);
    const active = await team.activeCycle;
    if (!active) {
      throw new CliError("NOT_FOUND", `Team has no active current cycle.`);
    }
    return mapCycleNode(active);
  }
  const conn = await client.cycles({
    first: 100,
    filter: { team: { id: { eq: teamId } } },
  });
  const all = conn.nodes.map(mapCycleNode).sort((a, b) => a.number - b.number);
  const now = Date.now();
  if (lower === "next") {
    const upcoming = all.filter((c) => Date.parse(c.startsAt) > now);
    if (upcoming.length === 0) throw new CliError("NOT_FOUND", "No upcoming next cycle found for team.");
    return upcoming[0]!;
  }
  if (lower === "previous") {
    const past = all.filter((c) => Date.parse(c.endsAt) < now);
    if (past.length === 0) throw new CliError("NOT_FOUND", "No completed previous cycle found for team.");
    return past[past.length - 1]!;
  }
  if (/^\d+$/.test(q)) {
    const num = Number(q);
    const byNum = all.filter((c) => c.number === num);
    return assertSingleMatch("Cycle", q, byNum, (c) => ({ id: c.id, number: c.number, name: c.name }));
  }
  const byName = all.filter((c) => (c.name ?? "").toLowerCase() === lower);
  return assertSingleMatch("Cycle", q, byName, (c) => ({ id: c.id, number: c.number, name: c.name }));
}
