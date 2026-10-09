'use strict';

/**
 * Authentication methods for the tracking backend. Each returns the HTTP headers to
 * send. Tokens are read at request time and never written to disk or logs.
 *
 * - env-token: bearer token from BTP_TRACKER_API_TOKEN (e.g. injected by a secret manager).
 * - command:   bearer token printed by an external command, e.g. the Azure CLI for
 *              Microsoft Entra ID: ["az","account","get-access-token","--resource","api://<app-id>",
 *              "--query","accessToken","-o","tsv"]. Run without a shell.
 * - none:      no authentication, for a backend that is deliberately open.
 */
const AUTH_METHODS = ['env-token', 'command', 'none'];

async function getAuthHeaders(config, { env = process.env, run }) {
  switch (config.authMethod) {
    case 'env-token': {
      const token = (env.BTP_TRACKER_API_TOKEN || '').trim();
      if (!token) throw new Error('BTP_TRACKER_API_TOKEN is not set (authentication method "env-token").');
      return { Authorization: `Bearer ${token}` };
    }
    case 'command': {
      if (!Array.isArray(config.tokenCommand) || config.tokenCommand.length === 0) {
        throw new Error('Authentication method "command" requires "tokenCommand" in the configuration file.');
      }
      const [command, ...args] = config.tokenCommand;
      const result = await run(command, args, { timeoutMs: 60000 });
      const token = result.code === 0 ? result.stdout.trim() : '';
      // Deliberately not including the command output: it may contain a token.
      if (!token) throw new Error(`Token command "${command}" failed (exit code ${result.code ?? 'none'}).`);
      return { Authorization: `Bearer ${token}` };
    }
    case 'none':
      return {};
    default:
      throw new Error(`Unknown authentication method "${config.authMethod}". Use one of: ${AUTH_METHODS.join(', ')}.`);
  }
}

module.exports = { AUTH_METHODS, getAuthHeaders };
