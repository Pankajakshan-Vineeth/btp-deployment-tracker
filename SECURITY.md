# Security

## What the CLI sends and stores

- **Sent to the tracking backend:** the MTAR's name, size and SHA-256 hash; the OS username;
  Git name, email, repository name, branch, commit, dirty flag and last commit author;
  the CF API endpoint, org, space and user; the platform and CLI version; timestamps, status
  and exit code; and on failure, a redacted error summary (the last 15 lines of `cf deploy`
  output, at most 2000 characters).
- **Never sent:** the MTAR file, source code, environment variables, CF tokens and the
  local repository path.
- **Stored locally:** `config.json` (backend URL, authentication method and token command;
  never a token) and `pending/<deploymentId>.json` (undelivered finish events, with no
  credentials). Both are in `%APPDATA%\btp-deployment-tracker` on Windows, or
  `~/.config/btp-deployment-tracker` elsewhere. On POSIX systems the files are created with
  mode `0600` and the directories with `0700`. Windows ignores these modes, so the files rely
  on the default per-user ACL of the profile directory.

## Secrets handling

- No credentials are hardcoded or committed. Tokens are read at request time from the
  environment or from a token command, and are never written to disk.
- All CLI output, error summaries and backend error messages pass through a redaction
  filter. It removes `Authorization` headers, `Bearer` tokens, JWTs,
  `token=`/`password=`/`secret=`/`api_key=` style values and credentials embedded in URLs.
  This filter is a safety net based on pattern matching, not a guarantee.
- `cf deploy` output is streamed to your terminal unchanged, exactly as if you had run `cf`
  yourself. Only the stored or transmitted error summary is redacted.
- The backend URL must be HTTPS, except for `localhost`. URLs containing credentials are rejected.
- All child processes (`cf`, `git`, the token command) run with argument arrays and no shell.

## Authentication options

Backend authentication needs an **organizational decision**. The CLI implements a small
interface (`src/services/auth.js`) with three methods:

| Method | How it works | Use for |
| --- | --- | --- |
| `env-token` | Reads a bearer token from `BTP_TRACKER_API_TOKEN` | Tokens injected by a secret manager or a short-lived token you fetch yourself |
| `command` | Runs a configured command (no shell) and uses its stdout as the bearer token | **Microsoft Entra ID** via the Azure CLI: `["az","account","get-access-token","--resource","api://<app-id>","--query","accessToken","-o","tsv"]`, or any approved company identity tool |
| `none` | No authentication | The backend in [backend/](backend/), which is deliberately open (see below) |

Recommended for production: Entra ID (or your approved IdP) with the `command` method. The
CAP backend validates the JWT, for example with SAP BTP XSUAA or IAS configured to trust
Entra ID, and stores the token's subject as the verified caller.

Avoid long-lived shared API keys in `BTP_TRACKER_API_TOKEN`. Anyone holding the key can
write records under any name.

On Windows, `az` is a `.cmd` script and cannot be started without a shell. Wrap it
explicitly, for example:
`["powershell","-NoProfile","-Command","az account get-access-token --resource api://<app-id> --query accessToken -o tsv"]`.

## Open backend

By decision, the CAP backend in [backend/](backend/) has **no authentication**. Anyone who
can reach its URL can read every record (including names, emails and error summaries) and can
create or complete records with any content. Records therefore prove nothing about who
deployed. To close it, add XSUAA or IAS (`cds add xsuaa`), put `@requires` back on the two
services, and switch the CLI to the `command` or `env-token` method.

## Identity limitations

- The OS username and Git `user.name`/`user.email` are **self-reported and unverified**.
  Anyone can set them to any value.
- `cfUser` is the identity the CF CLI is logged in as. If teams share a CF account or use
  a technical user, it does not identify the person.
- The only trustworthy identity is the one the backend derives from a validated token.
- Git metadata describes the working directory at deploy time. It does **not** prove which
  commit the MTAR was built from, especially when `gitDirty` is true.

## Coverage limitations

`btp-deploy` is a wrapper, not an interceptor. Deployments made with plain `cf deploy`, CI/CD
pipelines, the BTP cockpit or `--allow-untracked` with a failing backend are **not**
recorded. For complete coverage, combine this tool with CF audit events
(`cf curl /v3/audit_events`) or restricted space roles.

## Reporting a vulnerability

Report suspected vulnerabilities privately to the repository maintainers rather than in a
public issue.
