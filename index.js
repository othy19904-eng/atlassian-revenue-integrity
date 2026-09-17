'use strict';

const fs = require('fs');
const {
  parseBoolean,
  parseWarnDays,
  classifyDeprecation,
  overallStatus,
  buildMarkdownReport,
} = require('./lib');

const API_VERSION = '2026-03-10';

function input(name, fallback = '') {
  const key = `INPUT_${name.toUpperCase()}`;
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value.trim();
}

function workflowCommand(level, message) {
  const escaped = String(message)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
  console.log(`::${level}::${escaped}`);
}

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    console.log(`${name}=${value}`);
    return;
  }
  const delimiter = `RFD_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  fs.appendFileSync(outputFile, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, 'utf8');
}

function writeSummary(markdown) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) fs.appendFileSync(summaryFile, markdown, 'utf8');
  else console.log(markdown);
}

async function requestJson(apiUrl, token, path, { allow404 = false } = {}) {
  const url = `${apiUrl.replace(/\/$/, '')}${path}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': 'runner-fleet-doctor',
    },
  });

  if (allow404 && response.status === 404) return null;
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body && body.message ? `: ${body.message}` : '';
    } catch (_) {
      // Intentionally ignore non-JSON error bodies.
    }
    throw new Error(`GitHub API request failed (${response.status}) for ${path}${detail}`);
  }
  return response.json();
}

function endpoints(scope, owner, repository) {
  if (scope === 'organization') {
    const encodedOwner = encodeURIComponent(owner);
    return {
      target: owner,
      runners: (page) => `/orgs/${encodedOwner}/actions/runners?per_page=100&page=${page}`,
      deprecation: (version) => `/orgs/${encodedOwner}/actions/runners/deprecations/${encodeURIComponent(version)}`,
    };
  }

  if (scope === 'repository') {
    const parts = repository.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error('repository must be in owner/repo format');
    }
    const repoPath = `${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`;
    return {
      target: repository,
      runners: (page) => `/repos/${repoPath}/actions/runners?per_page=100&page=${page}`,
      deprecation: (version) => `/repos/${repoPath}/actions/runners/deprecations/${encodeURIComponent(version)}`,
    };
  }

  throw new Error('scope must be organization or repository');
}

async function listAllRunners(apiUrl, token, endpointFactory) {
  const runners = [];
  for (let page = 1; ; page += 1) {
    const payload = await requestJson(apiUrl, token, endpointFactory(page));
    const pageRunners = Array.isArray(payload.runners) ? payload.runners : [];
    runners.push(...pageRunners);
    if (pageRunners.length < 100) break;
  }
  return runners;
}

async function getDeprecationSchedules(apiUrl, token, versions, endpointFactory) {
  const schedules = new Map();
  for (const version of versions) {
    if (!version) continue;
    const schedule = await requestJson(apiUrl, token, endpointFactory(version), { allow404: true });
    schedules.set(version, schedule);
  }
  return schedules;
}

async function run() {
  const token = input('TOKEN');
  if (!token) throw new Error('token input is required');

  const scope = input('SCOPE', 'organization').toLowerCase();
  const owner = input('OWNER', process.env.GITHUB_REPOSITORY_OWNER || '');
  const repository = input('REPOSITORY', process.env.GITHUB_REPOSITORY || '');
  const warnDays = parseWarnDays(input('WARN_DAYS', '14'));
  const failOnRisk = parseBoolean(input('FAIL_ON_RISK', 'false'));
  const includeOffline = parseBoolean(input('INCLUDE_OFFLINE', 'true'), true);
  const apiUrl = input('API_URL', process.env.GITHUB_API_URL || 'https://api.github.com');

  if (scope === 'organization' && !owner) {
    throw new Error('owner input is required for organization scope');
  }
  if (scope === 'repository' && !repository) {
    throw new Error('repository input is required for repository scope');
  }

  const targetEndpoints = endpoints(scope, owner, repository);
  let runners = await listAllRunners(apiUrl, token, targetEndpoints.runners);
  if (!includeOffline) runners = runners.filter((runner) => runner.status !== 'offline');

  const versions = [...new Set(runners.map((runner) => runner.version).filter(Boolean))];
  const schedules = await getDeprecationSchedules(apiUrl, token, versions, targetEndpoints.deprecation);
  const now = new Date();

  const assessed = runners.map((runner) => {
    const schedule = runner.version ? schedules.get(runner.version) : null;
    const runtimeDeprecatesAt = schedule && schedule.runtime_deprecates_at
      ? schedule.runtime_deprecates_at
      : null;
    const registrationDeprecatesAt = schedule && schedule.registration_deprecates_at
      ? schedule.registration_deprecates_at
      : null;
    const classification = classifyDeprecation(runtimeDeprecatesAt, warnDays, now);

    return {
      id: runner.id,
      name: runner.name,
      os: runner.os,
      status: runner.status,
      busy: Boolean(runner.busy),
      ephemeral: Boolean(runner.ephemeral),
      version: runner.version || null,
      labels: Array.isArray(runner.labels) ? runner.labels.map((label) => label.name) : [],
      registrationDeprecatesAt,
      runtimeDeprecatesAt,
      risk: classification.status,
      daysRemaining: classification.daysRemaining,
    };
  });

  const order = { EXPIRED: 0, CRITICAL: 1, WARNING: 2, UNKNOWN: 3, SAFE: 4 };
  assessed.sort((a, b) => (order[a.risk] - order[b.risk]) || String(a.name).localeCompare(String(b.name)));

  const atRiskRunners = assessed.filter((runner) => ['WARNING', 'CRITICAL', 'EXPIRED'].includes(runner.risk)).length;
  const expiredRunners = assessed.filter((runner) => runner.risk === 'EXPIRED').length;

  const report = {
    generatedAt: now.toISOString(),
    apiVersion: API_VERSION,
    scope,
    target: targetEndpoints.target,
    warnDays,
    status: overallStatus(assessed),
    totalRunners: assessed.length,
    atRiskRunners,
    expiredRunners,
    runners: assessed,
  };

  const reportJson = JSON.stringify(report);
  writeSummary(buildMarkdownReport(report));
  setOutput('status', report.status);
  setOutput('total_runners', String(report.totalRunners));
  setOutput('at_risk_runners', String(report.atRiskRunners));
  setOutput('expired_runners', String(report.expiredRunners));
  setOutput('report_json', reportJson);

  if (report.status === 'UNKNOWN') {
    workflowCommand('warning', 'Some runner versions have no usable runtime deprecation schedule. Review token permissions and GitHub API support.');
  }

  if (failOnRisk && atRiskRunners > 0) {
    workflowCommand('error', `${atRiskRunners} self-hosted runner(s) are within the configured risk window.`);
    process.exitCode = 1;
  }
}

run().catch((error) => {
  workflowCommand('error', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
