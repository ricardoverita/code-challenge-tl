#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DOCKER_IMAGE="${DOCKER_TEST_IMAGE:-node:20-alpine}"

log() {
  printf '[test-docker] %s\n' "$*"
}

error() {
  printf '[test-docker][error] %s\n' "$*" >&2
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    error "docker no está disponible en PATH."
    exit 1
  fi
}

main() {
  require_docker

  log "Running tests inside Docker image: ${DOCKER_IMAGE}"
  docker run --rm -t \
    -v "${ROOT_DIR}:/app" \
    -w /app \
    "${DOCKER_IMAGE}" \
    sh -lc "npm ci && npm test"
}

main "$@"
