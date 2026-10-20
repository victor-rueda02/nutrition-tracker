# ¿Qué ceno? — Notas y propuesta de cambios a CLAUDE.md

Nada de esto está aplicado a `CLAUDE.md`: es una propuesta para que Victor la revise (ronda 1, 20-10-2026).

## 1. Regla 6 (qué viaja a internet), nueva redacción propuesta

Decisión de Victor (20-10-2026): a Gemini viajan también los **nombres** de los nutrientes con déficit, solo para «Más ideas». Redacción de Victor, literal:

> A Gemini viajan mi frase o la lista compacta del catálogo y, en '¿Qué ceno?', solo los nombres de los nutrientes con déficit; nunca cantidades, nutrientes por alimento ni el diario

Versión ampliada como nota técnica (la regla actual más lo nuevo; ≤ 8 nombres, sin cifras, alimentos sin datos fuera de la lista):

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

## 3 bis. Ronda 2 (correcciones de la revisión de la ronda 1)

- `CENA_MAX_FRAC = 0.45` y `VERDURA_COMPLETAR_G = 100` (constantes en `core/cenas.js`). `E* = min(R, 0,45 × meta, kcal con factores 1,5)`; el límite de kcal de una propuesta normal pasa a ser `min(R, 0,45 × meta) + max(50, 5 %)` (con el día vacío y meta de 2.000: 950 kcal). El modo ligero no usa el tope. Aviso `cena_tope` solo con el día no vacío y R mayor que el tope.
- «Más habitual» (`habitualesDe`): más cenas, luego más gramos habituales (mediana), luego id; vale para todos los roles. La verdura añadida lleva `max(habituales, 100)` g. Con la semilla real y sin historial, la zanahoria.
- `crudas` en `data/cenas-semilla.json` (`["pepino", "zanahoria"]`): única fuente de la «verdura cruda» de los modos ligero (con al menos 100 g) y cubierto. No depende de que esté en las cenas habituales; si ninguna es válida (sin datos, `incluir=no`, fuera del documento) no se ofrece.
- «Más ideas» solo se pinta en modo normal (incluido `sin_candidatos` con R ≥ 400); `masIdeas` también lo comprueba, así que en ligero y cubierto no hay llamada posible.
- Proteína con porción en el catálogo (hoy solo el huevo, 50 g): número entero de porciones dentro de [0,6 ; 1,5] × la base si cabe, mínimo 1.
- Textos: sin cenas en la app, «Aún no tienes cenas en la app: uso tus cenas de Cronometer.»; el yogur y la chía añadidos llevan la etiqueta «postre habitual» (`postre: true` en la línea) y «añadida para completar» queda para la verdura y el hidrato; `source_text` = `¿Qué ceno? · <origen>`.
- Pendiente de ESPEC (no la he tocado): §9 todavía dice `source_text = '¿Qué ceno?: <origen>'`; ahora es `¿Qué ceno? · <origen>` según la revisión. El límite de kcal de §6.3 usa el tope de cena (no R) cuando este es menor, para cumplir el criterio 18.

## 3 ter. Ronda 3 (siempre 3 propuestas si se puede)

- `salsa` escala con el factor del hidrato (`ESCALA.salsa = 'h'`, mismo redondeo a 5 g y límites 0,6-1,5).
- Si una cena no cabe ni con los factores mínimos, `ajustar` le quita, uno a uno, el chocolate, las nueces y la fruta de la cena de origen (nunca el yogur ni la chía; tampoco los extras que prueba el propio motor) y vuelve a ajustar. Los nombres quedan en `quitados` y la tarjeta dice «Sin chocolate negro 85 % y nueces para que quepa.».
- Si tras elegir quedan menos de 3 propuestas normales, se completan con las cenas ligeras (proteína habitual + verdura de `crudas` + aceite 5 g, sin postre ni hidrato) ajustadas con el escalado normal y el mismo tope de cena (`origen` «Cena ligera: …», `tipo: 'ligera'`); se prefieren proteínas distintas de las ya elegidas. Si no hay ninguna cena habitual, sigue siendo `sin_candidatos`.
- `seQuedaCorta` ahora se compara con lo que hace falta (`min(R, tope de cena)` - 10 %), no con lo máximo alcanzable con los factores: una cena ligera de 133 kcal para 485 dice «Se queda en 133 kcal.». Es la lectura de «se queda por debajo de E* − 10 % por los topes» (§6.3). Afecta también a las propuestas normales que se queden cortas por los topes.
- Las ligeras de relleno no llevan yogur (criterio 9 es de propuestas normales).
- Service worker `nt-v16`.

## 4. Pendiente / limitaciones

- Ronda 4: `conExtras` no prueba extras de postre si `ajustar` ya quitó algo del candidato, y descarta cualquier extra cuya prueba obligue a quitar algo (la cena del 17-sep salía «Sin manzana…» y con chocolate y nueces añadidos). Test `(22b)`.
- Sin llamadas reales a Gemini en esta ronda: el prompt de `/cenas` solo está probado con el modelo simulado. Probar con `node --env-file=.env scripts/dev-server.mjs` (1 llamada por pulsación) antes de desplegar.
- `POST /cenas` no está desplegado: hasta `npm run worker:deploy`, «Más ideas» en producción dará error (el resto de la pantalla funciona sin red).
- Pesos de la semilla en crudo aproximados (merluza 230 g, patata 74 g): el motor reescala entre 0,6 y 1,5 × de todos modos.

## 5. Cambios al integrar en `main` (20-10-2026)

- Las propuestas de las secciones 1 y 2 están aplicadas a `CLAUDE.md`.
- Los roles pasaron de `data/cenas-semilla.json` a la columna `rol_cena` de `data/foods.csv` (43 alimentos con rol); la semilla solo lleva `cenas` y `crudas`. Nueva columna `nombre_corto` (vacía en todos: rellénala donde un título salga largo). Documentadas en `data/SCHEMA.md` y en la plantilla.
- El Worker ya no comprueba «sin proteína»: no conoce los roles. Descarta ids inventados, gramos inválidos y cenas sin ninguna línea válida; la app vuelve a validar con `rolesDe(foodsById)`. Gemini sigue recibiendo la misma lista compacta (regla 6 sin cambios).
- Sin la columna `rol_cena` en el documento del dispositivo, «¿Qué ceno?» muestra el aviso `sin_roles` hasta que se acepte la actualización del documento.
- «Estimar con IA» crea los alimentos sin `rol_cena`: hay que dárselo al revisarlos (si no, cuentan como «otro» y no se proponen).
- `scripts/dev-server.mjs` usa `callModelResiliente` del Worker (`crearCallModel`): mismo reintento a los 2 s y mismo respaldo.
- Service worker `nt-v17`.
