# ¿Qué ceno? — Notas y propuesta de cambios a CLAUDE.md

Nada de esto está aplicado a `CLAUDE.md`: es una propuesta para que Victor la revise (ronda 1, 20-10-2026).

## 1. Regla 6 (qué viaja a internet), nueva redacción propuesta

Decisión de Victor (20-10-2026): a Gemini viajan también los **nombres** de los nutrientes con déficit, solo para «Más ideas». Redacción propuesta (la regla actual más lo nuevo):

> 6. **Qué viaja a internet.** A Gemini, solo mi frase (o el fragmento que estimo) y la lista compacta del catálogo (id, nombre, alias, porciones, estado, grupo, defecto y `peso_en_crudo` cuando está marcado); en «¿Qué ceno?» → «Más ideas», además, **los nombres (la etiqueta, sin cantidades, porcentajes ni cifras) de los nutrientes con déficit del día, como mucho 8**, y la lista compacta sin los alimentos sin datos. A USDA, solo términos de búsqueda y fdcId. Nunca nutrientes por alimento, densidad, cantidades consumidas, objetivos, fechas ni el diario.

Cómo lo cumple el código: `core/cenas.js` (`deficitsParaIA`, `nombreParaIA`: las etiquetas con número, como «Vitamina B12», se sustituyen por su nombre propio, «Cobalamina»), `core/cenas-validate.js` (`checkDeficits`: lista de ≤ 8 cadenas de ≤ 40 caracteres, sin dígitos) y el Worker (rechaza con 400 `deficits_invalidos` y no llama a Gemini; descarta cualquier otro campo del cuerpo).

## 2. «¿Qué ceno?» en CLAUDE.md

**Sección 3 (Arquitectura)**, nueva viñeta:

> - **¿Qué ceno?** (rama `cenas`; `core/cenas.js`, `core/cenas-validate.js`, `ui/cenas-screen.js`, `css/cenas.css`, `data/cenas-semilla.json`; especificación en `docs/cenas/ESPEC.md`): para el día que muestra el Diario, compara lo registrado con `targetsForDate` y propone 3 cenas de mis cenas habituales (historial de 60 días, plantillas de cena, recetas y, con menos de 21 días con cena, la semilla de Cronometer) con los gramos ajustados; sin UL superado, sin alimentos `incluir=no` ni sin datos. Todo lo calcula el código (`sumLines`) y funciona sin internet. Entradas: botón «¿Qué ceno?» en la tarjeta de Cena del Diario y entrada en los tres puntos. «Añadir a la cena» abre la confirmación editable (regla 5). «Más ideas» (`POST /cenas` del Worker, `ideasCena` en `ai-client.js`, prompt en `worker/src/prompt.js`) es la única llamada a la IA: una por pulsación; la IA solo propone ids y gramos, el código valida y calcula.

**Sección 5 (Estado)**, nueva viñeta:

> - **Rama `cenas`** (sin integrar ni publicar): «¿Qué ceno?» (sección 3). `POST /cenas` sin desplegar (`npm run worker:deploy` cuando la pruebe). Pendientes en `docs/cenas/notas.md`.

**Sección 3, `data/`:** añadir `cenas-semilla.json` (cenas de Cronometer de 17 a 24 sep con los ids actuales y el rol de cada alimento en una cena).

**Sección 3, regla 10 / Worker:** la ruta `POST /cenas` usa la misma política de reintentos y respaldo que `/parse` y `/estimate` (una llamada por pulsación de «Más ideas»).

**Service worker:** `nt-v14` (añade `cenas.css`, `cenas.js`, `cenas-validate.js`, `cenas-screen.js` y `data/cenas-semilla.json`).

## 3. Decisiones tomadas al implementar

- Semilla: 6 cenas (17, 19, 21, 22, 23 y 24 sep; la del 18 es una salida). `pan_integral` -> `pan_blanco_barra`. Supuestos marcados con `"supuesto": true`: pan de molde 3 × 25 g = 75 g y queso tierno 1 loncha = 20 g. `tortilla_patata` con `gramos: null`. Los alimentos con `incluir=no` o sin datos se conservan en la semilla y el motor los filtra al ejecutar (se explican en `descartados`).
- Los roles viven en la semilla (`roles`) y los usan también el Worker (una cena de la IA sin `proteina` ni `plato` se descarta) y la app. Una receta sin rol en la semilla se trata como `plato`; un alimento sin rol, como `otro` (fijo).
- Si una cena de la IA usa una proteína que no está en `roles`, el Worker la descarta («sin proteína»). Si algún día se añade una proteína nueva al catálogo, hay que darle rol en la semilla.
- `confirmScreen`: el borrador de «Añadir a la cena» lleva `volver: 'cenas'` para que «‹ Volver» regrese a las propuestas (sin guardar) en vez de a la pantalla `home`.

## 4. Pendiente / limitaciones

- Sin llamadas reales a Gemini en esta ronda: el prompt de `/cenas` solo está probado con el modelo simulado. Probar con `node --env-file=.env scripts/dev-server.mjs` (1 llamada por pulsación) antes de desplegar.
- `POST /cenas` no está desplegado: hasta `npm run worker:deploy`, «Más ideas» en producción dará error (el resto de la pantalla funciona sin red).
- Pesos de la semilla en crudo aproximados (merluza 230 g, patata 74 g): el motor reescala entre 0,6 y 1,5 × de todos modos.
