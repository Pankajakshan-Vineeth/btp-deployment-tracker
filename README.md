# BTP Deployment Tracker CLI

`btp-deploy` wraps the SAP Cloud Foundry CLI to record manual SAP BTP MTA deployments. For
each deployment it records who started it, when, which artifact went to which org and space,
which Git commit was checked out, and whether it succeeded. The records go to a separately
hosted CAP tracking backend.

> **Status:** 0.1.0, not yet released. The CAP backend in [backend/](backend/) implements
> [API_CONTRACT.md](API_CONTRACT.md) and runs locally, but is not yet deployed to BTP. Do not consider this production-ready until the backend
> authentication, the retry queue and failure handling have been verified against the real
> backend.

## Architecture

```text
developer machine                                  separately hosted
┌───────────────────────────────────────────┐      ┌──────────────────────────┐
│ btp-deploy app.mtar                       │      │ CAP tracking backend     │
│  1. validate MTAR, hash it (SHA-256)      │      │  POST /api/deployments/  │
│  2. collect OS / git / `cf target` info   │ HTTPS│       start              │
│  3. POST start event  ───────────────────────────▶       {id}/finish      │
│  4. cf deploy app.mtar  (real CF CLI)     │      │  → SAP HANA              │
│  5. POST finish event (or queue + retry)  │      └──────────────────────────┘
└───────────────────────────────────────────┘
```

The code is in [src/](src/). [commands/deploy.js](src/commands/deploy.js) runs the flow.
Metadata comes from the modules in [collectors/](src/collectors/). The HTTP client,
authentication and retry queue are in [services/](src/services/).

## Prerequisites

- Node.js **20 or later**.
- SAP Cloud Foundry CLI **v8+** ([install](https://docs.cloudfoundry.org/cf-cli/install-go-cli.html))
  with the MultiApps plugin, which provides `cf deploy`: `cf install-plugin multiapps`.
- Git (optional). Without it, the Git fields are recorded as `null`.
- Access to a tracking backend that implements [API_CONTRACT.md](API_CONTRACT.md).

## Local development and testing

```bash
git clone https://github.com/Pankajakshan-Vineeth/btp-deployment-tracker.git
cd btp-deployment-tracker
npm test          # node:test; cf, git and the backend are mocked, nothing is deployed
npm link          # makes `btp-deploy` available on your PATH from this checkout
btp-deploy --help
btp-deploy --dry-run path/to/app.mtar
```

There are no runtime dependencies, so `npm install` is not needed.

### Tracking backend (local)

[backend/](backend/) is the SAP CAP implementation of [API_CONTRACT.md](API_CONTRACT.md).
It has **no authentication** (see [SECURITY.md](SECURITY.md#open-backend)); opening its URL
shows the list of deployments. Locally it runs on an in-memory SQLite database:

```bash
cd backend
npm install
npm start                 # http://localhost:4004
npm test                  # runs the CLI's HTTP client against the real CAP server
```

Point the CLI at it with `BTP_TRACKER_API_URL=http://localhost:4004` and
`BTP_TRACKER_AUTH_METHOD=none`.

Deploy to Cloud Foundry (needs a HANA Cloud instance usable from the space; the HDI
container credentials reach the app through `VCAP_SERVICES`, no certificates to handle):

```bash
cd backend
mbt build
cf deploy mta_archives/btp-deployment-tracker_0.1.0.mtar
```

## Installation from GitHub

Install a tagged version straight from GitHub (you need read access to the repository):

```bash
npm install -g git+https://github.com/Pankajakshan-Vineeth/btp-deployment-tracker.git#v0.1.0
# or, using SSH for a private repository:
npm install -g git+ssh://git@github.com/Pankajakshan-Vineeth/btp-deployment-tracker.git#v0.1.0
```

The package is marked `private`, so it
cannot be published to the public npm registry by accident. GitHub is the intended
distribution channel.

## Configuration

Run the interactive setup. It never asks for or stores a secret:

```bash
btp-deploy --config
```

The setup writes `config.json` to `%APPDATA%\btp-deployment-tracker` on Windows, or to
`~/.config/btp-deployment-tracker` elsewhere. Environment variables take precedence over
the file:

| Variable | Purpose |
| --- | --- |
| `BTP_TRACKER_API_URL` | Backend base URL, e.g. `https://deploy-tracker.example.com`. HTTPS is required except for localhost. |
| `BTP_TRACKER_API_TOKEN` | Bearer token for the `env-token` authentication method |
| `BTP_TRACKER_AUTH_METHOD` | `env-token` (default), `command` or `none` |
| `BTP_TRACKER_TIMEOUT_MS` | Backend request timeout in milliseconds (default 15000) |
| `BTP_TRACKER_CONFIG_DIR` | Alternative configuration directory |

Authentication methods, including Microsoft Entra ID through the `command` method, are
described in [SECURITY.md](SECURITY.md#authentication-options). Which method to use in
production is an organizational decision.

## Usage

Before deploying, log in to Cloud Foundry and target the org and space:

```bash
cf login -a https://api.cf.eu10.hana.ondemand.com
cf target -o dev-org -s dev-space
```

Then deploy:

```bash
btp-deploy mta_archives/app.mtar
btp-deploy "My Folder/app v2.mtar"            # paths with spaces work
btp-deploy app.mtar -- -e dev.mtaext          # arguments after -- are passed to cf deploy
btp-deploy --allow-untracked app.mtar         # deploy even if the backend is unreachable
```

Run the command from the project's Git working directory; the Git metadata is read from
the current directory. Example output (values are illustrative):

```text
BTP Deployment Tracker

Deployment ID: 6d97c358-fa28-4988-ae1b-b4508643008a
Application artifact: app.mtar
Organization: dev-org
Space: dev-space
Branch: feature/example
...
Deployment start recorded.
Starting deployment...
<cf deploy output>
Deployment successful.

Deployment result recorded.
Status: SUCCESS
Duration: 1m 32s
Deployment ID: 6d97c358-fa28-4988-ae1b-b4508643008a
```

### Dry run

```bash
btp-deploy --dry-run app.mtar
```

A dry run collects and prints all metadata and the exact `cf deploy` command, then stops.
It does not deploy and does not contact the tracking backend. It also works without a
backend configuration or a CF login.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Deployment succeeded (or a dry run, `--help` or `--version` completed) |
| 2 | Invalid input or a failed precondition: bad MTAR path, unknown option, cf missing or not logged in, invalid configuration |
| 3 | Tracking unavailable. **cf deploy was not started.** |
| other | The exit code of `cf deploy` (1 if it was killed by a signal) |

### What happens when tracking fails

- **Start event fails** (no configuration, backend down, HTTP error, timeout, auth failure):
  the CLI stops **before** deploying and exits with code 3. `--allow-untracked` overrides
  this; the deployment then runs and is clearly reported as *not recorded*.
- **Finish event fails:** the deployment result is not lost. It is saved to
  `pending/<deploymentId>.json` in the configuration directory and re-sent at the start of
  the next `btp-deploy` run, but only to the same backend URL. Delivered entries are
  deleted. An entry the backend rejects with `409 Conflict` is discarded.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `The Cloud Foundry CLI ("cf") was not found on PATH` | Install cf CLI v8+ and reopen the terminal |
| `'deploy' is not a registered command` (in cf output) | `cf install-plugin multiapps` |
| `Not logged in to Cloud Foundry or no org/space targeted` | `cf login`, then `cf target -o ORG -s SPACE` |
| `no backend URL configured` | `btp-deploy --config`, or set `BTP_TRACKER_API_URL` |
| `BTP_TRACKER_API_TOKEN is not set` | Export the token in your shell, or switch to the `command` method |
| `Token command "az" failed` on Windows | Wrap it in PowerShell, see [SECURITY.md](SECURITY.md#authentication-options) |
| `did not respond within 15000 ms` | Check VPN/proxy access to the backend, or raise `BTP_TRACKER_TIMEOUT_MS` |
| `malformed (non-JSON) response` | The URL probably points at a login page or the wrong service |
| `Result of earlier deployment ... is still pending` | The backend is still rejecting it. Inspect or delete the file under `pending/`. |

## Limitations and security notes

- This is a **wrapper**, not an interceptor. Plain `cf deploy`, CI/CD pipelines and the BTP
  cockpit are not tracked, so the records are not a complete deployment history.
- The OS and Git identities are unverified. `cfUser` may be a shared or technical account.
  Only an identity the backend derives from a validated token is trustworthy.
- Git metadata describes the working directory, not necessarily the commit the MTAR was
  built from. `gitDirty: true` makes this explicit.
- The MTAR itself and source code are never uploaded. Only the MTAR's name, size and hash are sent.

See [SECURITY.md](SECURITY.md) for details.

## Updating

```bash
npm install -g git+https://github.com/Pankajakshan-Vineeth/btp-deployment-tracker.git#v<new-version>
btp-deploy --version
```

If you used `npm link` from a checkout, run `git pull` in that checkout instead. Release
notes are in [CHANGES.md](CHANGES.md).
