import { Command } from "commander";
import type { CliContext } from "../../cli/context.js";
export declare function getOrCreateSubcommand(parent: Command, name: string, description: string): Command;
export declare function registerWorkspaceCommands(program: Command, getContext: () => CliContext): void;
