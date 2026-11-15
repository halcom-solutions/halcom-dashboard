#!/usr/bin/env bash
# Runs on the VPS, started by .github/workflows/deploy-hostinger.yml over SSH.
# Layout in /opt/halcom: .env (POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, DOMAIN), compose.hostinger.yaml, deploy-vps.sh, src/ (the commit to deploy).
# It builds the two images, dumps the database, runs the migrations, restarts the app and checks its health.
# If the app is not healthy it puts the previous image back (database migrations are NOT undone: restore the dump if one is to blame).
set -euo pipefail

cd "$(dirname "$0")"
: "${IMAGE_TAG:?IMAGE_TAG is not set}"
project=halcom-dashboard
compose="docker compose -p ${project} -f compose.hostinger.yaml"

# Keep Docker's client config next to the script: the home of the deploy user may not be writable.
export DOCKER_CONFIG="$PWD/.docker"
mkdir -p "$DOCKER_CONFIG"

echo "== Preflight"
docker info >/dev/null 2>&1 || { echo "User $(id -un) cannot use Docker. As root: usermod -aG docker $(id -un), then sign in again." >&2; exit 1; }
[ -f .env ] || { echo "Missing /opt/halcom/.env (DOMAIN, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB)." >&2; exit 1; }
for v in DOMAIN POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB; do
  grep -Eq "^${v}=.+" .env || { echo "/opt/halcom/.env has no value for ${v}." >&2; exit 1; }
done
domain="$(grep -E '^DOMAIN=' .env | tail -n 1 | cut -d= -f2- || true)"
fallback="$(grep -E '^FALLBACK_DOMAIN=.+' .env | tail -n 1 | cut -d= -f2- || true)"
fallback="${fallback:-srv2127418.hstgr.cloud}"
[ "$domain" != "$fallback" ] || { echo "DOMAIN and FALLBACK_DOMAIN are both ${domain}: Caddy needs two different names. Swap one in /opt/halcom/.env (see deploy/Caddyfile)." >&2; exit 1; }
[ -f Caddyfile ] || { echo "Missing /opt/halcom/Caddyfile (the workflow copies it)." >&2; exit 1; }
# A bad Caddyfile would stop the proxy and take the site down, so it is checked with the same image before anything is replaced.
docker run --rm --env-file .env -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null \
  || { echo "The Caddyfile is not valid (docker run caddy:2 caddy validate). Nothing was changed." >&2; exit 1; }
[ -f src/Dockerfile ] || { echo "Missing /opt/halcom/src (the workflow copies the commit there)." >&2; exit 1; }
# Never create an empty database by mistake: the stack made in Docker Manager must exist under the same project name.
if ! docker volume inspect "${project}_postgres_data" >/dev/null 2>&1 && [ "${ALLOW_NEW_DB:-0}" != "1" ]; then
  echo "Volume ${project}_postgres_data not found: this would start an empty database. Stopping." >&2
  exit 1
fi

echo "== Building $IMAGE_TAG"
docker build --target migrator -t "halcom-dashboard-migrate:${IMAGE_TAG}" src
docker build --target runner -t "halcom-dashboard-app:${IMAGE_TAG}" src

echo "== Remembering the current images for a rollback"
for n in app migrate; do
  if docker image inspect "halcom-dashboard-${n}:hostinger" >/dev/null 2>&1; then
    docker tag "halcom-dashboard-${n}:hostinger" "halcom-dashboard-${n}:previous"
  fi
  docker tag "halcom-dashboard-${n}:${IMAGE_TAG}" "halcom-dashboard-${n}:hostinger"
done

echo "== Starting the database"
$compose up -d db
for _ in $(seq 1 30); do
  $compose exec -T db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1 && break
  sleep 2
done
$compose exec -T db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null

echo "== Backing up before the migration"
umask 077
mkdir -p predeploy
dump="predeploy/pre-${IMAGE_TAG}-$(date -u +%Y%m%d-%H%M%SZ).dump"
$compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$dump"
[ -s "$dump" ] || { echo "The backup is empty, stopping." >&2; rm -f "$dump"; exit 1; }
ls -1t predeploy/*.dump 2>/dev/null | tail -n +11 | xargs -r rm --

echo "== Migrating"
$compose run --rm --no-deps migrate

echo "== Restarting the app"
$compose up -d --no-deps --force-recreate app
$compose up -d --no-deps caddy
# The Caddyfile may have changed while the container stayed the same: load it without dropping connections.
$compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

echo "== Waiting for /api/health"
cid="$($compose ps -q app)"
healthy=0
for _ in $(seq 1 40); do
  if docker exec "$cid" node -e "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 3
done

if [ "$healthy" -ne 1 ]; then
  echo "The app is not healthy. Last log lines:" >&2
  $compose logs --tail 80 app >&2 || true
  if docker image inspect "halcom-dashboard-app:previous" >/dev/null 2>&1; then
    echo "Putting the previous image back. The migrations are NOT undone: restore $dump if a migration is to blame." >&2
    docker tag "halcom-dashboard-app:previous" "halcom-dashboard-app:hostinger"
    $compose up -d --no-deps --force-recreate app
  fi
  exit 1
fi

echo "$IMAGE_TAG" > .last_good_tag
# Remove older build tags and dangling layers; keep the current tag and `previous`.
docker images --format '{{.Repository}}:{{.Tag}}' \
  | grep -E '^halcom-dashboard-(app|migrate):[0-9a-f]{12}$' | grep -v ":${IMAGE_TAG}$" | xargs -r docker rmi >/dev/null 2>&1 || true
docker image prune -f >/dev/null
echo "== Done: $IMAGE_TAG is live. Backup before this deploy: $dump"
