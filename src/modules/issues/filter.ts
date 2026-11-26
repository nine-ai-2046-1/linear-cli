import type { LinearClient } from "@linear/sdk";
import { CliError } from "../../core/errors.js";
import {
  formatPriorityName,
  isUuid,
  parsePriority,
  resolveCycle,
  resolveProject,
  resolveTeam,
  resolveUser,
  resolveWorkflowState,
} from "../../core/resolvers.js";

export interface IssueListFilterOptions {
  assignee?: string;
  unassigned?: boolean;
  status?: string;
  team?: string;
  project?: string;
  cycle?: string;
  label?: string[];
  priority?: string;
  updatedAfter?: string;
  createdAfter?: string;
  completedAfter?: string;
  dueBefore?: string;
  creator?: string;
  parent?: string;
}

export async function buildIssueFilter(
  client: LinearClient,
  opts: IssueListFilterOptions,
): Promise<Record<string, unknown>> {
  if (opts.assignee && opts.unassigned) {
    throw new CliError(
      "VALIDATION_ERROR",
      "Cannot combine '--assignee' and '--unassigned'. Choose one.",
    );
  }

  const andClauses: Array<Record<string, unknown>> = [];
  let resolvedTeamId: string | undefined;

  if (opts.team) {
    const team = await resolveTeam(client, opts.team);
    resolvedTeamId = team.id;
    andClauses.push({ team: { id: { eq: team.id } } });
  }

  if (opts.unassigned) {
    andClauses.push({ assignee: { null: true } });
  } else if (opts.assignee) {
    const user = await resolveUser(client, opts.assignee);
    andClauses.push({ assignee: { id: { eq: user.id } } });
  }

  if (opts.creator) {
    const creator = await resolveUser(client, opts.creator);
    andClauses.push({ creator: { id: { eq: creator.id } } });
  }

  if (opts.status) {
    if (resolvedTeamId) {
      const st = await resolveWorkflowState(client, resolvedTeamId, opts.status);
      andClauses.push({ state: { id: { eq: st.id } } });
    } else if (isUuid(opts.status)) {
      andClauses.push({ state: { id: { eq: opts.status.trim() } } });
    } else {
      const s = opts.status.trim();
      andClauses.push({
        or: [{ state: { name: { eqIgnoreCase: s } } }, { state: { type: { eqIgnoreCase: s } } }],
      });
    }
  }

  if (opts.project) {
    const proj = await resolveProject(client, opts.project);
    andClauses.push({ project: { id: { eq: proj.id } } });
  }

  if (opts.cycle) {
    const cyc = await resolveCycle(client, opts.cycle, resolvedTeamId);
    andClauses.push({ cycle: { id: { eq: cyc.id } } });
  }

  if (opts.label && opts.label.length > 0) {
    for (const lbl of opts.label) {
      const trimmed = lbl.trim();
      if (isUuid(trimmed)) {
        andClauses.push({ labels: { id: { eq: trimmed } } });
      } else {
        andClauses.push({ labels: { name: { eqIgnoreCase: trimmed } } });
      }
    }
  }

  if (opts.priority !== undefined) {
    const p = parsePriority(opts.priority);
    andClauses.push({ priority: { eq: p } });
  }

  if (opts.updatedAfter) {
    andClauses.push({ updatedAt: { gte: opts.updatedAfter.trim() } });
  }
  if (opts.createdAfter) {
    andClauses.push({ createdAt: { gte: opts.createdAfter.trim() } });
  }
  if (opts.completedAfter) {
    andClauses.push({ completedAt: { gte: opts.completedAfter.trim() } });
  }
  if (opts.dueBefore) {
    andClauses.push({ dueDate: { lte: opts.dueBefore.trim() } });
  }

  if (opts.parent) {
    const parentIssue = await resolveIssueSummary(client, opts.parent);
    andClauses.push({ parent: { id: { eq: parentIssue.id } } });
  }

  if (andClauses.length === 0) return {};
  if (andClauses.length === 1) return andClauses[0]!;
  return { and: andClauses };
}

export interface IssueSummaryDto {
  id: string;
  identifier: string;
  title: string;
  status: string | null;
  statusType: string | null;
  priority: number;
  priorityName: string;
  assignee: string | null;
  assigneeId: string | null;
  team: string | null;
  teamId: string | null;
  project: string | null;
  projectId: string | null;
  labels: string[];
  dueDate: string | null;
  estimate: number | null;
  url: string;
  branchName: string | null;
  archivedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function mapIssueNode(issue: unknown): Promise<IssueSummaryDto> {
  const raw = issue as {
    id: string;
    identifier: string;
    title: string;
    priority?: number;
    dueDate?: string | null;
    estimate?: number | null;
    url: string;
    branchName?: string | null;
    archivedAt?: Date | string | null;
    createdAt?: Date | string | null;
    updatedAt?: Date | string | null;
    state?: Promise<{ id: string; name: string; type: string } | undefined> | { id: string; name: string; type: string };
    assignee?: Promise<{ id: string; name: string; email?: string | null } | undefined> | { id: string; name: string };
    team?: Promise<{ id: string; key: string; name: string } | undefined> | { id: string; key: string; name: string };
    project?: Promise<{ id: string; name: string } | undefined> | { id: string; name: string };
    labels?: () => Promise<{ nodes: Array<{ name: string }> }>;
  };

  const [state, assignee, team, project, labelsConn] = await Promise.all([
    Promise.resolve(raw.state).catch(() => undefined),
    Promise.resolve(raw.assignee).catch(() => undefined),
    Promise.resolve(raw.team).catch(() => undefined),
    Promise.resolve(raw.project).catch(() => undefined),
    typeof raw.labels === "function" ? raw.labels().catch(() => ({ nodes: [] })) : Promise.resolve({ nodes: [] }),
  ]);

  const prio = raw.priority ?? 0;
  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    status: state?.name ?? null,
    statusType: state?.type ?? null,
    priority: prio,
    priorityName: formatPriorityName(prio),
    assignee: assignee?.name ?? null,
    assigneeId: assignee?.id ?? null,
    team: team?.key ?? null,
    teamId: team?.id ?? null,
    project: project?.name ?? null,
    projectId: project?.id ?? null,
    labels: labelsConn.nodes.map((l) => l.name),
    dueDate: raw.dueDate ?? null,
    estimate: raw.estimate ?? null,
    url: raw.url,
    branchName: raw.branchName ?? null,
    archivedAt: raw.archivedAt ? new Date(raw.archivedAt).toISOString() : null,
    createdAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : null,
    updatedAt: raw.updatedAt ? new Date(raw.updatedAt).toISOString() : null,
  };
}

export async function resolveIssueSummary(
  client: LinearClient,
  issueRef: string,
): Promise<{ id: string; identifier: string; teamId: string | null }> {
  const q = issueRef.trim();
  if (!q) {
    throw new CliError("VALIDATION_ERROR", "Issue reference cannot be empty.");
  }
  try {
    const issue = await client.issue(q);
    const team = await Promise.resolve(issue.team).catch(() => undefined);
    return {
      id: issue.id,
      identifier: issue.identifier,
      teamId: team?.id ?? null,
    };
  } catch (cause) {
    throw new CliError("NOT_FOUND", `Issue '${q}' not found.`, { cause });
  }
}
