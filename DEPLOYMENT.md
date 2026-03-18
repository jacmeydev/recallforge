# RecallForge Deployment Guide

## Objetivo actual

Este documento describe el despliegue recomendado para `beta privada`.

Estado validado en esta pasada:
- `docker build` pasa
- contenedor de producción responde `200` en `/api/health`
- Tailscale Serve apunta correctamente a `3030`
- `typecheck`, `lint`, `test`, `build`, `db:rehearse` y `test:e2e` pasan

## Variables mínimas

Usa como base [.env.example](/home/universidad/recallforge/.env.example).

Mínimo recomendado:

```bash
AUTH_SECRET=<secreto-largo>
AUTH_TRUST_HOST=true
DATABASE_PATH=/app/data/recallforge.db
NODE_ENV=production
PORT=3030
BASE_URL=https://tu-dominio-o-tailnet
RATE_LIMIT_AUTH_MAX=20
RATE_LIMIT_API_MAX=120
LOG_LEVEL=info
```

## Despliegue recomendado: Docker

### 1. Construir imagen

```bash
docker build -t recallforge:local .
```

### 2. Levantar contenedor

Si vas a montar la carpeta `data` del host, usa el UID/GID del usuario real para evitar SQLite readonly:

```bash
docker run -d \
  --name recallforge \
  --restart unless-stopped \
  --user "$(id -u):$(id -g)" \
  -p 3030:3030 \
  -v "$(pwd)/data:/app/data" \
  -e DATABASE_PATH=/app/data/recallforge.db \
  -e AUTH_SECRET="cambia-esto" \
  -e AUTH_TRUST_HOST=true \
  -e PORT=3030 \
  -e NODE_ENV=production \
  recallforge:local
```

### 3. Verificar health

```bash
curl http://127.0.0.1:3030/api/health
```

Debe responder algo como:

```json
{
  "status": "ok",
  "service": "recallforge",
  "schema": {
    "pendingCount": 0,
    "replayBacklog": 0
  }
}
```

## HTTPS

### Opción rápida privada: Tailscale Serve

```bash
tailscale serve --bg 3030
tailscale serve status
```

La URL quedará algo como:

```text
https://<host>.ts.net
```

Esto ya fue validado para RecallForge.

### Opción pública

Usa reverse proxy con TLS real:
- Caddy
- nginx
- Cloudflare Tunnel
- Tailscale Funnel si aplica a tu caso

## Pruebas de publicación

Antes de publicar una nueva build, corre:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run db:rehearse
npm run test:e2e
docker build -t recallforge:local .
```

Notas:
- `phase3-http.test.ts` ya no necesita un server manual; levanta un Next gestionado con DB temporal.
- `test:e2e` corre Playwright dentro de Docker y valida login, settings, study, Copilot/OpenClaw y optimizer.

## Backup, rehearsal y rollback

RecallForge ya tiene rehearsal de migraciones:

```bash
npm run db:rehearse
```

Rollback operacional:
- el mecanismo principal sigue siendo restaurar un backup SQLite previo
- no confíes en “down migrations” como única red de seguridad

Respaldos esperados:
- `data/backups/*.db`

## Observabilidad mínima disponible

`/api/health` expone:
- estado del servicio
- estado de DB
- versión de schema
- migraciones pendientes
- replay backlog
- snapshot de observabilidad en memoria

La pantalla [settings/page.tsx](/home/universidad/recallforge/src/app/(app)/settings/page.tsx) ya muestra señales rápidas de salud.

## Integración agent/OpenClaw

En producción privada ya están listas estas rutas:

- `/api/agent/*`
- `/api/copilot/*`
- `/api/openclaw/drafts`
- `/api/openclaw/review-candidates`
- `/api/openclaw/improvement-drafts`

No se recomienda que agentes escriban directo a DB o Dexie.
La integración correcta es HTTP autenticado.

## Riesgos aceptados para beta privada

No bloquean el deploy actual, pero siguen abiertos:
- falta soak largo multi-dispositivo
- la calidad académica depende de buenos `curriculum_links`
- la observabilidad es útil, pero todavía no equivale a APM/alerting completo

## Veredicto

RecallForge queda `lista para beta privada` con despliegue controlado por Docker + HTTPS.
