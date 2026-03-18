#!/usr/bin/env bash
set -euo pipefail

docker rm -f recallforge-https >/dev/null 2>&1 || true
echo "HTTPS proxy detenido."
