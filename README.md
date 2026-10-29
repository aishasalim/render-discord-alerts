# render-discord-alerts

A scheduled GitHub Action posts failed Render deploys, with the error log lines, to a Discord channel.

Every 10 minutes, `check.js` reads the last 10 deploys of each service in `SERVICE_IDS`.
For each failed deploy that it has not posted yet, it gets the logs from the deploy time window and sends them to Discord.
The IDs of posted deploys go into `state.json`, so each failure posts only once.

## Setup

1. Discord: Channel Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.
2. Render: Account Settings → API Keys → Create API Key.
3. Add both as repository secrets (Settings → Secrets and variables → Actions):
   - `RENDER_API_KEY`
   - `DISCORD_WEBHOOK_URL`
4. Optional: add a repository variable `SERVICE_IDS` (comma-separated). The default is the Project 3 service `srv-dbfv4q4ipgvc73e0i5fg`.
5. Actions tab → "Render deploy alerts" → Run workflow, to test it now.

## Security

The Render API key controls the whole Render workspace. It lives only in the repository secrets, never in the code.
The repo is public so scheduled runs use no paid Actions minutes. Secrets are not passed to workflows from forks.
Do not add collaborators: anyone with write access can change the workflow and read the secrets.

## Notes

- GitHub can start scheduled runs late (often 5–15 minutes) when it is busy.
- GitHub turns off scheduled workflows after 60 days without repo activity. The state commits count as activity.
- Local test: `npm test`. Dry run without Discord: `RENDER_API_KEY=... SERVICE_IDS=srv-... DRY_RUN=1 node check.js`.
