# RecallForge

**Tu memoria de estudio, manejada por tu agente de IA.**

RecallForge guarda tus tarjetas de estudio y decide cuándo repasar cada una usando **FSRS**, el algoritmo de repetición espaciada más preciso que existe (el mismo de Anki). La diferencia es que no está pensado para que tú hagas clic en botones: está pensado para que **un agente de IA te pregunte, te corrija y registre cuánto recuerdas**.

Funciona con cualquier agente: Claude, ChatGPT, Cursor, VS Code, OpenClaw o un script propio. Se conecta por **MCP** o por **API REST**, y además trae una web sencilla para estudiar sin agente.

> Proyecto Vibecoding.

---

## Índice

- [Por qué](#por-qué)
- [Así se ve una sesión](#así-se-ve-una-sesión)
- [Instalación](#instalación)
- [Conectar tu agente](#conectar-tu-agente)
- [Qué puede hacer el agente](#qué-puede-hacer-el-agente)
- [API REST](#api-rest)
- [Cómo decide qué preguntarte](#cómo-decide-qué-preguntarte)
- [Buenas tarjetas](#buenas-tarjetas)
- [Configuración](#configuración)
- [Despliegue y copias de seguridad](#despliegue-y-copias-de-seguridad)
- [Desarrollo](#desarrollo)
- [Hoja de ruta](#hoja-de-ruta)

---

## Por qué

El **recuerdo activo** (intentar recordar la respuesta antes de verla) y la **repetición espaciada** (repasar justo antes de olvidar) son las dos técnicas de estudio con más evidencia. El problema es que hacer buenas tarjetas y mantener el hábito cuesta.

Un agente de IA resuelve las dos cosas:

- **Crea las tarjetas por ti** a partir de tus apuntes, un capítulo, una clase o un PDF.
- **Te pregunta como un tutor**: acepta respuestas con otras palabras, te explica lo que fallaste y recuerda tus errores anteriores.

RecallForge pone la parte que el agente no tiene: una **memoria persistente** y un **programador de repasos** científico.

## Así se ve una sesión

```
Tú:      Pregúntame lo pendiente de Farmacología.

Agente:  Tienes 12 tarjetas para hoy. Primera:
         ¿Cuál es el antídoto de la intoxicación por paracetamol?

Tú:      El flumazenil.

Agente:  No. El flumazenil revierte las benzodiacepinas. El antídoto del
         paracetamol es la N-acetilcisteína, que repone el glutatión.
         Volverá a salir en un minuto.
         Siguiente: ¿qué antídoto se usa en la sobredosis de opioides?

Tú:      Naloxona.

Agente:  ¡Correcto! La verás de nuevo en unos días.
```

Detrás, el agente llamó a `get_next_card`, `reveal_answer` y `grade_card`. RecallForge guardó tu respuesta («flumazenil») para que la próxima vez el agente pueda decirte que ya lo confundiste antes.

También puedes pedirle:

- «Hazme tarjetas de este capítulo» (y pegas el texto).
- «¿Cómo voy en Cardiología? ¿Qué me cuesta más?»
- «Mañana tengo examen de Micro: súbeme a 60 tarjetas nuevas hoy.»
- «Esa tarjeta está mal redactada, corrígela.»

## Instalación

Requisitos: Node.js 20 o superior.

```bash
git clone https://github.com/jacmeydev/recallforge.git
cd recallforge
npm install
cp .env.example .env.local
# edita .env.local y pon AUTH_SECRET (genera uno con: openssl rand -base64 32)
npm run dev
```

1. Abre <http://localhost:3030> y crea tu cuenta. Es la única que se puede registrar: después el registro se cierra (ver `ALLOW_REGISTRATION`).
2. **Guarda la clave de API** que aparece (`rf_…`). Solo se muestra una vez; si la pierdes, genera otra en *Cuenta y agentes*.
3. En **Cuenta y agentes** tienes la configuración de cada cliente lista para copiar.

Para producción o Docker, ver [DEPLOYMENT.md](DEPLOYMENT.md).

## Conectar tu agente

La dirección MCP es `https://TU-SERVIDOR/api/mcp` y la autenticación es `Authorization: Bearer rf_TU_CLAVE`. En local, usa `http://localhost:3030`.

### Claude Code

```bash
claude mcp add --transport http recallforge http://localhost:3030/api/mcp \
  --header "Authorization: Bearer rf_TU_CLAVE"
```

### Cursor, VS Code, Windsurf y otros clientes con MCP remoto

```json
{
  "mcpServers": {
    "recallforge": {
      "url": "http://localhost:3030/api/mcp",
      "headers": { "Authorization": "Bearer rf_TU_CLAVE" }
    }
  }
}
```

### Claude Desktop y clientes que solo usan stdio

Usa el puente [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "recallforge": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3030/api/mcp", "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer rf_TU_CLAVE" }
    }
  }
}
```

### Claude.ai o ChatGPT (conectores personalizados)

Estos conectores no dejan añadir cabeceras, así que la clave va en la URL:

```
https://TU-SERVIDOR/api/mcp?key=rf_TU_CLAVE
```

Necesitan una URL **HTTPS pública**. Consulta [DEPLOYMENT.md](DEPLOYMENT.md) para exponerla con Tailscale Funnel o Cloudflare Tunnel. Si compartes esa URL por error, genera una clave nueva.

### OpenClaw, n8n, scripts y agentes sin MCP

Usa la [API REST](#api-rest). La skill [`skills/recallforge/SKILL.md`](skills/recallforge/SKILL.md) enseña a cualquier agente compatible con `SKILL.md` (OpenClaw, Claude Code…) el protocolo de estudio y las llamadas con `curl`.

## Qué puede hacer el agente

Al conectarse por MCP, el agente recibe automáticamente las **instrucciones del protocolo de estudio**: preguntar sin dar pistas, esperar tu intento, evaluar el significado y no las palabras exactas, y cómo calificar.

| Herramienta | Qué hace |
|---|---|
| `get_next_card` | Da la siguiente pregunta pendiente, **sin la respuesta**. Se puede filtrar por mazo o etiqueta. |
| `reveal_answer` | Da la respuesta, la explicación, la fuente, tus intentos anteriores y cuándo volvería la tarjeta con cada calificación. |
| `grade_card` | Registra cómo recordaste (`again`, `hard`, `good`, `easy`) junto con tu respuesta, y devuelve la siguiente pregunta. |
| `get_stats` | Progreso de hoy, pendientes, retención real de 30 días, racha, previsión de 7 días y tus tarjetas más difíciles. |
| `add_cards` | Crea hasta 500 tarjetas de una vez. Crea los mazos que falten y se salta los duplicados. |
| `search_cards` | Busca por texto, mazo, etiqueta o estado (`new`, `due`, `leech`…). |
| `update_card` | Corrige, reetiqueta, mueve o suspende una tarjeta sin perder su progreso. |
| `delete_cards` | Borra tarjetas. |
| `list_decks`, `update_deck`, `delete_deck` | Gestión de mazos. |
| `update_settings` | Cambia nuevas por día, repasos por día, retención objetivo o zona horaria. |

También incluye dos *prompts*, que en muchos clientes aparecen como comandos: `study` (empezar una sesión) y `make_cards` (convertir material en tarjetas).

## API REST

Todas las rutas usan `Authorization: Bearer rf_…`; también se acepta la cabecera `X-API-Key` o el parámetro `?key=`. `GET /api/v1` devuelve el índice de endpoints sin necesidad de autenticarse.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/v1/study/next?deck=&tag=` | Siguiente pregunta |
| POST | `/api/v1/study/reveal` | `{ cardId }` → respuesta, explicación, intentos e intervalos |
| POST | `/api/v1/study/grade` | `{ cardId, rating, answer?, feedback?, deck?, tag? }` → resultado y siguiente pregunta |
| GET | `/api/v1/stats?deck=&tag=` | Estadísticas |
| GET, POST | `/api/v1/decks` | Listar o crear mazos |
| GET, PATCH, DELETE | `/api/v1/decks/{id o nombre}` | Ver, renombrar o borrar un mazo |
| GET, POST | `/api/v1/cards` | Buscar (`query, deck, tag, state, limit, offset`) o crear en lote |
| GET, PATCH, DELETE | `/api/v1/cards/{id}` | Ver, editar o borrar una tarjeta |
| POST | `/api/v1/cards/{id}/reset` | Reiniciar el progreso de una tarjeta |
| GET, PATCH | `/api/v1/settings` | Ajustes de estudio |
| GET | `/api/v1/export` | Exportar todos tus datos en JSON |

Ejemplo:

```bash
KEY=rf_TU_CLAVE
URL=http://localhost:3030

# crear tarjetas
curl -X POST $URL/api/v1/cards \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"deck":"Farmacología","cards":[{"front":"Antídoto de la heparina","back":"Sulfato de protamina","tags":["hemato"]}]}'

# siguiente pregunta
curl $URL/api/v1/study/next -H "Authorization: Bearer $KEY"
```

Los errores siempre tienen la forma `{ "error": { "code", "message", "details?" } }`, con un código HTTP 4xx.

## Cómo decide qué preguntarte

- **FSRS** calcula para cada tarjeta cuánto la recuerdas (estabilidad) y la programa para cuando tu probabilidad de recordarla baje a la **retención objetivo** (90 % por defecto).
- **Orden de la cola:** primero las tarjetas que estás aprendiendo y ya tocan, luego los repasos del día y después las nuevas.
- **Pasos de aprendizaje** cortos (1 min y 10 min): si fallas una tarjeta, vuelve a salir en la misma sesión.
- **Límites diarios** de tarjetas nuevas (20) y repasos (200). Se cuentan por **día de estudio** en tu zona horaria, y el día empieza a las 4:00 para que estudiar de madrugada cuente como el día anterior.
- **Historial:** cada repaso guarda la calificación, tu respuesta y el comentario del agente. Con eso se calculan la retención real y las tarjetas difíciles, y en el futuro servirá para optimizar FSRS con tus datos.

## Buenas tarjetas

El agente ya sigue estas reglas, pero sirven también si las haces a mano:

- **Una idea por tarjeta**, con una sola respuesta posible.
- Preguntas que obliguen a recordar («¿por qué…?», «¿qué…?», «¿cuál…?») mejor que preguntas de sí o no.
- **`back`**: la respuesta corta. **`explanation`**: el contexto, la mnemotecnia o la relevancia clínica. **`source`**: libro, capítulo o página.
- **Un mazo por materia** (Farmacología, Anatomía…) y **etiquetas** para los temas. Las etiquetas pueden ser jerárquicas: `cardio::arritmias` aparece al filtrar por `cardio`.

## Configuración

Variables de entorno (ver [.env.example](.env.example)):

| Variable | Por defecto | Descripción |
|---|---|---|
| `AUTH_SECRET` | *(obligatoria)* | Secreto para las sesiones web |
| `AUTH_TRUST_HOST` | `true` | Necesario detrás de un proxy |
| `DATABASE_PATH` | `data/recallforge.db` | Archivo SQLite |
| `PORT` | `3030` | Puerto |
| `BASE_URL` | — | URL pública que se muestra en las instrucciones de conexión |
| `RATE_LIMIT_API_MAX` | `120` | Peticiones por minuto e IP a `/api/v1` y `/api/mcp` |
| `ALLOW_REGISTRATION` | `false` | Por privacidad, solo se puede registrar la primera cuenta. Ponlo en `true` para permitir más usuarios. |

Cada usuario tiene sus propios ajustes de estudio: retención objetivo, nuevas y repasos por día, intervalo máximo, pasos de aprendizaje, hora de inicio del día y zona horaria. Se cambian desde la web (*Cuenta y agentes*), con `PATCH /api/v1/settings` o pidiéndoselo al agente.

## Despliegue y copias de seguridad

Es un solo proceso Node.js con una base SQLite: solo hay que guardar la carpeta `data/`. En [DEPLOYMENT.md](DEPLOYMENT.md) están Node.js, Docker, cómo exponerlo por HTTPS para agentes en la nube y cómo hacer copias de seguridad.

**Si vienes de la versión 1:** la base de datos se migra sola al arrancar. Tus tarjetas pasan al formato pregunta/respuesta sin perder su progreso ni su historial, y las tablas antiguas se conservan como `legacy_*`. Las tarjetas de *image occlusion* no se migran. Haz una copia de `data/` antes de actualizar.

## Desarrollo

```bash
npm run dev         # servidor de desarrollo en :3030
npm test            # pruebas: núcleo, migración, API REST y MCP
npm run typecheck
npm run lint
npm run build
```

```
src/lib/core/     dominio: esquema, migraciones, FSRS, mazos, tarjetas, estudio, estadísticas
src/lib/mcp/      servidor MCP: herramientas y protocolo de estudio
src/lib/api/      autenticación y utilidades para las rutas
src/app/api/v1/   API REST
src/app/api/mcp/  endpoint MCP
src/app/          web: inicio, mazo, repaso, cuenta, login
skills/           skill para agentes
tests/            pruebas
```

Tecnologías: Next.js 16, React 19, TypeScript, SQLite (better-sqlite3), ts-fsrs, MCP TypeScript SDK, Auth.js, Tailwind y Vitest.

## Hoja de ruta

- Importar mazos de Anki (`.apkg`) y CSV.
- Imágenes en las tarjetas (anatomía, histología, radiología).
- Optimizar FSRS con tu propio historial.
- Tarjetas cloze nativas.
- OAuth para conectores MCP que lo exigen.
- Recordatorios: un agente programado que consulte `get_stats` cada mañana y te avise.
