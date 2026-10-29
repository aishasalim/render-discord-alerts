// Polls Render for failed deploys and posts each new one to a Discord webhook.
// Env: RENDER_API_KEY, DISCORD_WEBHOOK_URL, SERVICE_IDS (comma-separated).
// DRY_RUN=1 prints the Discord payload instead of sending it.

const fs = require('node:fs');
const path = require('node:path');

const RENDER_API = 'https://api.render.com/v1';
const STATE_FILE = path.join(__dirname, 'state.json');
const FAILED = new Set(['build_failed', 'update_failed', 'pre_deploy_failed']);
const MAX_LINES = 25;
const MAX_REMEMBERED = 200;
const ERROR_PATTERN = /error|exception|failed|ERR!|cannot find|not defined|exited with status/i;

async function render(pathname, params = {}) {
  const url = new URL(RENDER_API + pathname);
  for (const [key, value] of Object.entries(params)) {
    for (const v of [].concat(value)) url.searchParams.append(key, v);
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Render ${pathname} returned ${res.status}: ${await res.text()}`);
  return res.json();
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]|\u001b\([A-Z]/g, '');
}

// Keeps the part of the log that explains the failure: from just before the
// first error-looking line, or the tail when nothing matches.
function pickErrorLines(messages) {
  const lines = messages.map(stripAnsi).map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  const first = lines.findIndex((l) => ERROR_PATTERN.test(l));
  const start = first === -1 ? Math.max(0, lines.length - MAX_LINES) : Math.max(0, first - 3);
  return lines.slice(start, start + MAX_LINES);
}

async function fetchDeployLogs(service, deploy) {
  const end = new Date(new Date(deploy.finishedAt || deploy.updatedAt).getTime() + 30_000);
  const data = await render('/logs', {
    ownerId: service.ownerId,
    resource: service.id,
    startTime: deploy.startedAt || deploy.createdAt,
    endTime: end.toISOString(),
    direction: 'forward',
    limit: 100,
  });
  return (data.logs || []).map((log) => log.message);
}

function buildMessage(service, deploy, lines) {
  const commit = deploy.commit || {};
  const sha = commit.id ? commit.id.slice(0, 7) : 'manual';
  const title = (commit.message || '').split('\n')[0] || '(no commit message)';
  let log = lines.join('\n') || '(no log lines found)';
  if (log.length > 3500) log = log.slice(0, 3500) + '\n…';
  return {
    username: 'Render',
    // Log text must never ping @everyone or a role.
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `Deploy failed: ${service.name}`,
      url: service.dashboardUrl ? `${service.dashboardUrl}/deploys/${deploy.id}` : undefined,
      color: 0xd93f3f,
      description: '```\n' + log.replace(/```/g, "'''") + '\n```',
      fields: [
        { name: 'Status', value: deploy.status, inline: true },
        { name: 'Commit', value: `\`${sha}\` ${title}`.slice(0, 1024), inline: true },
      ],
      timestamp: deploy.finishedAt || deploy.updatedAt,
    }],
  };
}

async function postToDiscord(payload) {
  if (process.env.DRY_RUN) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  const res = await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Discord returned ${res.status}: ${await res.text()}`);
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { alerted: [] };
  }
}

async function main() {
  for (const name of ['RENDER_API_KEY', 'SERVICE_IDS']) {
    if (!process.env[name]) throw new Error(`${name} is not set`);
  }
  if (!process.env.DRY_RUN && !process.env.DISCORD_WEBHOOK_URL) {
    throw new Error('DISCORD_WEBHOOK_URL is not set');
  }

  const state = loadState();
  const alerted = new Set(state.alerted);
  const serviceIds = process.env.SERVICE_IDS.split(',').map((s) => s.trim()).filter(Boolean);

  for (const serviceId of serviceIds) {
    const service = await render(`/services/${serviceId}`);
    const deploys = (await render(`/services/${serviceId}/deploys`, { limit: 10 })).map((d) => d.deploy);
    // Oldest first, so Discord shows failures in order.
    for (const deploy of deploys.reverse()) {
      if (!FAILED.has(deploy.status) || alerted.has(deploy.id)) continue;
      const lines = pickErrorLines(await fetchDeployLogs(service, deploy));
      await postToDiscord(buildMessage(service, deploy, lines));
      alerted.add(deploy.id);
      console.log(`Alerted ${service.name} ${deploy.id} (${deploy.status})`);
    }
  }

  state.alerted = [...alerted].slice(-MAX_REMEMBERED);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { pickErrorLines, buildMessage, stripAnsi };
