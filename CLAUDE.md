# CLAUDE.md — Contexto del proyecto NutritionTracker

Lee este fichero entero antes de tocar código. Es la fuente de verdad sobre el objetivo, las reglas y el estado del proyecto. Si algo del código contradice este fichero, avísame antes de cambiar nada.

## 1. Quién soy y qué quiero

Soy Victor, ingeniero de telecomunicaciones. Uso Cronometer para registrar lo que como, pero es lento. Quiero una app propia en mi iPhone para registrar comidas en segundos: dicto la comida con el teclado de iOS (por ejemplo "para comer 170 g de arroz, 2 huevos y una cucharada de aceite"), una IA la traduce a alimentos de MI catálogo con gramos, confirmo, y se guarda. Lo que más me importa es que los micronutrientes sean completos y fiables, al igual que los macronutrientes y kcal.

Voy a pesar casi todo lo que como, así que la entrada principal será en gramos ("150 g de arroz"); las porciones ("2 huevos") son un complemento. Uso personal, un único usuario, coste cero.

Prioridad: llegar cuanto antes a un MVP usable en el iPhone. Después, la tarea principal será pulir al máximo mi CSV (alias, porciones, variantes, nutrientes) para que dictar sea lo más rápido y preciso posible, así que la app debe facilitar ese pulido.

## 2. Reglas no negociables

1. **Mi documento es la única base de datos de alimentos.** Un CSV (o JSON con el mismo esquema) que yo mantengo. La app NUNCA consulta USDA, Open Food Facts ni nada en internet para obtener nutrientes, ni en tiempo de ejecución ni como fallback.
2. **La IA solo identifica alimento y cantidad.** Nunca calcula calorías ni nutrientes, nunca inventa alimentos. Lo que no está en el catálogo va a "no reconocido".
3. **Los nutrientes los calcula el código**, de forma determinista: valor por 100 g del documento × gramos / 100.
4. **Celda vacía = sin dato (null), nunca 0.** Un 0 escrito es un 0 real. Los totales deben distinguirlo y avisar cuando se basan en alimentos sin dato.
5. **Siempre hay confirmación editable** antes de guardar (cambiar gramos, cambiar alimento, borrar o añadir líneas).
6. **A internet solo viajan mi frase y la lista compacta** del catálogo (id, nombre, alias, porciones, estado, grupo, defecto y `peso_en_crudo` cuando está marcado). Nunca nutrientes, densidad ni el diario.
7. **Ninguna clave ni token en el repositorio ni en el frontend.** La clave de Gemini es un secret del Worker.
8. **Todo debe funcionar en Windows y en Linux.** Yo trabajo en Windows (PowerShell). Rutas siempre con `fileURLToPath` / `path.resolve`, nunca `new URL(...).pathname`.
9. **Coste cero**: GitHub Pages, Cloudflare Workers (plan gratuito), API gratuita de Gemini.
10. **La cuota de Gemini es gratuita pero limitada.** Una sola llamada por dictado (más el único reintento si el JSON es inválido). Nada de llamadas en segundo plano, de autocompletado ni en los tests (los tests usan siempre el modelo simulado). Un 429 se muestra con un mensaje claro, conserva el texto y deja añadir a mano. El nombre del modelo sigue en una sola variable.

## 3. Arquitectura

- `frontend/`: PWA estática (HTML/CSS/JS sin frameworks), instalable en iOS, offline salvo la llamada a la IA. Mobile-first y en español. La lógica pura está en `frontend/js/core/` (sin DOM, testeable con Node). La app solo habla con la IA a través de `interpretMeal({texto, alimentos})` en `ai-client.js`. Tiene que funcionar también por http con la IP del PC (`npm run dev:lan`, contexto no seguro): nada de APIs que exijan https sin alternativa (los ids salen de `core/ids.js`, no de `crypto.randomUUID`; compartir cae a descarga; el service worker es opcional). Ningún error es silencioso: toda acción pasa por `track` y un fallo se muestra arriba («No se pudo guardar: …») sin perder el borrador.
- `worker/`: Cloudflare Worker. `POST /parse` y `GET /health`. CORS restringido a mi dominio, token en la cabecera `X-App-Token`, un reintento si el JSON es inválido, 429 si Gemini se queda sin cuota. Proveedor aislado en `worker/src/providers/gemini.js`. Prompt y esquema en `worker/src/prompt.js` (para ajustar el comportamiento de la IA se edita SOLO ese fichero). Modelo en la variable `GEMINI_MODEL` de `wrangler.toml`.
- `scripts/`: herramientas que ejecuto yo en mi ordenador (`try-phrases.mjs` para probar frases con Gemini real; `usda.mjs` para completar nutrientes; `recetas.mjs` para calcular los nutrientes de una receta desde `data/recetas.json` y aplicarlos al catálogo con `--aplicar`; `dev-server.mjs` para probar la app en local). La app no depende de ellos.
- **Prueba en local**: `node --env-file=.env scripts/dev-server.mjs [--lan]` sirve la app en `http://localhost:8080/` (como GitHub Pages) y atiende `/parse` con el mismo código del Worker y la clave de `.env`. Solo sirve `frontend/` y `data/`. En la app, Documento → Conexión: Worker = esa dirección; token = `APP_TOKEN` de `.env` o `local`.
- `data/`: `settings.json` (31 nutrientes obligatorios y umbral), `nutrients.json`, `usda-map.json` (solo para el script de USDA), `targets.json` (referencias EFSA/UE y UL: lo que no define tu plan de objetivos), `recetas.json` (ingredientes de mis recetas), plantilla, ejemplo y `SCHEMA.md`.
- `tests/`: `node --test`. Dependencias solo de desarrollo (`jsdom`, `fake-indexeddb`, `wrangler`). `tests/fixtures/alimentos_iniciales.csv` es la copia de `data/foods.csv` para los tests del catálogo real; `tests/fixtures/reglas_variantes.csv` es una copia congelada para los tests de reglas de variantes (`rulesFoods`/`rulesList` en `tests/helpers.js`), para que pulir el catálogo no los rompa.
- Diario y documento importado: IndexedDB en el iPhone.
- **Plan de objetivos** (formato en `docs/OBJETIVOS-FORMATO.md`): documento JSON mío, importado y exportado desde Objetivos y guardado en el ajuste `plan_objetivos`; va en la copia de seguridad. Periodos (inicio y fin opcional; manda el que empezó más tarde), tipos de día por periodo asignados con `semana`, excepciones por fecha; por nutriente `min`/`objetivo`/`max`, con `g/kg`, `kcal/kg` o `%kcal`. Prioridad: excepción > tipo del día > periodo > referencia de `targets.json`; la entrada de un nutriente se sustituye entera. Los UL siempre de `targets.json`. Lógica en `core/targets-plan.js`, `targetsForDate(fecha)`; el Diario la llama con el día mostrado (histórico). Editar desde la app: «desde hoy» por defecto (tramo nuevo; los días pasados no cambian).
- **Hosting decidido**: GitHub Pages con el repositorio público, publicando la raíz del repo. Me da igual que mi lista de alimentos sea pública, así que `data/foods.csv` va en el repositorio y se carga por defecto en la primera ejecución. Después, al arrancar (y desde Documento → «Buscar actualización del documento»), la app detecta una versión nueva del `foods.csv` publicado y ofrece actualizar con una fusión a tres bandas (base = lo publicado que copió el dispositivo, ajuste `catalogo_base`): lo que solo cambió en el repo se actualiza, lo que cambié desde la app se conserva y, si cambiaron los dos, me enseña el conflicto antes de aplicar; nunca borra alimentos. Importar un documento desde el iPhone sigue funcionando. Las claves y el token, en cambio, nunca van al repositorio.

### Estética (integrada desde la rama `estetica`; detalle, valores y contrastes en `docs/notas-estetica.md`)
- Estilo inspirado en Cronometer en colores y en cómo presenta los datos, sin usar su nombre, logo ni iconos.
- **Paleta en un único `:root` de `frontend/css/styles.css`**, con su versión oscura en `@media (prefers-color-scheme: dark)`. Tokens: `--bg`, `--surface`, `--fg`, `--muted`, `--line`, `--field`, `--track`, `--accent`/`--on-accent`, colores de macros (`--c-energia`, `--c-proteina`, `--c-hidratos`, `--c-grasa`), estados de barra (`--bar-under`, `--bar-met`, `--bar-over`) y `--warn`; además `--radius` (16 px), `--shadow`, `--scrim` y `--header-h`. Todos los textos cumplen WCAG AA (≥ 4,5:1) y las barras ≥ 3:1, en claro y en oscuro.
- **Nunca colores sueltos**: solo tokens de la paleta. Pantallas nuevas: reutiliza las clases (`card`, `panel`, `card meal` + `meal-head`, `lines` con `line`/`line-name`/`line-grams`/`line-kcal` y `sep` oculto, `registro-actions`, `daynav`, `alert-ul`, `confirm-delete`, `danger`) y pon los estilos propios en un CSS de la pantalla (`repeat.css`, `plantillas.css`, `frases.css`), enlazado en `frontend/index.html` y en la caché del service worker (sube `VERSION` en `frontend/sw.js` al cambiar ficheros).
- **Barras con tres estados** solo con CSS, a partir de la clase que pone la lógica en `.meter`: por debajo, cumplido (`cumplido`, `en_objetivo`, `dentro`) y por encima (`excedido`, `por_encima` o fila `over-ul`). El estado nunca depende solo del color (texto en negrita y ⚠ en el UL). Superar el UL manda sobre cualquier color.
- **Cada macro tiene su color fijo** (barra del Diario por `data-clave`, borde de la tarjeta en Objetivos por `k-<clave>`); si una macro se pasa, conserva su color con un remate rojo al final.
- **Accesibilidad e iPhone**: zonas táctiles ≥ 44 px; sin scroll horizontal a 375 px (`overflow-wrap:anywhere` en `main`, `min-width:0` en los hijos de `.row`); cabecera fija que respeta `safe-area-inset-top`; fuente del sistema, sin fuentes externas. `theme_color` del manifest y los dos `theme-color` de `index.html` siguen la paleta.
- Los cambios de estilo no cambian textos ni comportamiento: los separadores « · » siguen en el DOM (ocultos) para que el texto y los tests no cambien.

## 4. Mi documento de alimentos

- Una fila por alimento. Columnas clave: `id`, `nombre`, `alias` (separados por `|`), `porciones` (`nombre:gramos|...`), `estado`, `grupo`, `variante_por_defecto`, y una columna por nutriente en snake_case con la unidad en el nombre (`energia_kcal`, `vitamina_b12_ug`, `magnesio_mg`...), valores por 100 g.
- Columnas de trabajo (`cantidad_habitual_g`, `dias_de_uso_en_8`, `termino_busqueda_usda`, `tipo`, `incluir`, `notas`, `fdc_id`, `fuente_usda`) se conservan al importar y exportar y no entran en cálculos.
- `incluir=no`: no se envía a la IA. Si lo dicto, el motivo es "Excluido del catálogo (incluir=no)" y la app ofrece activarlo con un toque. Si lo elijo a mano en la confirmación, se usa en esa línea sin activarlo (sigue sin ir a la IA).
- **Completitud**: solo cuentan los 31 obligatorios de `data/settings.json`; umbral 80 % configurable. Los incompletos se marcan "pendiente de completar" y se avisa al usarlos.
- Estados válidos: `crudo`, `cocinado`, `tostado`, `procesado`.
- CSV de Excel en español (punto y coma, coma decimal) debe funcionar.

### Fuentes de nutrientes (decisiones de la rama `catalogo`; detalle en `docs/notas-catalogo.md`)
- **Solo USDA, las etiquetas que yo pase y BEDCA** (Base de Datos Española de Composición de Alimentos, https://www.bedca.net), esta para alimentos españoles que USDA no tiene bien. Nunca valores "típicos" de memoria.
- Con BEDCA o una etiqueta, el origen de cada valor va en `fuente_usda`, y el `termino_busqueda_usda` y el `fdcId` de `usda/eleccion.csv` quedan vacíos (además, `usda.mjs filas` se salta los alimentos que no se buscan). BEDCA se consulta con un `POST` de un XML a `https://www.bedca.net/bdpub/procquery.php` (nivel 1: buscar por `f_ori_name`; nivel 2: valores por `f_id`). BEDCA da la niacina en equivalentes (incluye triptófano): no usarla como `vitamina_b3_mg`.
- **Productos con etiqueta** (corn flakes, merluza): kcal, macros, fibra, azúcares, sal (sodio = sal ÷ 2,5) y las vitaminas y minerales declarados salen de la etiqueta; ácido fólico a DFE × 1,7; lo que USDA trae por fortificación de EE. UU. y la etiqueta no declara, vacío; lo natural del alimento, de USDA o BEDCA.
- **EPA y DHA = 0 en alimentos vegetales** (USDA deja la celda vacía; ningún vegetal terrestre los tiene): es un 0 real, no inventado.
- **Recetas: excepción a "todo en crudo".** Una receta es una fila con `estado=cocinado`, sin `peso_en_crudo` y notas "Gramos del plato cocinado"; sus nutrientes se calculan con `scripts/recetas.mjs` desde `data/recetas.json` (formato en `data/SCHEMA.md`).

### Alias (decisiones de la rama `catalogo`)
- "pan" a secas = barra de pan blanco; "arroz" a secas = arroz blanco de grano largo; "jamón" a secas no identifica nada (como curado serrano y cocido); sin "ternera" ni "solomillo" a secas (regla de cortes).
- Genéricos con un solo alimento aceptados: "chocolate", "yogur", "griego", "queso", "galletas" (si como otro tipo, lo diré).
- Solo merecen alias las frases que el código no casa ya: acentos y plurales simples ya se toleran; plurales irregulares ("nuez"/"nueces"), no.

### Regla de variantes (crudo por defecto)
- Una fila por estado con ids distintos (`merluza_cruda` / `merluza_cocida`), mismo `grupo`.
- Si no digo el estado, se usa la variante con `variante_por_defecto=si` (crudo).
- Si el alimento tiene una sola variante, no se baja la confianza. Solo se baja un nivel si había varias variantes y no dije el estado.
- La variante cocinada solo si digo cocido, cocinado, asado, hervido, frito, plancha, horno...
- Excepción: "pistachos" es por defecto `pistachos_tostados_sin_sal`; crudos solo si lo digo.
- **Peso en crudo y sin hueso**: lo que dicto es el peso en crudo y sin hueso (lo que realmente como). Las palabras de cocinado ("a la plancha", "al horno", "hervido", "frito") describen el plato, no el peso: los alimentos que se cocinan llevan `peso_en_crudo=si` (arroz, pasta, avena, carnes, pescados, huevo, patata y verduras). Con `peso_en_crudo=si` se queda en esa fila (y si la IA elige la variante cocinada del grupo, se redirige a la marcada), sin bajar la confianza y sin aviso. Las variantes cocinadas `merluza_cocida` y `patata_asada` tienen `incluir=no` (se conservan por el diario y para elegirlas a mano). Si alguna vez peso cocinado o con hueso, elijo la variante cocinada (o corrijo los gramos) a mano en la confirmación: **decidido, no habrá forma de dictar un peso cocinado**.
- **"Tostado" sin variante tostada** ("pan tostado"): se ignora sin aviso, porque lo peso antes de tostar. Si el grupo tiene variante tostada (pistachos), sí la elige.
- Las palabras de estado que forman parte del nombre o de un alias ("tomate frito") no son estado, salvo que coincidan con el estado del propio alimento ("pistachos crudos").
- La regla la aplica el código, no el modelo.

### Lo dicho debe coincidir con el alimento
- Si lo que dije no contiene el nombre ni ningún alias del alimento elegido (ni de otra variante de su grupo), la línea pasa a confianza baja con el aviso "no coincide con tus alias" y pide confirmación. La comparación ignora acentos, mayúsculas y plurales.
- Esa línea **no se puede guardar** hasta que la toque explícitamente: pulsar "Sí, es «alimento»" o cambiar el alimento. Editar los gramos no basta.
- En "no reconocido", el texto es el fragmento exacto con su cantidad ("180 g de pollo"); al elegir el alimento, los gramos se rellenan solos.

### Cantidades sin unidad de peso ni volumen
- Peso casi todo y a menudo digo "150 de arroz" sin decir "gramos". Si lo dicho no lleva unidad (g, kg, ml, l...), cuenta el número que dije (en cifras o palabras; el número de un nombre, como "chocolate 85", no cuenta):
  - **Menos de 20** ("1 manzana", "2 huevos"): son unidades. Solo vale si los gramos salen de una porción del alimento (número × porción; si nombro una porción, como "una cucharadita", tiene que ser esa). Si no, la línea va a "sin porción" para que yo ponga los gramos.
  - **20 o más** ("150 de arroz", "25 de almendras"): se asume que son gramos; la línea lleva el aviso "asumido en gramos", visible en la confirmación, sin bloquear el guardado.
- El límite es la constante `UMBRAL_GRAMOS_SIN_UNIDAD` de `frontend/js/core/ai-contract.js` (la usan la validación, el borrador y el prompt). Lo aplica el código, no solo el prompt.

### Cortes y partes distintas son alimentos distintos
- La pechuga de pollo y el muslo de pollo son alimentos diferentes. Nunca se aproxima uno con otro, ni pollo con pavo.
- Si digo "pollo" sin la parte y hay varias en el catálogo, va a no reconocido con motivo "ambiguo" para que elija en la confirmación.
- Lo mismo para cualquier otro corte o especie.

## 5. Estado actual (17-10-2026)

- **Hitos 1, 2 y 3 hechos**: parser y validador, cálculo, completitud, porciones, Worker, validación de la IA, reglas de variantes, frontend (dictado, confirmación editable, guardado, importar documento, pantalla de conexión, PWA).
- **330 tests pasan** (`npm install` y `npm test`; comprobado en Windows).
- **Rama `catalogo` integrada en `main` y publicada**: **69 alimentos** (55 a la IA), **57 completos** (≥ 80 %); los 12 incompletos tienen `incluir=no` y ningún dato (recetas por calcular y puntuales). Corn flakes y merluza con su etiqueta; chorizo, jamón serrano, pan de barra, galleta María, brócoli y champiñón con BEDCA; recetas con `scripts/recetas.mjs`. Pendiente conmigo (recetas caseras, salteado, etiquetas de jamón cocido, mayonesa y pan de molde, verduras congeladas…): ver `docs/notas-catalogo.md`.
- **Rama `objetivos` integrada en `main` y publicada (18-10-2026)**: plan de objetivos (ver sección 3). «Crear plan» parte de la referencia con mis tipos de semana (`fuerza` lun-vie, `rh_movilidad` sábado, `descanso` domingo); B1, niacina y ALA quedan fuera del plan para que sigan a las kcal del día. Desde la app se editan kcal, macros, peso y «Hoy es»; micronutrientes, periodos, tipos y semana, en el JSON (exportar → editar → importar). Los objetivos de la pantalla anterior se migran solos a un plan al arrancar. Detalle y pendientes en `docs/notas-objetivos.md`.
- **Actualizar el documento publicado** (publicado): aviso en el inicio cuando hay un `foods.csv` nuevo, con revisión y conflictos antes de aplicar (ver sección 3, «Hosting»).
- **Rama `estetica` integrada en `main` y publicada**: paleta clara y oscura, tarjetas, barras con tres estados y colores de macros (ver «Estética» en la sección 3). Repetir, Plantillas, Frases a revisar y el aviso de error se adaptaron al mismo estilo.
- **Hito 4, fase 1 hecha y probada por mí en el PC y en el iPhone (servidor local)**: pantalla **Diario** (sustituye a "Hoy"; navegación por días; kcal, macros y los 31 micronutrientes con % del objetivo; totales parciales con los alimentos sin dato; aviso aparte si se supera un UL; desglose por comida), pantalla **Objetivos** (perfil EFSA hombre por defecto o mujer; mis kcal, macros y cualquier micro, guardados en el dispositivo) y `data/targets.json` (energía y macros: ingestas de referencia de la UE; micros: EFSA para adultos, con UL). **Plan de objetivos** (rama `objetivos`): periodos, tipos de día (entreno/descanso), excepciones por fecha, rangos y g/kg o % de kcal; cada día del Diario con los objetivos de ese día. Ver «Plan de objetivos» en la sección 3. Orden del resto en la sección 6, punto 5.
- **Gemini real probado** con `try-phrases.mjs`: separa bien los alimentos, convierte unidades y no inventa. Destapó tres fallos, ya corregidos (puntos 1–3 de la sección 6): palabras de estado dentro del nombre ("tomate frito"), cortes y especies (`pechuga_pollo_cruda`; "pollo", "pavo" y "pechuga" a secas son ambiguos) y mililitros (el modelo devuelve `cantidad` + `unidad`; la app convierte ml → g con `densidad_g_ml`, que no viaja a la IA). Reprobado con Gemini real: "150 g de pechuga" acababa en pechuga de pollo; corregido con el prompt y la comprobación de alias (sección 4). Añadida la columna `peso_en_crudo`.
- **Catálogo con nutrientes** (17-10-2026, ampliado por la rama `catalogo` el 18-10-2026): cada fila lleva `fdc_id` y `fuente_usda`.
- **Script de USDA hecho (punto 4 de la sección 6)** (`scripts/usda.mjs` + `usda-lib.mjs`, mapeo en `data/usda-map.json`): `candidatos` → `usda/eleccion.csv` (; y BOM, eliges el `fdcId` en Excel) → `filas` → `usda/foods.propuesto.csv` + `usda/informe.md`. Nunca toca `data/foods.csv`. Caché en `usda/cache/` (ignorada por git). Decisiones: omega3/omega6 vacíos; 4 alternativas (energía Atwater, vitamina D desde UI, folato total sin ácido fólico, ALA 18:3) anotadas en informe y `fuente_usda`; FNDDS como tercera opción marcada "estimado"; candidatos ordenados por completitud. Sugerido: primero los candidatos más parecidos al término (la categoría de USDA, primera palabra, debe coincidir); entre ellos, Foundation/SR Legacy ≥ 80 %, luego FNDDS, luego el más completo; el motivo se escribe en `eleccion.csv`, que conserva mis elecciones al regenerarse. **Fortificación de EE. UU.**: en España estos productos normalmente no están enriquecidos; se prefiere la versión sin enriquecer de USDA (leche sin vitaminas A y D añadidas, galleta "unenriched"); si no existe, `sin_enriquecer=si` en `eleccion.csv` deja vacíos B9, B1, B2, B3 y hierro (pan de molde). El informe avisa de fortificación ("enriched", "fortified", "with added", ácido fólico > 0, o B1/hierro imposibles en un cereal) y de valores sospechosos (usa los factores calóricos propios de cada alimento). Elecciones y registro de origen en `usda/eleccion.csv` e `usda/informe.md` (en git).
- **Repositorio en GitHub**: https://github.com/victor-rueda02/nutrition-tracker (público, rama `main`). Antes de subirlo se comprobó que ningún fichero ni commit contiene las claves de `.env`.
- **`try-phrases.mjs`** toma el modelo de `GEMINI_MODEL` en `worker/wrangler.toml` (o de la variable de entorno del mismo nombre).
- **Desplegado y probado en el iPhone (18-10-2026)**:
  - App: https://victor-rueda02.github.io/nutrition-tracker/ (GitHub Pages, raíz de `main`; `index.html` redirige a `frontend/`; `.nojekyll`).
  - Worker: https://nutrition-tracker-ai.victorueda2002.workers.dev (cuenta de Cloudflare victorueda2002@gmail.com; subdominio `victorueda2002`). `ALLOWED_ORIGIN = "https://victor-rueda02.github.io"`. Secretos `GEMINI_API_KEY` y `APP_TOKEN` puestos por mí (el token está en mi gestor de contraseñas, no en el repositorio).
  - Comprobado en el iPhone: instalación desde Safari, «Probar» (todo correcto), dictado real, diario y exportar la copia por el menú Compartir.
  - Herramientas: `wrangler` como dependencia de desarrollo; `npm run dev`, `token`, `worker:check` (empaqueta sin publicar), `worker:deploy`, `worker:secret:gemini`, `worker:secret:token`, `worker:logs`. «Probar» (Documento → Conexión) comprueba sin gastar IA que el Worker responde, tiene sus secretos y el token es el correcto.
- **Para publicar cambios**: app → `git push` (se ve en la segunda apertura en el iPhone); Worker → `npm run worker:deploy`.
- **Las claves están en `.env`** (ignorado por git), con `GEMINI_API_KEY` y `USDA_API_KEY`. Úsalas solo con `node --env-file=.env`. Nunca leas ni muestres el fichero.

## 6. Trabajo pendiente, en este orden

Comprueba primero en el código si alguno ya está hecho; no lo repitas.

1. **(Hecho)** **"Tomate frito" se trata como estado cocinado.** El modelo toma "frito" del propio nombre y da confianza baja con `variante_no_disponible`. Corrige el prompt (las palabras que forman parte del nombre o alias no son estado) y añade una comprobación en código que ignore `estado_dicho` si la palabra de estado está dentro del alias del alimento elegido. Tests con "tomate frito" (no es estado) y "pollo frito" (sí lo es).
2. **(Hecho)** **"Pechuga de pollo" se asigna a `muslo_pollo_con_piel`.** Como pechuga de pollo, así que:
   - Añade a mi `data/foods.csv` la fila `pechuga_pollo_cruda` (pechuga de pollo sin piel, cruda; alias `pechuga de pollo` (sin "pechuga" a secas: es ambiguo entre pollo y pavo); grupo propio; `termino_busqueda_usda` = "Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw"). Tienes mi permiso para este cambio.
   - Quita el alias genérico `pollo` del muslo (deja `muslo de pollo|contramuslo`).
   - Refuerza el prompt según "Cortes y partes distintas" (sección 4): "pechuga de pollo" → `pechuga_pollo_cruda`; "pollo" a secas → ambiguo; nunca aproximar entre cortes o especies.
   - Tests: "pechuga de pollo", "muslo de pollo", "pollo" a secas y "pechuga de pavo".
3. **(Hecho)** **Mililitros.** "5 ml de aceite" devuelve 5 g. Añade la columna opcional `densidad_g_ml` (aceite de oliva 0.91, leche entera 1.03), documentada en `SCHEMA.md`. La conversión ml → g se hace en código; sin densidad, va a no reconocido con motivo "sin_densidad". Con tests.
4. **(Hecho)** **Script de USDA** (`scripts/`, manual, fuera de la app): dado un `termino_busqueda_usda`, devuelve candidatos (fdcId, descripción, tipo de dato, nº de nutrientes obligatorios rellenos), priorizando Foundation y SR Legacy y ordenados por completitud; dado un `fdcId`, genera la fila en el formato de mi CSV para que yo la revise. La clave de FoodData Central va en la variable de entorno `USDA_API_KEY`. Debe poder procesar mi CSV entero en lote y dejarme un informe de qué alimentos quedan incompletos.
5. **Hito 4 (MVP)**, en este orden para llegar antes al iPhone:
   1. **(Hecho)** Diario con totales de kcal, macros y micros y % de objetivos (`targets.json`, con UL), pantalla Objetivos y servidor local.
   2. **(Hecho)** Editar y borrar registros pasados (desde el Diario: «Editar» abre la confirmación con la comida cargada, se puede cambiar gramos, alimentos, comida y fecha; «Borrar» pide confirmación dentro de la app).
   3. **(Hecho)** Exportar e importar el diario (y el documento), como copia de seguridad: en Documento → Copia de seguridad. La copia del diario (JSON) lleva las comidas y los objetivos, nunca el token; importar fusiona por id (gana la versión más reciente), muestra un resumen antes de aplicar y nunca borra; los objetivos solo se restauran si el dispositivo no tiene. El documento se exporta en CSV para Excel (; y coma decimal) o con comas. En el iPhone se entrega por el menú Compartir.
   4. **(Hecho)** README con los pasos exactos de despliegue (clave de Gemini, `wrangler deploy`, secrets y token, GitHub Pages publicando la raíz del repo, instalar en iPhone, importar mi documento) y preparación para GitHub Pages y el Worker. Desplegado el 18-10-2026 (ver sección 5).
   5. Después del despliegue: plantillas, "copiar comida de ayer", pantalla de pendientes de completar y editar y añadir alimentos desde la app.
      - **(Hecho)** **"Repetir comida"** (sustituye a "copiar comida de ayer"): «Repetir de ayer» en el inicio y «Repetir esta comida» en el Diario abren una pantalla con las comidas del día de origen agrupadas, cada alimento con casilla (marcada) y gramos (campo decimal que se selecciona al tocarlo, botones −10 −5 +5 +10, nunca menos de 1 g), totales de kcal y proteína en vivo, día de origen con flechas y destino (fecha, hoy por defecto; comida «Como en el origen» desde el inicio o la de la hora desde el Diario). «Añadir» guarda directamente (la pantalla es la confirmación editable, regla 5), sin IA. Lógica en `core/repeat.js`; pantalla en `ui/repeat-screen.js`; estilos propios en `css/repeat.css`.
      - **(Hecho)** **Plantillas**: en el Diario, «Guardar como plantilla» (con nombre, sin repetir nombres) en cualquier comida; en el inicio, «Plantillas» lista las guardadas (comida, kcal y alimentos) con «Usar», que abre la pantalla «Repetir» con la plantilla (gramos, fecha y comida ajustables), y «Borrar» con confirmación. Se guardan en el dispositivo (ajuste `plantillas`) y van en la copia de seguridad (al importar se añaden las nuevas y se mantienen las tuyas). Lógica en `core/templates.js`; pantalla en `ui/templates-screen.js`.
      - **(Hecho)** **Registro local de frases problemáticas** (primera parte del punto 6): al procesar un dictado con alguna línea no reconocida, de confianza baja o «no coincide con tus alias», se anota la frase con esos problemas (solo en el dispositivo, ajuste `registro_frases`, máximo 300) y, al guardar, qué alimento quedó para cada problema o si se descartó. Documento → Pulir el documento → «Frases a revisar»: lista, «Quitar», «Vaciar» (con confirmación) y «Exportar (CSV)» para Excel. Va en la copia de seguridad (al importar se añaden las frases que no tienes, sin pisar las tuyas). Lógica en `core/phrase-log.js`; pantalla en `ui/phrase-log-screen.js`.
      - **Asignado a la rama `ia-recetas` (ola 2): «Guardar como receta» desde la app.** Mover `scripts/recetas-lib.mjs` (es puro, solo importa de `frontend/js/core/`) a `frontend/js/core/` y hacer una pantalla para pasar los ingredientes en crudo y el peso final del plato (formato y reglas en `data/SCHEMA.md`).
6. **Después del MVP: pulir el CSV.** Herramientas para mejorar el catálogo con poco esfuerzo: ver qué frases dictadas acabaron en no reconocido, con confianza baja o con el aviso "no coincide con tus alias" (`sin_alias`) (registro local, sin enviar nada fuera) para añadir alias o alimentos; editar alias, porciones y densidad desde la app; e informe de completitud de nutrientes. No empieces esto hasta que te lo pida.

## 7. Cómo quiero que trabajes

- Antes de un cambio grande, explícame en pocas líneas qué vas a hacer y espera mi OK. Cambios pequeños y correcciones, hazlos directamente.
- Después de cada cambio, ejecuta `npm test`. No des una tarea por terminada con tests fallando.
- Cada fallo corregido lleva su test de regresión.
- No añadas dependencias de ejecución sin preguntarme. Las de desarrollo, solo si hacen falta.
- No toques mis datos reales (mi `foods.csv`) sin preguntarme. Puedes modificar los ficheros de ejemplo y los fixtures.
- Puedes ejecutar `try-phrases.mjs` con Gemini real para verificar cambios del prompt, con un máximo de 10 frases por tarea; dime cuántas llamadas has gastado. Para el script de USDA, igual: llamadas solo las necesarias. Nada de `wrangler deploy` ni publicar sin pedírmelo.
- Si algo que pido contradice estas reglas o es mala idea, dímelo antes de hacerlo.
- Háblame en español, de forma directa y concisa. Al acabar, dime qué cambiaste, qué probaste y qué falta.
- Si aprendemos algo nuevo sobre el proyecto (una decisión, una regla), propón actualizar este fichero.
