# RecallForge

**Tu memoria de estudio, manejada por tu agente de IA.**

RecallForge guarda tus tarjetas de estudio y decide cuándo repasar cada una usando **FSRS**, el algoritmo de repetición espaciada más preciso que existe (el mismo de Anki). La diferencia es que no está pensado para que tú hagas clic en botones: está pensado para que **un agente de IA te pregunte, te corrija y registre cuánto recuerdas**.

Es una herramienta local, como los servidores MCP modernos. **No hay cuentas, contraseñas ni Docker**: tu agente (Claude, Cursor, VS Code, Codex, OpenClaw…) lo arranca solo y tus datos se quedan en tu ordenador. Incluye una web local para revisar tarjetas y ver tu progreso.

> Proyecto Vibecoding.

---

## Índice

- [Por qué](#por-qué)
- [Así se ve una sesión](#así-se-ve-una-sesión)
- [Instalación](#instalación)
- [Conectar tu agente](#conectar-tu-agente)
- [De tus documentos a tarjetas](#de-tus-documentos-a-tarjetas)
- [Organización por materias](#organización-por-materias)
- [Mapa de progreso](#mapa-de-progreso)
- [Preparar un examen](#preparar-un-examen)
- [Qué puede hacer el agente](#qué-puede-hacer-el-agente)
- [La web local](#la-web-local)
- [API REST](#api-rest)
- [Cómo decide qué preguntarte](#cómo-decide-qué-preguntarte)
- [Buenas tarjetas](#buenas-tarjetas)
- [Tus datos y privacidad](#tus-datos-y-privacidad)
- [Desarrollo](#desarrollo)
- [Hoja de ruta](#hoja-de-ruta)

---

## Por qué

El **recuerdo activo** (intentar recordar la respuesta antes de verla) y la **repetición espaciada** (repasar justo antes de olvidar) son las dos técnicas de estudio con más evidencia. El problema es que hacer buenas tarjetas y mantener el hábito cuesta.

Un agente de IA resuelve las dos cosas:

- **Crea las tarjetas por ti** a partir de tus apuntes, un capítulo, una clase o un PDF.
- **Te pregunta como un tutor**: acepta respuestas con otras palabras, te explica lo que fallaste y recuerda tus errores anteriores.

RecallForge pone lo que el agente no tiene: una **memoria persistente**, un **programador de repasos** científico y un **mapa de lo que sabes**.

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

- «Hazme tarjetas de este PDF» (o de este capítulo, estas diapositivas, estos apuntes).
- «¿Cómo voy? Enséñame mi mapa de progreso.»
- «Tengo examen de Microbiología el 20 de octubre: prepárame.»
- «Esa la califiqué mal, deshazla.»
- «Esa tarjeta está mal redactada, corrígela.»

## Instalación

Requisitos: [Node.js](https://nodejs.org) 20 o superior.

```bash
git clone https://github.com/jacmeydev/recallforge.git
cd recallforge
npm install        # también compila el comando recallforge (dist/cli.mjs)
npm run build      # opcional: compila la web local para que arranque rápido
```

Eso es todo: no hay que crear cuentas ni configurar nada. Tus datos se guardan en `~/.recallforge/recallforge.db` (se crea solo la primera vez).

## Conectar tu agente

RecallForge funciona como **servidor MCP por stdio**: tu agente lo arranca cuando lo necesita. Sustituye `/ruta/a/recallforge` por la carpeta donde lo clonaste (la web local te muestra la ruta exacta en *Agentes y ajustes*).

**Claude Code**

```bash
claude mcp add recallforge -- node /ruta/a/recallforge/dist/cli.mjs mcp
```

**Claude Desktop, Cursor, VS Code, Windsurf, Codex y cualquier cliente MCP** (archivo de configuración de servidores MCP):

```json
{
  "mcpServers": {
    "recallforge": {
      "command": "node",
      "args": ["/ruta/a/recallforge/dist/cli.mjs", "mcp"]
    }
  }
}
```

Al conectarse, el agente recibe automáticamente el **protocolo de estudio** (cómo preguntar sin dar pistas, evaluar el significado y calificar) y las **reglas de calidad** para crear tarjetas. También hay dos prompts: `study` (empezar sesión) y `make_cards` (convertir material en tarjetas).

**Agentes sin MCP** (OpenClaw, n8n, scripts): usan la [API REST](#api-rest) con la web local abierta. La skill [`skills/recallforge/SKILL.md`](skills/recallforge/SKILL.md) les enseña el protocolo y las llamadas; funciona con cualquier agente compatible con `SKILL.md`.

**Agentes en la nube** (Claude.ai, ChatGPT): necesitan llegar a tu ordenador por HTTPS. Ver [Acceso remoto](DEPLOYMENT.md): define un token (`RECALLFORGE_TOKEN`) y exponlo con un túnel.

## De tus documentos a tarjetas

Pásale a tu agente cualquier material de estudio: PDF, Word (`.docx`), PowerPoint (`.pptx`), texto, Markdown, HTML o CSV.

1. **Dáselo al agente** (si sabe leer archivos, lo guarda él mismo con `add_document`) o **súbelo** en la web local (*Documentos*).
2. RecallForge lo divide en **partes** (páginas del PDF, diapositivas con sus notas del orador, secciones por título).
3. El agente lo lee parte por parte (`read_document`) y crea tarjetas siguiendo las reglas de calidad. Cada tarjeta queda **enlazada a su página** y la fuente se rellena sola («Guyton cap. 9, p. 112»).
4. Las tarjetas generadas entran como **borradores**. Las revisas en *Por revisar* (o en el chat), corriges lo necesario y las apruebas. Solo entonces empiezan a salir en tus repasos.
5. En la ficha del documento ves qué páginas ya tienen tarjetas y cuáles no.

**Control de calidad automático.** Cada tarjeta nueva se revisa y, si hace falta, se avisa de:
- preguntas de sí/no;
- preguntas que ya contienen la respuesta;
- respuestas que son listas largas;
- preguntas o respuestas demasiado largas.

El agente recibe esos avisos para corregirlos, y tú los ves al revisar.

RecallForge no usa ninguna IA propia ni necesita claves de pago: el trabajo inteligente lo hace **tu** agente, y RecallForge aporta la estructura, la memoria y el control de calidad. Los PDF escaneados sin texto no se pueden extraer; en ese caso el agente puede leerlos con visión y pasar el texto.

## Organización por materias

Las materias son jerárquicas, con `::` como separador, igual que en Anki:

```
Medicina
├── Anatomía
│   └── Miembro superior
└── Farmacología
    ├── Antibióticos
    └── Cardiovascular
```

- Al crear `Medicina::Farmacología::Antibióticos` se crean solas las materias superiores que falten.
- Cada materia muestra sus tarjetas propias y los **totales con todas sus submaterias**.
- Estudiar o buscar en `Medicina::Farmacología` incluye todas sus submaterias.
- Renombrar o mover una materia arrastra sus submaterias; borrarla borra todo el subárbol.
- Las **etiquetas** sirven para temas transversales (`alto-rendimiento`, `parcial-2`, `cardio::arritmias`).

## Mapa de progreso

En la web (*Progreso*) o pidiéndoselo al agente (`get_progress_map`):

- **Árbol de materias con su dominio**: la probabilidad media, según FSRS, de que recuerdes ahora mismo cada tarjeta de esa materia (las que nunca estudiaste cuentan como 0). También cuánto has estudiado ya, cuántas están consolidadas (estabilidad de 21 días o más) y cuántas son débiles.
- **Mapa de calor** de los últimos 6 meses, estilo GitHub, con tu racha de días de estudio.
- **Cobertura de documentos**: qué parte de cada documento ya tiene tarjetas.
- **Preparación de exámenes**: cuánto se prevé que recuerdes el día del examen.

## Preparar un examen

1. Pon la **fecha del examen** en la materia (web: página de la materia; agente: `update_deck` con `exam_date`). Se aplica también a sus submaterias.
2. Estudia en **modo examen** (web: «Repasar para el examen»; agente: `get_next_card` con `mode: "exam"`). Ignora el calendario normal y los límites diarios y te pregunta primero las tarjetas que tienes más riesgo de olvidar **el día del examen**, empezando por las que nunca has visto.
3. El mapa de progreso muestra tu **recuerdo previsto el día del examen** por materia. La sesión termina cuando todas las tarjetas están previstas por encima de tu retención objetivo.

**Deshacer y tarjetas «sanguijuela».** Si calificaste mal, «Deshacer» (tecla Z en la web, `undo_last_review` en el agente) deja la tarjeta exactamente como estaba. Cuando una tarjeta se olvida 4 veces después de haberla aprendido, se marca con la etiqueta `leech` y el agente te propone reescribirla (dividirla, añadir una mnemotecnia o aclarar la pregunta).

## Qué puede hacer el agente

| Herramienta | Qué hace |
|---|---|
| `get_next_card` | Da la siguiente pregunta pendiente, **sin la respuesta**. Filtros: materia, etiqueta, `mode: "exam"`. |
| `reveal_answer` | Da la respuesta, la explicación, la fuente, tus intentos anteriores y cuándo volvería la tarjeta con cada calificación. |
| `grade_card` | Registra cómo recordaste (`again`, `hard`, `good`, `easy`) y tu respuesta; avisa si es una sanguijuela y devuelve la siguiente pregunta. |
| `undo_last_review` | Deshace la última calificación. |
| `get_stats` | Progreso de hoy, pendientes, retención real de 30 días, racha, previsión de 7 días y tarjetas más difíciles. |
| `get_progress_map` | Mapa de dominio por materia, mapa de calor, cobertura de documentos y preparación de exámenes. |
| `add_cards` | Crea hasta 500 tarjetas, opcionalmente como borradores y enlazadas a un documento; devuelve avisos de calidad. |
| `approve_cards` | Aprueba borradores (por id, por documento o por materia). |
| `add_document`, `list_documents`, `read_document`, `delete_document` | Material de estudio: guardarlo, listarlo, leerlo parte por parte con su cobertura, borrarlo. |
| `search_cards` | Busca por texto, materia, etiqueta, documento o estado (`new`, `due`, `leech`, `draft`…). |
| `update_card`, `delete_cards` | Corrige, reetiqueta, mueve, suspende o borra tarjetas. |
| `list_decks`, `update_deck`, `delete_deck` | Árbol de materias; renombrar, mover, poner fecha de examen o borrar. |
| `update_settings` | Nuevas por día, repasos por día, retención objetivo, zona horaria. |

## La web local

```bash
node dist/cli.mjs ui          # http://127.0.0.1:3030
```

*Inicio* (materias y pendientes), *Repasar*, *Documentos*, *Por revisar*, *Progreso* y *Agentes y ajustes*. Solo escucha en tu ordenador (`127.0.0.1`). Otros comandos: `node dist/cli.mjs stats`, `node dist/cli.mjs export [archivo]` y `node dist/cli.mjs path`.

## API REST

Disponible mientras la web local está abierta (`http://127.0.0.1:3030`). En local no necesita credenciales; con `RECALLFORGE_TOKEN` definido, envía `Authorization: Bearer <token>`. `GET /api/v1` devuelve el índice de endpoints.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/v1/study/next?deck=&tag=&mode=` | Siguiente pregunta |
| POST | `/api/v1/study/reveal` | `{ cardId }` → respuesta, explicación, intentos, intervalos |
| POST | `/api/v1/study/grade` | `{ cardId, rating, answer?, feedback?, deck?, tag?, mode? }` → resultado y siguiente pregunta |
| POST | `/api/v1/study/undo` | `{ cardId? }` → deshace la última calificación |
| GET | `/api/v1/stats?deck=&tag=` | Estadísticas |
| GET | `/api/v1/progress?days=` | Mapa de progreso |
| GET, POST | `/api/v1/decks` | Listar o crear materias |
| GET, PATCH, DELETE | `/api/v1/decks/{id o nombre}` | Ver, renombrar/mover/poner `examDate`, borrar |
| GET, POST | `/api/v1/cards` | Buscar (`query, deck, tag, documentId, state, limit, offset`) o crear en lote (`deck?, documentId?, draft?, cards[]`) |
| GET, PATCH, DELETE | `/api/v1/cards/{id}` | Ver, editar o borrar una tarjeta |
| POST | `/api/v1/cards/{id}/reset` | Reiniciar el progreso de una tarjeta |
| POST | `/api/v1/cards/approve` | `{ ids?, documentId?, deck? }` → aprobar borradores |
| GET, POST | `/api/v1/documents` | Listar documentos / subir uno (`multipart` con `file`, `deck?`, `title?`, o JSON `{ title, text, deck? }`) |
| GET, PATCH, DELETE | `/api/v1/documents/{id}` | Índice con cobertura / renombrar / borrar (`?deleteCards=true`) |
| GET | `/api/v1/documents/{id}/read?fromPart=&maxChars=` | Texto de las partes siguientes |
| GET, PATCH | `/api/v1/settings` | Ajustes de estudio |
| GET | `/api/v1/export` | Exportar todo (JSON) |

```bash
URL=http://127.0.0.1:3030
curl -X POST $URL/api/v1/cards -H 'content-type: application/json' \
  -d '{"deck":"Medicina::Farmacología","cards":[{"front":"Antídoto de la heparina","back":"Sulfato de protamina"}]}'
curl $URL/api/v1/study/next
```

Los errores siempre tienen la forma `{ "error": { "code", "message", "details?" } }`.

## Cómo decide qué preguntarte

- **FSRS** calcula para cada tarjeta cuánto la recuerdas (estabilidad) y la programa para cuando tu probabilidad de recordarla baje a la **retención objetivo** (90 % por defecto).
- **Orden de la cola:** primero las tarjetas que estás aprendiendo y ya tocan, luego los repasos del día y después las nuevas.
- **Pasos de aprendizaje** cortos (1 min y 10 min): si fallas una tarjeta, vuelve a salir en la misma sesión.
- **Límites diarios** de nuevas (20) y repasos (200) por **día de estudio** en tu zona horaria; el día empieza a las 4:00 para que estudiar de madrugada cuente como el día anterior.
- **Historial:** cada repaso guarda la calificación, tu respuesta, el comentario del agente y el estado previo de la tarjeta (para deshacer).

## Buenas tarjetas

El agente ya sigue estas reglas, pero sirven también si las haces a mano:

- **Una idea por tarjeta**, con una sola respuesta posible.
- Preguntas que obliguen a recordar («¿por qué…?», «¿qué…?», «¿cuál…?») mejor que preguntas de sí o no.
- **`back`**: la respuesta corta. **`explanation`**: el contexto, la mnemotecnia o la relevancia clínica. **`source`**: libro, capítulo o página.
- **Nada inventado**: cada tarjeta debe estar respaldada por el material.
- Una **materia** jerárquica por asignatura y tema, y **etiquetas** para temas transversales.

## Tus datos y privacidad

- Todo se guarda en **un solo archivo** SQLite: `~/.recallforge/recallforge.db`. Cámbialo con la variable `RECALLFORGE_DB`. La web y los agentes comparten ese archivo.
- No hay cuentas, ni telemetría, ni servicios externos. La web solo escucha en `127.0.0.1`.
- Copia de seguridad: `node dist/cli.mjs export copia.json`, *Exportar JSON* en la web, o copia el archivo `.db`.
- **Si vienes de una versión anterior**, la base se migra sola al arrancar: tus tarjetas pasan al formato pregunta/respuesta sin perder su progreso ni su historial, y las tablas antiguas se conservan como `legacy_*`. Para usar esa base, apunta `RECALLFORGE_DB` a ella.

Variables opcionales:

| Variable | Por defecto | |
|---|---|---|
| `RECALLFORGE_DB` | `~/.recallforge/recallforge.db` | Archivo de datos |
| `RECALLFORGE_TOKEN` | — | Exige este token en la web y la API (solo para acceso remoto) |
| `PORT` | `3030` | Puerto de la web local |
| `BASE_URL` | — | URL pública que se muestra en las instrucciones de conexión |

## Desarrollo

```bash
npm run dev         # web local en modo desarrollo (127.0.0.1:3030)
npm run build:cli   # recompila dist/cli.mjs (MCP por stdio)
npm test            # vitest: núcleo, documentos, progreso, migración, API REST y MCP
npm run typecheck
npm run lint
npm run build
```

```
src/cli.ts        comando recallforge (MCP por stdio, web, stats, export)
src/lib/core/     dominio: esquema, FSRS, materias, tarjetas, documentos, estudio, progreso
src/lib/mcp/      servidor MCP: herramientas y protocolo de estudio
src/lib/api/      acceso (token opcional) y utilidades para las rutas
src/app/api/v1/   API REST
src/app/api/mcp/  MCP por HTTP (para agentes remotos)
src/app/          web local
skills/           skill para agentes
tests/            pruebas
```

Tecnologías: Node.js, TypeScript, SQLite (better-sqlite3), ts-fsrs, MCP TypeScript SDK, Next.js 16, React 19, Tailwind y Vitest.

## Hoja de ruta

- Importar mazos de Anki (`.apkg`) y CSV.
- Imágenes en las tarjetas (anatomía, histología, radiología) y extracción de imágenes de los PDF.
- Optimizar FSRS con tu propio historial (los repasos ya se guardan para ello).
- OCR para PDF escaneados.
- Tarjetas cloze nativas.
- Recordatorios: un agente programado que consulte `get_stats` cada mañana y te avise.
