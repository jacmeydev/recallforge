#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HTTPS_DIR="$ROOT/data/https"
NGINX_CONF="$ROOT/docker/local-https/nginx.conf"

CA_KEY="$HTTPS_DIR/recallforge-local-ca.key"
CA_CERT="$HTTPS_DIR/recallforge-local-ca.crt"
CA_SERIAL="$HTTPS_DIR/recallforge-local-ca.srl"
SERVER_KEY="$HTTPS_DIR/recallforge-local.key"
SERVER_CSR="$HTTPS_DIR/recallforge-local.csr"
SERVER_CERT="$HTTPS_DIR/recallforge-local.crt"
SERVER_EXT="$HTTPS_DIR/recallforge-local.ext"

mkdir -p "$HTTPS_DIR"
chmod 700 "$HTTPS_DIR"

if [[ ! -f "$CA_KEY" || ! -f "$CA_CERT" ]]; then
  openssl genrsa -out "$CA_KEY" 4096 >/dev/null 2>&1
  openssl req -x509 -new -nodes -key "$CA_KEY" -sha256 -days 3650 \
    -out "$CA_CERT" \
    -subj "/CN=RecallForge Local Dev CA" >/dev/null 2>&1
fi

HOSTNAME_SHORT="$(hostname)"
read -ra RAW_IPS <<<"$(hostname -I)"

{
  echo "authorityKeyIdentifier=keyid,issuer"
  echo "basicConstraints=CA:FALSE"
  echo "keyUsage=digitalSignature,keyEncipherment"
  echo "extendedKeyUsage=serverAuth"
  echo "[v3_req]"
  echo "subjectAltName=@alt_names"
  echo
  echo "[alt_names]"

  dns_index=1
  for dns_name in "localhost" "$HOSTNAME_SHORT" "host.docker.internal"; do
    echo "DNS.${dns_index}=${dns_name}"
    dns_index=$((dns_index + 1))
  done

  ip_index=1
  for ip in "127.0.0.1" "::1"; do
    echo "IP.${ip_index}=${ip}"
    ip_index=$((ip_index + 1))
  done

  for ip in "${RAW_IPS[@]}"; do
    if [[ -n "$ip" ]]; then
      echo "IP.${ip_index}=${ip}"
      ip_index=$((ip_index + 1))
    fi
  done
} >"$SERVER_EXT"

openssl genrsa -out "$SERVER_KEY" 2048 >/dev/null 2>&1
openssl req -new -key "$SERVER_KEY" -out "$SERVER_CSR" -subj "/CN=localhost" >/dev/null 2>&1
openssl x509 -req -in "$SERVER_CSR" \
  -CA "$CA_CERT" \
  -CAkey "$CA_KEY" \
  -CAcreateserial \
  -CAserial "$CA_SERIAL" \
  -out "$SERVER_CERT" \
  -days 825 \
  -sha256 \
  -extensions v3_req \
  -extfile "$SERVER_EXT" >/dev/null 2>&1

chmod 600 "$CA_KEY" "$SERVER_KEY"
chmod 644 "$CA_CERT" "$SERVER_CERT"
rm -f "$SERVER_CSR"

docker rm -f recallforge-https >/dev/null 2>&1 || true
docker run -d \
  --name recallforge-https \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p 443:443 \
  -v "$NGINX_CONF:/etc/nginx/conf.d/default.conf:ro" \
  -v "$SERVER_CERT:/etc/nginx/certs/server.crt:ro" \
  -v "$SERVER_KEY:/etc/nginx/certs/server.key:ro" \
  nginx:1.27-alpine >/dev/null

echo "HTTPS proxy listo en https://localhost y https://$(hostname -I | awk '{print $1}')"
echo "CA local: $CA_CERT"
echo "Para iPad/Safari debes instalar y confiar esta CA."
