'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseWarnDays(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
    throw new Error('warn_days must be an integer between 1 and 365');
  }
  return parsed;
}

function classifyDeprecation(runtimeDeprecatesAt, warnDays, now = new Date()) {
  if (!runtimeDeprecatesAt) {
    return { status: 'UNKNOWN', daysRemaining: null };
  }

  const deadline = new Date(runtimeDeprecatesAt);
  if (Number.isNaN(deadline.getTime())) {
    return { status: 'UNKNOWN', daysRemaining: null };
  }

  const deltaMs = deadline.getTime() - now.getTime();
  const daysRemaining = Math.ceil(deltaMs / DAY_MS);

  if (deltaMs <= 0) return { status: 'EXPIRED', daysRemaining };
  if (daysRemaining <= 7) return { status: 'CRITICAL', daysRemaining };
  if (daysRemaining <= warnDays) return { status: 'WARNING', daysRemaining };
  return { status: 'SAFE', daysRemaining };
}

function overallStatus(runners) {
  const priority = ['EXPIRED', 'CRITICAL', 'WARNING', 'UNKNOWN', 'SAFE'];
  for (const status of priority) {
    if (runners.some((runner) => runner.risk === status)) return status;
  }
  return 'SAFE';
}

function escapeMarkdown(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

function riskIcon(status) {
  return {
    SAFE: '✅',
    WARNING: '⚠️',
    CRITICAL: '🟠',
    EXPIRED: '❌',
    UNKNOWN: '❓',
  }[status] || '❓';
}

function buildMarkdownReport(report) {
  const lines = [];
  lines.push('# Runner Fleet Doctor');
  lines.push('');
  lines.push(`**Target:** \`${escapeMarkdown(report.target)}\``);
  lines.push(`**Scope:** \`${escapeMarkdown(report.scope)}\``);
  lines.push(`**Overall status:** ${riskIcon(report.status)} **${report.status}**`);
  lines.push(`**Runners:** ${report.totalRunners} total · ${report.atRiskRunners} at risk · ${report.expiredRunners} expired`);
  lines.push('');

  if (report.runners.length === 0) {
    lines.push('_No self-hosted runners were returned for this target._');
    return `${lines.join('\n')}\n`;
  }

  lines.push('| Risk | Runner | Version | OS | State | Runtime deprecates | Days left |');
  lines.push('|---|---|---|---|---|---|---:|');
  for (const runner of report.runners) {
    const days = runner.daysRemaining === null ? '—' : runner.daysRemaining;
    const deadline = runner.runtimeDeprecatesAt || '—';
    lines.push(`| ${riskIcon(runner.risk)} ${runner.risk} | ${escapeMarkdown(runner.name)} | ${escapeMarkdown(runner.version || 'unknown')} | ${escapeMarkdown(runner.os || 'unknown')} | ${escapeMarkdown(runner.status || 'unknown')} | ${escapeMarkdown(deadline)} | ${days} |`);
  }
  lines.push('');
  lines.push('Runner Fleet Doctor is read-only. It does not upgrade, restart, or delete runners.');
  return `${lines.join('\n')}\n`;
}

module.exports = {
  parseBoolean,
  parseWarnDays,
  classifyDeprecation,
  overallStatus,
  buildMarkdownReport,
};
