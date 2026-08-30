#!/usr/bin/env bash
set -euo pipefail

exec 9>/run/lock/haar-social-caddy-guard.lock
flock -n 9 || exit 0

source /etc/haar-social-studio/caddy-guard.env
DOMAIN="$HAAR_SOCIAL_DOMAIN"
UPSTREAM="$HAAR_SOCIAL_UPSTREAM"
CADDY_CONTAINER="$HAAR_CADDY_CONTAINER"
HELPER=/usr/local/lib/haar-social-studio/ensure_caddy_route.py
BACKUP_DIR=/var/lib/haar-social-studio/caddy-backups

log() { printf '[haar-social-caddy-guard] %s\n' "$*"; }
fail() { log "ERROR: $*" >&2; exit 1; }

[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || fail 'invalid domain'
[[ "$UPSTREAM" =~ ^[A-Za-z0-9.:-]+$ ]] || fail 'invalid upstream'
command -v docker >/dev/null 2>&1 || fail 'docker is unavailable'
command -v python3 >/dev/null 2>&1 || fail 'python3 is unavailable'
docker inspect "$CADDY_CONTAINER" >/dev/null 2>&1 || fail 'shared Caddy container is missing'
[[ "$(docker inspect "$CADDY_CONTAINER" --format '{{.State.Running}}')" == true ]] \
  || docker start "$CADDY_CONTAINER" >/dev/null

curl -fsS --max-time 15 "http://$UPSTREAM/api/health" \
  | grep -q '"status":"ok"' || fail 'local HAAR application health check failed'

CADDYFILE="$(docker inspect "$CADDY_CONTAINER" \
  --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')"
[[ -n "$CADDYFILE" && -f "$CADDYFILE" ]] || fail 'Caddyfile bind-mount source was not found'

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/Caddyfile.$(date -u +%Y%m%dT%H%M%SZ).bak"
cp --preserve=mode,ownership,timestamps "$CADDYFILE" "$BACKUP"
chmod 600 "$BACKUP"

RESULT="$(python3 "$HELPER" --file "$CADDYFILE" \
  --domain "$DOMAIN" --upstream "$UPSTREAM")"
log "route source state: $RESULT"

IMAGE="$(docker inspect "$CADDY_CONTAINER" --format '{{.Config.Image}}')"
if ! docker run --rm --network none \
    -v "$CADDYFILE:/etc/caddy/Caddyfile:ro" \
    "$IMAGE" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
  cat "$BACKUP" > "$CADDYFILE"
  docker restart "$CADDY_CONTAINER" >/dev/null || true
  fail 'candidate Caddyfile validation failed; previous configuration restored'
fi

# Another deployment may replace the host file atomically. A file bind mount
# can then keep pointing at the old inode. Restart only in that case; otherwise
# use Caddy's zero-downtime reload.
if docker exec "$CADDY_CONTAINER" \
    grep -Fqx "$DOMAIN {" /etc/caddy/Caddyfile 2>/dev/null; then
  docker exec "$CADDY_CONTAINER" \
    caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
else
  log 'container bind mount is stale; restarting shared Caddy once'
  docker restart "$CADDY_CONTAINER" >/dev/null
fi

ACTIVE=false
for attempt in $(seq 1 20); do
  if curl -fsS --max-time 10 http://127.0.0.1:2019/config/apps/http/servers \
      | grep -Fq "$DOMAIN"; then
    ACTIVE=true
    break
  fi
  sleep 2
done
[[ "$ACTIVE" == true ]] || fail 'active Caddy configuration does not contain HAAR domain'

PUBLIC=false
for attempt in $(seq 1 24); do
  if curl --resolve "$DOMAIN:443:127.0.0.1" \
      -fsS --max-time 20 "https://$DOMAIN/api/health" \
      | grep -q '"status":"ok"'; then
    PUBLIC=true
    break
  fi
  sleep 5
done
[[ "$PUBLIC" == true ]] || fail 'HTTPS route did not become healthy'

find "$BACKUP_DIR" -type f -name 'Caddyfile.*.bak' -printf '%T@ %p\n' \
  | sort -nr | awk 'NR > 20 {print $2}' | xargs -r rm -f
log 'route and HTTPS health are normal'
