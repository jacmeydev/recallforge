# RecallForge — FSRS Library Decisions

> Documento requerido por la Regla F: documentar cada librería elegida con justificación.

---

## Librería Principal: ts-fsrs v5.2.3

| Campo          | Valor                                              |
|----------------|----------------------------------------------------|
| **Rol**        | Scheduler (programador de repasos)                 |
| **Licencia**   | MIT                                                |
| **Tamaño**     | ~150 KB (npm)                                      |
| **Algoritmo**  | FSRS-6.0 (21 parámetros W)                        |
| **Plataforma** | Node.js + Browser (JavaScript puro)                |

### ¿Por qué ts-fsrs?
- Implementación de referencia de FSRS en TypeScript.
- Mantiene paridad con el algoritmo oficial de FSRS-6.0.
- Expone scheduling completo: `fsrs()`, `repeat()`, `rollback()`, `forget()`.
- **No incluye optimizador** — solo calcula la próxima revisión dados los parámetros W.
- Compatible con nuestra arquitectura (Next.js, browser-first, local-first).

### ¿Qué no hace?
- No entrena parámetros personalizados desde el historial del usuario.
- No calcula retención óptima.
- `generatorParameters()` solo crea arrays con valores por defecto.

---

## Librería de Optimización: fsrs-browser v5.2.0

| Campo          | Valor                                              |
|----------------|----------------------------------------------------|
| **Rol**        | Optimizer (entrenamiento de parámetros W)           |
| **Licencia**   | BSD-3-Clause                                       |
| **Tamaño**     | ~1.73 MB (incluye WASM binary de 1.68 MB)          |
| **Motor**      | fsrs-rs compilado a WebAssembly                    |
| **Plataforma** | Browser only (requiere WASM + SharedArrayBuffer)   |

### ¿Por qué fsrs-browser?
1. **Es el optimizador oficial del ecosistema FSRS** — puerto WASM de `fsrs-rs`, el mismo motor que usa Anki.
2. **Funciona 100% en el navegador** — sin servidor backend. Compatible con nuestra arquitectura local-first (Dexie + IndexedDB).
3. **API directa**: `computeParameters(ratings, delta_ts, lengths, progress, enable_short_term)` → `Float32Array` de parámetros optimizados.
4. **No hay alternativa viable para browser**:
   - `@open-spaced-repetition/binding` → Solo Node.js (no funciona en el browser).
   - `py-fsrs` / `fsrs-rs` CLI → Requieren servidor externo.
   - Implementación manual → Viola la regla de reutilización del ecosistema.

### Requisitos técnicos
- **SharedArrayBuffer**: El WASM está compilado con `+atomics` (para multithreading vía `wasm-bindgen-rayon`). Esto requiere headers de Cross-Origin Isolation:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
- **Verificación**: RecallForge no carga recursos cross-origin (sin Google Fonts, CDNs, scripts externos). Los headers se pueden aplicar globalmente sin romper nada.
- **Webpack**: Requiere `asyncWebAssembly: true` experiment para carga de `.wasm`.

### Formato de datos
```
ratings:  Uint32Array — [1=Again, 2=Hard, 3=Good, 4=Easy] aplanados
delta_ts: Uint32Array — días desde la revisión anterior (0 para la primera)
lengths:  Uint32Array — número de revisiones por item de entrenamiento
```
Los FSRSItems se generan como ventanas acumulativas: una tarjeta con N revisiones produce N-1 items de entrenamiento.

---

## Alternativas Evaluadas y Descartadas

### @open-spaced-repetition/binding
- **Descartada porque**: Solo funciona en Node.js (usa bindings nativos N-API). RecallForge es browser-first.

### Implementación manual del optimizador
- **Descartada porque**: Viola la Regla B ("implementar la optimización usando una opción seria del ecosistema FSRS") y requeriría reimplementar el algoritmo de entrenamiento BFGS/L-BFGS que fsrs-rs ya implementa de forma optimizada.

### Servicio externo (py-fsrs / API)
- **Descartada porque**: Añade dependencia de servidor. La arquitectura de RecallForge es 100% client-side por diseño.

---

## Arquitectura Final

```
┌─────────────────────────────────────────────────┐
│              RecallForge (Browser)               │
│                                                  │
│  ┌──────────────┐     ┌───────────────────────┐ │
│  │   ts-fsrs     │     │    fsrs-browser        │ │
│  │  (Scheduler)  │     │    (Optimizer)          │ │
│  │               │     │                         │ │
│  │  scheduleRev  │     │  computeParameters()    │ │
│  │  repeat()     │     │  Float32Array → W[21]   │ │
│  │  rollback()   │     │                         │ │
│  │  forget()     │     │  fsrs-rs (WASM)         │ │
│  └──────┬───────┘     └───────────┬─────────────┘ │
│         │                         │               │
│         │    ┌────────────┐       │               │
│         └───►│   Dexie    │◄──────┘               │
│              │ (IndexedDB)│                       │
│              │            │                       │
│              │ reviewLogs │ ← datos de entrada    │
│              │ presets    │ ← parámetros W        │
│              │ optRuns    │ ← historial           │
│              └────────────┘                       │
└─────────────────────────────────────────────────┘
```

---

*Fecha: Junio 2025*
*Versiones: ts-fsrs 5.2.3, fsrs-browser 5.2.0*
