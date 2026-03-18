#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="mcr.microsoft.com/playwright:v1.58.2-noble"

docker run --rm \
  --ipc=host \
  --user "$(id -u):$(id -g)" \
  -e CI=1 \
  -e HOME=/tmp \
  -v "${ROOT}:/work" \
  -w /work \
  "${IMAGE}" \
  bash -lc "npm run test:e2e:local"
