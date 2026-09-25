# Despliegue de RecallForge

RecallForge es un único proceso Node.js con una base SQLite. Solo necesitas persistir la carpeta `data/`.

## Variables

```bash
AUTH_SECRET=<openssl rand -base64 32>
AUTH_TRUST_HOST=true
DATABASE_PATH=/app/data/recallforge.db
PORT=3030
NODE_ENV=production
BASE_URL=https://tu-dominio        # opcional: URL pública que verán tus agentes
ALLOW_REGISTRATION=false           # solo la primera cuenta puede registrarse
```

## Opción A: Node.js

```bash
npm ci
npm run build
npm run start          # usa systemd, pm2 o similar en producción
curl http://127.0.0.1:3030/api/health
```

## Opción B: Docker

```bash
docker build -t recallforge .
docker run -d --name recallforge --restart unless-stopped \
  --user "$(id -u):$(id -g)" \
  -p 3030:3030 \
  -v "$(pwd)/data:/app/data" \
  -e AUTH_SECRET="cambia-esto" \
  -e AUTH_TRUST_HOST=true \
  -e DATABASE_PATH=/app/data/recallforge.db \
  recallforge
```

Usa `--user` con tu UID/GID si montas una carpeta del host, para que SQLite pueda escribir.

## Acceso desde agentes remotos

Los agentes en la nube (Claude.ai, ChatGPT) necesitan una URL **HTTPS pública**. Opciones sencillas:

- **Tailscale Funnel**: `tailscale funnel 3030` (o `tailscale serve 3030` si el agente también está en tu tailnet).
- **Cloudflare Tunnel**: `cloudflared tunnel --url http://localhost:3030`.
- Un proxy inverso (Caddy, nginx) con certificado.

Los agentes locales (Claude Code, Cursor, OpenClaw en la misma máquina) pueden usar `http://localhost:3030`.

## Copias de seguridad

- Exporta desde la web (Cuenta → Exportar JSON) o `GET /api/v1/export`.
- O copia la base con SQLite en caliente: `sqlite3 data/recallforge.db ".backup data/backup.db"`.

## Actualizar desde la versión 1

Haz una copia de `data/recallforge.db` y arranca la nueva versión: la migración convierte tus tarjetas al formato pregunta/respuesta (manteniendo estado FSRS e historial) y renombra las tablas antiguas a `legacy_*`, que puedes borrar cuando compruebes que todo está bien.
