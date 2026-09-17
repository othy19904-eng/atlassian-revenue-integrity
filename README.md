# Runner Fleet Doctor

**Runner Fleet Doctor** is a GitHub Action that audits self-hosted GitHub Actions runners and flags versions approaching GitHub's runtime deprecation deadline before CI jobs stop being queued.

GitHub requires self-hosted runners to stay current. For GitHub Enterprise Cloud, runner versions can become ineligible to execute jobs when they fall outside the supported window. GitHub's REST API exposes each runner's version and the end-of-life schedule for that version.

## What it does

- inventories self-hosted runners at **organization** or **repository** scope;
- groups runners by installed runner version;
- calls GitHub's runner deprecation API for each distinct version;
- classifies runners as `SAFE`, `WARNING`, `CRITICAL`, `EXPIRED`, or `UNKNOWN`;
- writes a Markdown fleet report to the GitHub Actions job summary;
- exposes machine-readable outputs for follow-up automation;
- can optionally fail the workflow when an at-risk runner is detected.

It does **not** upgrade, restart, delete, or reconfigure runners.

## Quick start

```yaml
name: Runner Fleet Health

on:
  workflow_dispatch:
  schedule:
    - cron: "17 6 * * *"

jobs:
  audit-runners:
    runs-on: ubuntu-latest
    steps:
      - name: Audit self-hosted runners
        uses: othy19904-eng/atlassian-revenue-integrity@main
        with:
          scope: organization
          owner: your-org
          token: ${{ secrets.RUNNER_FLEET_TOKEN }}
          warn_days: "14"
          fail_on_risk: "false"
```

### Token permissions

For **organization** scope, use a fine-grained personal access token or GitHub App token with organization **Self-hosted runners: read** permission. The caller must have the access GitHub requires for the organization runner endpoints.

For **repository** scope, use a token that can read the repository's self-hosted runner administration data. GitHub currently documents **Administration: read** for fine-grained tokens on the runner deprecation endpoint.

The default repository `GITHUB_TOKEN` may not have enough permission for fleet inventory. Prefer a dedicated, read-only secret such as `RUNNER_FLEET_TOKEN`.

## Inputs

| Input | Default | Description |
|---|---:|---|
| `token` | required | GitHub token used only for runner/deprecation API reads. |
| `scope` | `organization` | `organization` or `repository`. |
| `owner` | current repository owner | Organization login for organization scope. |
| `repository` | current repository | `owner/repo` for repository scope. |
| `warn_days` | `14` | Number of days before runtime deprecation to start warning. |
| `fail_on_risk` | `false` | If `true`, fail when any runner is `WARNING`, `CRITICAL`, or `EXPIRED`. |
| `include_offline` | `true` | Include offline runners in the report. |
| `api_url` | `GITHUB_API_URL` | GitHub API base URL. |

## Outputs

| Output | Description |
|---|---|
| `status` | Overall fleet status. |
| `total_runners` | Number of runners included in the report. |
| `at_risk_runners` | Number of `WARNING`, `CRITICAL`, or `EXPIRED` runners. |
| `expired_runners` | Number of expired runners. |
| `report_json` | JSON report containing target metadata and runner results. |

## Status rules

- `EXPIRED`: runtime deprecation date has passed.
- `CRITICAL`: runtime deprecation is within 7 days.
- `WARNING`: runtime deprecation is within `warn_days`.
- `SAFE`: a deprecation schedule exists and is outside the warning window.
- `UNKNOWN`: GitHub did not return a usable deprecation date for that runner version.

## Why this exists

Self-hosted runner fleets are frequently pinned in VM images, container images, ARC configurations, Terraform, or provisioning scripts. A runner can look healthy until the supported version window closes; then jobs can remain queued or stop executing. Runner Fleet Doctor turns that moving support window into a scheduled, auditable check.

## Security model

Runner Fleet Doctor is read-only. It sends authenticated requests only to the configured GitHub API base URL, never prints the supplied token, and performs no mutation of runners or repositories.

Use the narrowest token permissions possible and rotate the token according to your organization's policy.

## Development

```bash
node test.js
```

No npm dependencies are required. The action uses the Node.js 20 runtime provided by GitHub Actions.

## License

MIT
