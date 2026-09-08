#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
env_file="${DOCKER_PROD_ENV_FILE:-.env.docker.prod}"
action="${1:-up}"

usage() {
  cat <<'HELP'
Usage: ./scripts/docker-prod.sh [init|up|build|down|logs|status|migrate|help]

  init     Create .env.docker.prod from its template without overwriting it
  up       Build and start the production app; wait for a healthy container
  build    Build production and migration images
  down     Stop and remove the application stack
  logs     Follow application logs (Ctrl+C stops following, not the app)
  status   Show container status and published ports
  migrate  Apply committed migrations to the configured Neon Cloud database

Default: up. Override the environment file with DOCKER_PROD_ENV_FILE.
Set DATABASE_URL (pooled), DATABASE_URL_UNPOOLED (direct), JWT_SECRET,
and ARCJET_KEY in that file. Keep TLS verification enabled for both DB URLs.
Migrations are explicit: up never runs them. For a release, run build,
then migrate after reviewing the migrations, then up.
HELP
}

if (( $# > 1 )); then usage >&2; exit 2; fi
case "$action" in
  help|-h|--help) usage; exit 0 ;;
  init)
    if [[ -e "$env_file" ]]; then
      printf 'Keeping existing environment file: %s\n' "$env_file"
    else
      (umask 077; set -C; cat .env.docker.prod.example > "$env_file")
      printf 'Created %s. Fill in your production settings before starting.\n' "$env_file"
    fi
    exit 0 ;;
  up|build|down|logs|status|migrate) ;;
  *) usage >&2; exit 2 ;;
esac

command -v docker >/dev/null || { printf 'Docker is not installed or not on PATH.\n' >&2; exit 1; }
docker compose version >/dev/null
[[ -f "$env_file" ]] || { printf 'Missing %s. Run this script with init first.\n' "$env_file" >&2; exit 1; }

# Do not let exported development credentials override the production file.
# Compose parses dotenv syntax; the file is never executed by Bash.
unset DATABASE_URL DATABASE_URL_UNPOOLED JWT_SECRET JWT_EXPIRES_IN ARCJET_KEY
unset ARCJET_TRUSTED_PROXIES LOG_LEVEL APP_IMAGE APP_BIND_ADDRESS APP_PORT
compose=(docker compose --project-name acquisitions-prod --env-file "$env_file" -f compose.prod.yaml)
"${compose[@]}" config --quiet
docker info >/dev/null

case "$action" in
  up) "${compose[@]}" up -d --build --wait app; "${compose[@]}" ps ;;
  build) "${compose[@]}" build app migrate ;;
  down) "${compose[@]}" down ;;
  logs) "${compose[@]}" logs --follow app ;;
  status) "${compose[@]}" ps ;;
  migrate) "${compose[@]}" run --rm --build migrate ;;
esac
