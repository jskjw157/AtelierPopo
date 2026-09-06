# HAAR Social Studio Deployment Status

- Public URL: `https://social.haarapp.tech`
- Health endpoint: `https://social.haarapp.tech/api/health`
- Hosting: Hostinger VPS, Docker Compose, PostgreSQL
- Reverse proxy and HTTPS: existing host-network Caddy service
- Scheduled publishing runner: server cron every 5 minutes
- Last verified deployment workflow: successful from both the VPS and GitHub Actions runner
- Meta account connection: remains `설정 필요` until `META_APP_ID` and `META_APP_SECRET` are configured

The deployment workflow preserves the existing Caddy service, updates only the managed HAAR block in place, validates configuration before reload, and restores the previous Caddyfile if validation or reload fails.
