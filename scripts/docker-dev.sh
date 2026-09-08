#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
env_file="${DOCKER_DEV_ENV_FILE:-.env.docker.dev}"
action="${1:-up}"

usage() {
  cat <<'HELP'
Usage: ./scripts/docker-dev.sh [init|up|build|down|logs|status|migrate|test|help]

  init     Create .env.docker.dev from its template without overwriting it
  up       Build and start the app and Neon Local; wait for healthy containers
  build    Build development and migration images
  down     Stop and remove the stack (the existing Neon branch is preserved)
  logs     Follow application logs (Ctrl+C stops following, not the app)
  status   Show container status and published ports
  migrate  Start Neon Local and apply committed migrations to the dev branch
  test     Build and run isolated tests and lint; no Neon credentials needed

Default: up. Override the environment file with DOCKER_DEV_ENV_FILE.
Set NEON_API_KEY, NEON_PROJECT_ID, BRANCH_ID, JWT_SECRET, and ARCJET_KEY
in the environment file before starting. Neon Local requires internet access.
HELP
}

if (( $# > 1 )); then usage >&2; exit 2; fi
case "$action" in
  help|-h|--help) usage; exit 0 ;;
  init)
    if [[ -e "$env_file" ]]; then
      printf 'Keeping existing environment file: %s\n' "$env_file"
    else
      (umask 077; set -C; cat .env.docker.dev.example > "$env_file")
      printf 'Created %s. Fill in your development settings before starting.\n' "$env_file"
    fi
    exit 0 ;;
  up|build|down|logs|status|migrate|test) ;;
  *) usage >&2; exit 2 ;;
esac

command -v docker >/dev/null || { printf 'Docker is not installed or not on PATH.\n' >&2; exit 1; }
docker compose version >/dev/null

# Use this environment's file, rather than accidentally inheriting another
# project's exported Compose variables. Never source credentials as shell code.
unset NEON_API_KEY NEON_PROJECT_ID BRANCH_ID NEON_DATABASE_NAME NEON_LOCAL_IMAGE
unset JWT_SECRET JWT_EXPIRES_IN ARCJET_KEY LOG_LEVEL APP_PORT
compose=(docker compose --project-name acquisitions-dev --env-file "$env_file" -f compose.dev.yaml)

if [[ "$action" != test ]]; then
  [[ -f "$env_file" ]] || { printf 'Missing %s. Run this script with init first.\n' "$env_file" >&2; exit 1; }
  "${compose[@]}" config --quiet
fi
docker info >/dev/null

case "$action" in
  up) "${compose[@]}" up -d --build --wait; "${compose[@]}" ps ;;
  build) "${compose[@]}" build app migrate ;;
  down) "${compose[@]}" down ;;
  logs) "${compose[@]}" logs --follow app ;;
  status) "${compose[@]}" ps ;;
  migrate)
    "${compose[@]}" up -d --wait db
    "${compose[@]}" run --rm --build migrate ;;
  test)
    docker build --target test -t acquisitions:test .
    docker run --rm acquisitions:test
    docker run --rm acquisitions:test npm run lint ;;
esac
