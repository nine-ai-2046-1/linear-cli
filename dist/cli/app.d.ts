import { Command } from "commander";
import { CliContext, type CliDependencies } from "./context.js";
export type CommandRegistrar = (program: Command, getContext: () => CliContext) => void;
export declare function registerDomainModule(registrar: CommandRegistrar): void;
export declare function createProgram(deps?: CliDependencies): {
    program: Command;
    getContext: () => CliContext;
    stderrBuffer: string[];
};
export declare function runCli(argv: string[], deps?: CliDependencies): Promise<number>;
