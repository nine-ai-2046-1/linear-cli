import type { LinearClient } from "@linear/sdk";
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
export declare function buildIssueFilter(client: LinearClient, opts: IssueListFilterOptions): Promise<Record<string, unknown>>;
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
export declare function mapIssueNode(issue: unknown): Promise<IssueSummaryDto>;
export declare function resolveIssueSummary(client: LinearClient, issueRef: string): Promise<{
    id: string;
    identifier: string;
    teamId: string | null;
}>;
