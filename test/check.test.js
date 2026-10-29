const test = require('node:test');
const assert = require('node:assert');
const { pickErrorLines, buildMessage, stripAnsi } = require('../check');

// Lines from the real failed deploy dep-dbho840473hc73ctkdi0 (2026-10-29).
const crashLog = [
  '\u001b[34m\u001b[1m==>\u001b(B\u001b[m \u001b[1mRunning build command \'npm ci\'...\u001b(B\u001b[m',
  'added 91 packages, and audited 92 packages in 515ms',
  '\u001b[32;1m==>\u001b[0;22m \u001b[1mBuild successful 🎉\u001b[22m',
  '> node src/server.js',
  '',
  '/opt/render/project/src/src/routes/kitchen.js:2',
  "io.emit('newOrder', {",
  '^',
  '',
  'ReferenceError: io is not defined',
  '    at Object.<anonymous> (/opt/render/project/src/src/routes/kitchen.js:2:1)',
  'Node.js v20.20.2',
  '\u001b[0;31m\u001b[1m==> Exited with status 1\u001b[0m',
];

test('stripAnsi removes color codes', () => {
  assert.strictEqual(stripAnsi('\u001b[0;31m\u001b[1m==> Exited\u001b[0m'), '==> Exited');
});

test('pickErrorLines starts just before the first error and drops blanks', () => {
  const lines = pickErrorLines(crashLog);
  assert.strictEqual(lines[0], '/opt/render/project/src/src/routes/kitchen.js:2');
  assert.ok(lines.includes('ReferenceError: io is not defined'));
  assert.ok(!lines.includes(''));
});

test('pickErrorLines falls back to the tail when nothing matches', () => {
  const many = Array.from({ length: 40 }, (_, i) => `line ${i}`);
  const lines = pickErrorLines(many);
  assert.strictEqual(lines.length, 25);
  assert.strictEqual(lines.at(-1), 'line 39');
});

test('buildMessage blocks mentions and links the deploy', () => {
  const service = { name: 'web', dashboardUrl: 'https://dashboard.render.com/web/srv-1' };
  const deploy = {
    id: 'dep-1',
    status: 'update_failed',
    finishedAt: '2026-10-29T17:36:50Z',
    commit: { id: 'e8bef05b0c05', message: 'initial setup\n\nbody' },
  };
  const msg = buildMessage(service, deploy, ['@everyone ```boom```']);
  assert.deepStrictEqual(msg.allowed_mentions, { parse: [] });
  assert.strictEqual(msg.embeds[0].url, 'https://dashboard.render.com/web/srv-1/deploys/dep-1');
  assert.strictEqual(msg.embeds[0].fields[1].value, '`e8bef05` initial setup');
  assert.ok(!msg.embeds[0].description.slice(3, -3).includes('```'));
});
