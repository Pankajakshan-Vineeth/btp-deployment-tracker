# Changes

## 0.1.0 (unreleased): 2026-10-09

Initial implementation.

- `btp-deploy <file.mtar>` validates the MTAR, collects OS, Git and CF metadata and the
  SHA-256 hash, records a start event, runs `cf deploy` (no shell), preserves its exit code
  and records the result.
- `--dry-run`: shows the collected details without deploying or contacting the backend.
- `--config`: interactive configuration of the backend URL and authentication method
  (`env-token`, `command`, `none`). No secrets are stored.
- `--allow-untracked`: explicit opt-in to deploy when the start event cannot be recorded.
  By default the CLI refuses to deploy (exit code 3).
- Extra `cf deploy` arguments can be passed after `--`.
- Undelivered finish events are queued locally and retried on the next run, only against
  the same backend URL.
- Output, error summaries and backend messages are redacted for tokens and secrets.
- Backend contract in `API_CONTRACT.md`, implemented by the CAP backend in `backend/`
  (SAP HANA via HDI, deployable as an MTA, deliberately without authentication). It also
  serves a page that lists the recorded deployments.
- Authentication method `none` is allowed for any HTTPS backend, not only localhost.
- Tests run on `node:test` with cf, Git and the backend mocked. No runtime dependencies.
