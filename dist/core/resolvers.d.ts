import type { LinearClient } from "@linear/sdk";
export declare function isUuid(value: string): boolean;
export declare function formatPriorityName(priority: number | null | undefined): string;
export declare function parsePriority(raw: string | number): number;
export interface ResolvedTeam {
    id: string;
    key: string;
    name: string;
    description: string | null;
}
export declare function resolveTeam(client: LinearClient, ref: string): Promise<ResolvedTeam>;
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
export declare function resolveUser(client: LinearClient, ref: string): Promise<ResolvedUser>;
export interface ResolvedWorkflowState {
    id: string;
    name: string;
    type: string;
    color: string;
    position: number;
}
export declare function resolveWorkflowState(client: LinearClient, teamId: string, ref: string): Promise<ResolvedWorkflowState>;
export interface ResolvedLabel {
    id: string;
    name: string;
    color: string;
    description: string | null;
    isGroup: boolean;
    retiredAt: string | null;
}
export declare function resolveIssueLabel(client: LinearClient, ref: string, options?: {
    teamId?: string;
    allowGroup?: boolean;
    includeArchived?: boolean;
}): Promise<ResolvedLabel>;
export declare function resolveIssueLabels(client: LinearClient, refs: string[], options?: {
    teamId?: string;
    allowGroup?: boolean;
}): Promise<ResolvedLabel[]>;
export interface ResolvedProject {
    id: string;
    name: string;
    slugId: string;
    url: string;
}
export declare function resolveProject(client: LinearClient, ref: string): Promise<ResolvedProject>;
export declare function resolveProjectStatus(client: LinearClient, ref: string): Promise<{
    id: string;
    name: string;
    type: string;
}>;
export interface ResolvedCycle {
    id: string;
    number: number;
    name: string | null;
    startsAt: string;
    endsAt: string;
}
export declare function resolveCycle(client: LinearClient, ref: string, teamId?: string): Promise<ResolvedCycle>;
