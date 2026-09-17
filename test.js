'use strict';

const assert = require('assert');
const {
  parseBoolean,
  parseWarnDays,
  classifyDeprecation,
  overallStatus,
  buildMarkdownReport,
} = require('./lib');

const now = new Date('2026-09-17T00:00:00Z');

assert.strictEqual(parseBoolean('true'), true);
assert.strictEqual(parseBoolean('FALSE'), false);
assert.strictEqual(parseBoolean('', true), true);
assert.throws(() => parseBoolean('maybe'), /Invalid boolean/);

assert.strictEqual(parseWarnDays('14'), 14);
assert.throws(() => parseWarnDays('0'), /between 1 and 365/);
assert.throws(() => parseWarnDays('abc'), /between 1 and 365/);

assert.deepStrictEqual(
  classifyDeprecation('2026-09-30T00:00:00Z', 14, now),
  { status: 'WARNING', daysRemaining: 13 },
);
assert.deepStrictEqual(
  classifyDeprecation('2026-09-23T00:00:00Z', 14, now),
  { status: 'CRITICAL', daysRemaining: 6 },
);
assert.strictEqual(classifyDeprecation('2026-09-16T00:00:00Z', 14, now).status, 'EXPIRED');
assert.strictEqual(classifyDeprecation('2026-11-01T00:00:00Z', 14, now).status, 'SAFE');
assert.strictEqual(classifyDeprecation(null, 14, now).status, 'UNKNOWN');

assert.strictEqual(overallStatus([{ risk: 'SAFE' }, { risk: 'WARNING' }]), 'WARNING');
assert.strictEqual(overallStatus([{ risk: 'CRITICAL' }, { risk: 'EXPIRED' }]), 'EXPIRED');
assert.strictEqual(overallStatus([]), 'SAFE');

const markdown = buildMarkdownReport({
  target: 'acme',
  scope: 'organization',
  status: 'WARNING',
  totalRunners: 1,
  atRiskRunners: 1,
  expiredRunners: 0,
  runners: [{
    name: 'runner|1',
    version: '2.330.0',
    os: 'linux',
    status: 'online',
    runtimeDeprecatesAt: '2026-09-30T00:00:00Z',
    daysRemaining: 13,
    risk: 'WARNING',
  }],
});
assert.match(markdown, /Runner Fleet Doctor/);
assert.match(markdown, /runner\\\|1/);

console.log('Runner Fleet Doctor tests passed');
