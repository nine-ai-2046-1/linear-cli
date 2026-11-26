import { Command } from "commander";
import type { AuthBinding, SecretStorageMode } from "../../auth/types.js";
import type { CliContext } from "../../cli/context.js";
import { assertExpectedIdentity } from "../../core/client.js";
import { CliError } from "../../core/errors.js";
import { formatKeyValue } from "../../core/output.js";

interface LoginCommandOptions {
  apiKey?: boolean;
  apiKeyStdin?: boolean;
  apiKeyFile?: string;
  app?: boolean;
  clientId?: string;
  clientSecretStdin?: boolean;
  clientCredentialsFile?: string;
  scopes?: string;
  port?: string;
  actor?: "user" | "app";
  storage?: SecretStorageMode;
}

function resolveStorageMode(raw?: string): SecretStorageMode {
  if (!raw) {
    return process.platform === "darwin" ? "keychain" : "file";
  }
  if (raw === "keychain" || raw === "file") {
    return raw;
  }
  throw new CliError("VALIDATION_ERROR", `Invalid --storage '${raw}': expected 'keychain' or 'file'.`);
}

async function performLogin(ctx: CliContext, opts: LoginCommandOptions, actionLabel: "login" | "reauth"): Promise<void> {
  const storage = resolveStorageMode(opts.storage);
  const preCheck = (identity: { account: AuthBinding["account"]; workspace: AuthBinding["workspace"] }) => {
    assertExpectedIdentity(
      {
        version: 1,
        authType: "api-key",
        storage,
        bindingId: "pending",
        folderHash: "pending",
        secretKey: "pending",
        account: identity.account,
        workspace: identity.workspace,
        createdAt: "",
        updatedAt: "",
      },
      ctx,
    );
  };

  if (opts.apiKey && opts.app) {
    throw new CliError("VALIDATION_ERROR", "Choose either '--api-key' or '--app', not both.");
  }

  if (opts.apiKey) {
    let key = "";
    if (opts.apiKeyStdin) {
      key = (await ctx.readStdin()).trim();
    } else if (opts.apiKeyFile) {
      key = ctx.readFileUtf8(opts.apiKeyFile, "--api-key-file").trim();
    } else {
      key = await ctx.promptRequired(
        "Enter Personal Linear API Key: ",
        "pass '--api-key-stdin' or '--api-key-file <path>' when running non-interactively.",
      );
    }
    ctx.output.addSecretToRedact(key);
    if (ctx.options.dryRun) {
      ctx.output.dryRun(`auth.${actionLabel}.api-key`, { folder: ctx.cwd, storage });
      return;
    }
    const binding = await ctx.authService.loginWithApiKey({
      cwd: ctx.cwd,
      apiKey: key,
      storage,
      validateBeforeSave: preCheck,
    });
    assertExpectedIdentity(binding, ctx);
    ctx.output.success(
      {
        authenticated: true,
        folder: ctx.cwd,
        authType: binding.authType,
        storage: binding.storage,
        account: binding.account,
        workspace: binding.workspace,
      },
      {
        human: () =>
          formatKeyValue([
            ["Status", "Authenticated"],
            ["Folder", ctx.cwd],
            ["Auth Type", binding.authType],
            ["Storage", binding.storage],
            ["Account", `${binding.account.name} (${binding.account.email ?? binding.account.id})`],
            ["Workspace", `${binding.workspace.name} (${binding.workspace.url})`],
          ]),
      },
    );
    return;
  }

  if (opts.app) {
    let clientId = opts.clientId?.trim() ?? "";
    let clientSecret = "";
    if (opts.clientCredentialsFile) {
      const raw = ctx.readFileUtf8(opts.clientCredentialsFile, "--client-credentials-file");
      let parsed: { client_id?: string; clientId?: string; client_secret?: string; clientSecret?: string };
      try {
        parsed = JSON.parse(raw);
      } catch (cause) {
        throw new CliError("VALIDATION_ERROR", "Invalid JSON in --client-credentials-file.", { cause });
      }
      clientId = clientId || String(parsed.client_id ?? parsed.clientId ?? "").trim();
      clientSecret = String(parsed.client_secret ?? parsed.clientSecret ?? "").trim();
    } else if (opts.clientSecretStdin) {
      clientSecret = (await ctx.readStdin()).trim();
    } else {
      if (!clientId) {
        clientId = await ctx.promptRequired(
          "Linear OAuth App Client ID: ",
          "pass '--client-id <id>' or '--client-credentials-file <json>' in non-interactive mode.",
        );
      }
      clientSecret = await ctx.promptRequired(
        "Linear OAuth App Client Secret: ",
        "pass '--client-secret-stdin' or '--client-credentials-file <json>' in non-interactive mode.",
      );
    }
    ctx.output.addSecretToRedact(clientSecret);
    if (ctx.options.dryRun) {
      ctx.output.dryRun(`auth.${actionLabel}.app`, {
        folder: ctx.cwd,
        storage,
        clientId,
        scopes: opts.scopes ?? "read,write",
      });
      return;
    }
    const binding = await ctx.authService.loginWithAppCredentials({
      cwd: ctx.cwd,
      clientId,
      clientSecret,
      scopes: opts.scopes,
      storage,
      validateBeforeSave: preCheck,
    });
    assertExpectedIdentity(binding, ctx);
    ctx.output.success(
      {
        authenticated: true,
        folder: ctx.cwd,
        authType: binding.authType,
        storage: binding.storage,
        account: binding.account,
        workspace: binding.workspace,
      },
      {
        human: () =>
          formatKeyValue([
            ["Status", "Authenticated (OAuth App)"],
            ["Folder", ctx.cwd],
            ["Auth Type", binding.authType],
            ["Storage", binding.storage],
            ["App Actor", `${binding.account.name} (${binding.account.id})`],
            ["Workspace", `${binding.workspace.name} (${binding.workspace.url})`],
          ]),
      },
    );
    return;
  }

  // Default: Personal OAuth 2.0 Authorization Code + PKCE
  if (!ctx.isInteractive) {
    throw new CliError(
      "AUTH_REQUIRED",
      "Browser OAuth login requires an interactive session. For non-interactive setup, use '--api-key --api-key-stdin' or '--app --client-credentials-file <path>'.",
    );
  }
  let clientId = opts.clientId?.trim() ?? "";
  let clientSecret: string | undefined;
  if (opts.clientCredentialsFile) {
    const raw = ctx.readFileUtf8(opts.clientCredentialsFile, "--client-credentials-file");
    const parsed = JSON.parse(raw) as { client_id?: string; clientId?: string; client_secret?: string; clientSecret?: string };
    clientId = clientId || String(parsed.client_id ?? parsed.clientId ?? "").trim();
    clientSecret = String(parsed.client_secret ?? parsed.clientSecret ?? "").trim() || undefined;
  } else if (opts.clientSecretStdin) {
    clientSecret = (await ctx.readStdin()).trim() || undefined;
  }
  if (!clientId) {
    clientId = await ctx.promptRequired(
      "Linear OAuth Client ID: ",
      "pass '--client-id <id>' to start OAuth PKCE login.",
    );
  }
  if (clientSecret) {
    ctx.output.addSecretToRedact(clientSecret);
  }
  const port = opts.port !== undefined ? Number(opts.port) : undefined;
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    throw new CliError("VALIDATION_ERROR", `Invalid --port '${String(opts.port)}'.`);
  }
  if (ctx.options.dryRun) {
    ctx.output.dryRun(`auth.${actionLabel}.oauth`, {
      folder: ctx.cwd,
      storage,
      clientId,
      scopes: opts.scopes ?? "read,write",
      actor: opts.actor ?? "user",
    });
    return;
  }

  const binding = await ctx.authService.loginWithOAuthPkce({
    cwd: ctx.cwd,
    clientId,
    clientSecret,
    scopes: opts.scopes,
    port,
    actor: opts.actor,
    storage,
    validateBeforeSave: preCheck,
  });
  assertExpectedIdentity(binding, ctx);
  ctx.output.success(
    {
      authenticated: true,
      folder: ctx.cwd,
      authType: binding.authType,
      storage: binding.storage,
      account: binding.account,
      workspace: binding.workspace,
    },
    {
      human: () =>
        formatKeyValue([
          ["Status", "Authenticated (OAuth PKCE)"],
          ["Folder", ctx.cwd],
          ["Auth Type", binding.authType],
          ["Storage", binding.storage],
          ["Account", `${binding.account.name} (${binding.account.email ?? binding.account.id})`],
          ["Workspace", `${binding.workspace.name} (${binding.workspace.url})`],
        ]),
    },
  );
}

function attachLoginOptions(cmd: Command): Command {
  return cmd
    .option("--api-key", "Authenticate using a personal Linear API key")
    .option("--api-key-stdin", "Read personal Linear API key from standard input")
    .option("--api-key-file <path>", "Read personal Linear API key from file")
    .option("--app", "Authenticate as OAuth app using client_credentials grant")
    .option("--client-id <id>", "Linear OAuth client ID")
    .option("--client-secret-stdin", "Read OAuth client secret from standard input")
    .option("--client-credentials-file <path>", "JSON file containing client_id and client_secret")
    .option("--scopes <scopes>", "Comma-separated OAuth scopes (default: read,write)")
    .option("--port <port>", "Local callback port for OAuth PKCE redirect")
    .option("--actor <actor>", "OAuth actor mode: user or app")
    .option("--storage <mode>", "Secret storage mode: keychain (macOS default) or file (0600)");
}

export function registerAuthCommands(program: Command, getContext: () => CliContext): void {
  const auth = program
    .command("auth")
    .description("Manage folder-scoped Linear authentication (.linear/auth.json)");

  attachLoginOptions(
    auth
      .command("login")
      .description("Authenticate the current working folder with Linear"),
  ).action(async (opts: LoginCommandOptions) => {
    await performLogin(getContext(), opts, "login");
  });

  attachLoginOptions(
    auth
      .command("reauth")
      .description("Replace existing Linear credentials in the current working folder"),
  ).action(async (opts: LoginCommandOptions) => {
    await performLogin(getContext(), opts, "reauth");
  });

  auth
    .command("status")
    .description("Show the Linear authentication binding for the current working folder")
    .action(async () => {
      const ctx = getContext();
      const st = await ctx.authService.getStatus(ctx.cwd);
      ctx.output.success(st, {
        human: () =>
          st.authenticated && st.binding
            ? formatKeyValue([
                ["Authenticated", "yes"],
                ["Folder", st.folder],
                ["Auth Type", st.binding.authType],
                ["Storage", st.binding.storage],
                ["Account", `${st.binding.account.name} (${st.binding.account.email ?? st.binding.account.id})`],
                ["Workspace", `${st.binding.workspace.name} (${st.binding.workspace.url})`],
                ["Updated At", st.binding.updatedAt],
              ])
            : formatKeyValue([
                ["Authenticated", "no"],
                ["Folder", st.folder],
                ["Auth File", st.authFile],
              ]),
      });
    });

  auth
    .command("whoami")
    .description("Verify active folder credentials live against Linear API")
    .action(async () => {
      const ctx = getContext();
      const live = await ctx.authService.whoami(ctx.cwd);
      const st = await ctx.authService.getStatus(ctx.cwd);
      if (st.binding) {
        assertExpectedIdentity(st.binding, ctx);
      }
      ctx.output.success(live, {
        human: () =>
          formatKeyValue([
            ["Folder", live.folder],
            ["Auth Type", live.authType],
            ["Storage", live.storage],
            ["Account", `${live.account.name} (${live.account.email ?? live.account.id})`],
            ["App Identity", live.account.isApp ? "yes" : "no"],
            ["Workspace", `${live.workspace.name} (${live.workspace.url})`],
          ]),
      });
    });

  auth
    .command("logout")
    .description("Remove Linear authentication binding and secret for the current folder only")
    .action(async () => {
      const ctx = getContext();
      if (ctx.options.dryRun) {
        ctx.output.dryRun("auth.logout", { folder: ctx.cwd });
        return;
      }
      const res = await ctx.authService.logout(ctx.cwd);
      ctx.output.success(res, {
        human: () =>
          res.loggedOut
            ? `Logged out '${res.previousAccount ?? "account"}' from folder ${res.folder}`
            : `No active login in folder ${res.folder}`,
      });
    });

  auth
    .command("revoke")
    .description("Revoke the current folder's OAuth token at Linear and remove local credentials")
    .action(async () => {
      const ctx = getContext();
      if (ctx.options.dryRun) {
        ctx.output.dryRun("auth.revoke", { folder: ctx.cwd });
        return;
      }
      const res = await ctx.authService.revoke(ctx.cwd);
      ctx.output.success(res, {
        human: () =>
          `Revoked credentials (revokedAtLinear=${String(res.revokedAtLinear)}) and logged out folder ${res.folder}`,
      });
    });
}
