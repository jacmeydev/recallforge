# RecallForge

RecallForge es una app de estudio tipo Anki, local-first y adaptable a cualquier dominio de aprendizaje.

Hoy ya incluye:
- FSRS real para scheduling diario
- Dexie/IndexedDB en cliente + SQLite en servidor
- sync idempotente con replay determinista de `review_logs`
- estudio por mazos y por metadata curricular
- importación IA, drafts con revisión humana y receiver para OpenClaw
- Copilot, análisis de cobertura/riesgo, image occlusion y optimizador FSRS

## Estado actual

- lista para `beta privada`
- `typecheck`, `lint`, `test`, `build`, `db:rehearse` y `test:e2e` pasan
- despliegue validado tanto en modo Node.js como con Docker
- HTTPS tailnet validado con Tailscale Serve

## Stack real

| Capa | Tecnología |
|---|---|
| Web | Next.js 16 + App Router |
| UI | React 19 + Tailwind |
| Lenguaje | TypeScript |
| Local-first | Dexie + IndexedDB |
| Servidor | SQLite + better-sqlite3 + Drizzle |
| Auth | Auth.js v5 credentials |
| Scheduling | `ts-fsrs` |
| Optimizer | `fsrs-browser` |
| Estado cliente | Zustand |
| Validación | Zod |
| Tests | Vitest + Playwright |

## Scripts útiles

```bash
npm run dev
npm run build
npm run start
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run db:rehearse
```

App local:
- desarrollo: `http://localhost:3030`
- producción local: `http://localhost:3030`

## Levantar en desarrollo

```bash
npm install
cp .env.example .env.local
npm run dev
```

Variables mínimas:
- `AUTH_SECRET`
- `AUTH_TRUST_HOST=true`
- `DATABASE_PATH=data/recallforge.db`

## Integración con agentes

RecallForge ya expone rutas listas para agentes:

- Agent:
  - `/api/agent/recommendations`
  - `/api/agent/study-plan`
  - `/api/agent/academic-summary`
  - `/api/agent/coverage`
  - `/api/agent/scopes`
  - `/api/agent/import`
  - `/api/agent/import/preview`
  - `/api/agent/review-status`
  - `/api/agent/events`
- Copilot:
  - `/api/copilot/brief`
  - `/api/copilot/actions`
  - `/api/copilot/drafts`
  - `/api/copilot/drafts/review`
  - `/api/copilot/outcomes`
  - `/api/copilot/history`
- OpenClaw receiver:
  - `/api/openclaw/drafts`
  - `/api/openclaw/review-candidates`
  - `/api/openclaw/improvement-drafts`

## OpenClaw / UniBot

Flujos ya soportados:
- recibir drafts generados desde imágenes o capítulos
- dejar esos drafts en Copilot para revisión humana
- aprobarlos e importarlos a la colección final
- leer coverage, risk, scopes, academic summary y study plan
- proponer mejoras sobre tarjetas ya existentes

Documentos recomendados:
- [INTEGRATION_READINESS_RECALLFORGE.md](/home/universidad/recallforge/INTEGRATION_READINESS_RECALLFORGE.md)
- [AUDIT_RECALLFORGE.md](/home/universidad/recallforge/AUDIT_RECALLFORGE.md)
- [BUG_BACKLOG_RECALLFORGE.md](/home/universidad/recallforge/BUG_BACKLOG_RECALLFORGE.md)

## Validación de publicación

Gate actual de beta privada:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run db:rehearse
npm run test:e2e
curl http://127.0.0.1:3030/api/health
```

Opcional si eliges contenedor:

```bash
docker build -t recallforge:local .
```

## Producción rápida con Docker

```bash
docker build -t recallforge:local .

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

Health check:

```bash
curl http://127.0.0.1:3030/api/health
```

## Estado de madurez

RecallForge ya no está en fase de “prototipo”.
La situación real es:

- `sí` está lista para beta privada
- `sí` está lista para integrarse de forma controlada con UniBot/OpenClaw
- `no` está cerrada como producto final absoluto

Riesgos aceptados post-beta:
- la calidad de recomendaciones depende de buenos `curriculum_links`
- falta soak largo multi-dispositivo
- la observabilidad es útil, pero todavía mínima
