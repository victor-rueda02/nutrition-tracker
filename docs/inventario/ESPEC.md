# Inventario y lista de la compra — especificación (F0)

Estado: **aprobado por Victor el 13-11-2026**. Lista: 7 días desde hoy (D4 a) + 2 días de margen, en envases enteros (D5 b).
Decisiones: D1 a (Gmail + Apps Script, cada hora), D2 a (solo en la app), D3 a (sin Gemini),
D6 a (productos como bolsa; `lentejas_caseras` no se sigue), D7 a (lector de PDF propio), D8 ok (fixtures).

## 1. Qué hace

1. **Inventario inicial**: Victor cuenta lo que tiene en casa (alimento de la dieta + gramos o envases).
2. **Consumo**: lo registrado en el Diario se resta una vez por día cerrado (el día D cuenta desde las 00:00 de D+1).
3. **Compras**: los tickets de Mercadona (correo o subidos desde la app) suman en cuanto la app los recoge.
4. **Dudas**: una línea que puede ser de la dieta pero no se asigna con seguridad, o cuya cantidad no está clara, se
   pregunta; no suma hasta que Victor la resuelve. Nunca se adivina.
5. **«Sincronizar inventario»**: recoge tickets pendientes del Worker y recalcula.
6. **Lista de la compra**: qué comprar y cuánto para los próximos N días según la dieta planificada.

## 2. Alcance: los alimentos de la dieta

`alimentosDeLaDieta(dieta, recetas, plan, hoy)` en `core/inventario.js`, calculado siempre por código:

- Todas las líneas de `data/dieta.json` de las **versiones cuyo periodo esté vigente o sea futuro** en el plan
  (`dayContext`/periodos de `targets-plan.js`; una versión cuyo periodo ya terminó no cuenta), menú normal y `tipos`.
  Sin plan: todas las versiones.
- **Recetas no seguidas** (`data/inventario.json` → `recetas_no_seguidas`; hoy `["lentejas_caseras"]`: Victor no
  compra sus ingredientes para ellas): ni la receta ni sus ingredientes entran por ella, y comerla no resta nada.
- Una receta con campo `etiqueta` es un **producto envasado** (salteados Hacendado): se sigue como un alimento (la
  bolsa), no se expande (D6 a).
- Cualquier otra receta (caseras, creadas en la app) se sustituye por sus ingredientes (`mergeRecetas` de
  `core/recetas.js`, la del dispositivo gana). Hoy no hay ninguna en la dieta.
- Resultado hoy: **36 alimentos**.

| Grupo | Alimentos |
|---|---|
| Despensa | arroz_blanco_crudo, avena_copos, pasta_seca, lentejas_secas, corn_flakes, muesli, cacao_polvo, crema_cacahuete, chocolate_negro_85, semillas_chia, aceite_oliva, sal, salsa_tomate_frito |
| Frutos secos | almendras_crudas, anacardos, nueces, datiles_deglet_noor |
| Latas | atun_lata_aceite, sardina_lata_reducida_sal |
| Frescos | huevo, pechuga_pollo_cruda, salmon_atlantico, bebida_de_avena, yogur_griego_ligero, pan_integral |
| Fruta y verdura | manzana_con_piel, platano, kiwi_verde, mandarina, tomate, patata_cruda, zanahoria, cebolla, pimiento_rojo |
| Congelados (productos) | verduras_asadas_hacendado, salteado_verduras_hacendado |


- Si `dieta.json` cambia: un alimento nuevo entra **sin contar** (stock desconocido, nunca 0) y uno que sale deja de
  seguirse (sus datos se conservan por si vuelve).
- Fuera del conjunto: las líneas de ticket se descartan sin guardarse y las del Diario no afectan.

## 3. Modelo de datos

Todo en el iPhone, en el ajuste `inventario` de IndexedDB (va en la copia de seguridad del diario):

```js
{
  version: 1,
  eventos: [            // solo se añaden; editar = sustituir por id; nunca se borra el diario
    { id, tipo: 'recuento', momento: '2026-11-14T10:00', food_id, gramos },   // valor absoluto (inicial o recontar)
    { id, tipo: 'compra',   momento, food_id, gramos, ticket: '<hash>', linea: 7 },
    { id, tipo: 'ajuste',   momento, food_id, gramos: -200, motivo: 'caducado' }, // delta manual
  ],
  tickets: { '<hash>': { fecha: '2026-10-26', aplicado: '2026-10-26T21:03', origen: 'correo'|'app' } },
  dudas: [ { id, ticket: '<hash>', linea, descripcion, cantidad, peso_kg, candidatos: [food_id], motivo } ],
  aprendido: { 'griego ligero p-6': 'yogur_griego_ligero', 'tom. receta artesana': 'ignorar' },  // respuestas a dudas
}
```

**Stock derivado y determinista** (`stockDe(food_id, ahora)`), sin restar nada a mano:

```
R = último recuento del alimento (si no hay: "sin contar")
stock = R.gramos
      + Σ compras y ajustes con momento > R.momento
      − Σ consumo de los días cerrados d con R.dia < d < hoy
```

- Un recuento cuenta como «lo que hay ahora, con lo registrado hoy ya comido»: el día del recuento no se vuelve a
  restar. La pantalla enseña «Restado hasta ayer» y, aparte, «Registrado hoy (se resta a las 00:00)».
- Se recalcula al abrir la app y con «Sincronizar»; editar un día pasado corrige el stock solo; nada cuenta dos veces.
- Consumo de un día = sus líneas del Diario cuyo alimento está en el conjunto, más las recetas expandidas (salvo las no seguidas, §2, que no restan nada):
  `gramos_línea × gramos_ingrediente / peso_final_g` (o la suma de ingredientes si no hay peso final). Lo «Estimado con
  IA» ya se guarda como ingredientes. Un alimento borrado del documento o fuera de la dieta no resta.
- Días sin registrar no restan (el stock sale alto): se corrige recontando. El stock puede salir negativo: se enseña
  como «0 (revisa: faltan X g)».

## 4. Tickets de Mercadona

### Formato (ticket digital PDF; generado con openhtmltopdf, texto con fuentes Identity-H y ToUnicode)

```
<cabecera: empresa, NIF, tienda, teléfono>          → se ignora
DD/MM/AAAA HH:MM  OP: …                              → fecha (la hora y OP no se guardan)
FACTURA SIMPLIFICADA: NNNN-NNN-NNNNNN                → solo su SHA-256 (clave para no aplicar dos veces)
Cnt. Descripción P. Unit Importe                     → empieza el detalle
3 ATÚN CLARO OLIVA PK6 4,90 14,70                    → cantidad, descripción (≤ 20 car.), p. unitario (si cnt > 1), importe
1 MACARRON 1,15
1 PATATA                                              → línea a peso: la siguiente trae
0,870 kg 1,90 €/kg 1,65                              →   kg, €/kg e importe
TOTAL (€) …                                           → acaba el detalle; lo de debajo (IVA, tarjeta) se ignora
```

Línea parseada: `{ n, cantidad, descripcion, precio_unitario, importe, peso_kg }`. Lo que no encaje se marca
`ilegible` (va a Dudas solo si puede ser de la dieta).

### Lectura del PDF (D7 a)
`core/pdf-texto.js` propio (sin dependencias): descomprime con `DecompressionStream('deflate')` (iOS 16.4+, Workers y
Node), traduce con la ToUnicode de cada fuente y agrupa por la coordenada y. Lo usan la app y el Worker. Respaldo
siempre disponible: «Pegar el texto del ticket».

### Mapeo línea → alimento (`core/tickets.js`, compartido con el Worker como `usda-core.js`)

Tabla `data/tickets-mercadona.json` (en el repositorio, la mantiene `catalogo`), una entrada por descripción
normalizada (sin acentos, minúsculas, espacios simples):

```json
{ "atun claro oliva pk6": { "food_id": "atun_lata_aceite", "unidades_por_envase": 6, "gramos_por_unidad": 60, "fuente": "…" },
  "patata": { "food_id": "patata_cruda", "a_peso": true },
  "filete pechuga fino": { "food_id": "pechuga_pollo_cruda", "preguntar_gramos": true },
  "lenteja cocida": { "ignorar": true, "motivo": "bote cocido; la dieta usa lentejas secas" } }
```

En `foods.csv` (columnas de trabajo nuevas, solo de los alimentos de la dieta): `porcion_comestible` (fracción 0-1 de
BEDCA o USDA *refuse*, fuente en `fuente_usda`; vacío = 1 sin dato, con aviso) y nada más: los envases van en la tabla
porque un alimento tiene varios productos (huevos de 6 y de 12, tres tomates fritos).

Gramos de una línea = `cantidad × unidades_por_envase × gramos_por_unidad × porcion_comestible`, o
`peso_kg × 1000 × porcion_comestible` a peso. Huevos del súper: se ignoran (Victor trae huevos caseros; los cuenta con
el recuento o «Ajustar»).

Clasificación de cada línea, en este orden:
1. Descripción en `aprendido` del dispositivo o en la tabla → su alimento (o ignorar).
2. Si no, parecido con nombre, alias o palabras clave de un alimento de la dieta (misma comparación que los alias:
   sin acentos ni plurales, palabras completas, más una lista de abreviaturas de Mercadona: `tom.`→tomate,
   `pim`→pimiento…) → **Duda** con esos candidatos.
3. Si no se parece a nada de la dieta → se descarta en silencio (limpieza, bebidas, caprichos).

Cantidad no clara → **Duda** aunque el alimento sea seguro: carne y pescado envasados sin peso en el ticket
(`preguntar_gramos`), envase sin tamaño en la tabla, `ilegible`.

### Correspondencias confirmadas por Victor (13-11-2026) — punto de partida de `data/tickets-mercadona.json`

| Descripción del ticket | Alimento | Gramos |
|---|---|---|
| ARROZ LARGO | arroz_blanco_crudo | paquete |
| AVENA MOLIDA | avena_copos | paquete |
| MACARRON | pasta_seca | paquete |
| LENTEJA PARDINA | lentejas_secas | paquete |
| COPOS DE MAIZ 0% | corn_flakes | caja |
| MUESLI CRUNCHY 0% | muesli | paquete |
| BEBIDA AVENA | bebida_de_avena | brik 1 L × 1,03 |
| PORCIONES 85% CACAO | chocolate_negro_85 | tableta |
| CHÍA | semillas_chia | bolsa |
| ALMENDRA NATURAL | almendras_crudas | bolsa |
| NUEZ CASCARA NATURAL | nueces | bolsa × porción comestible |
| DÁTIL SIN HUESO | datiles_deglet_noor | envase |
| ROJA DULCE BOLSA, ROJA ACIDULCE BOLSA | manzana_con_piel | peso variable: siempre pregunta los gramos × porción comestible |
| MANDARINA (a peso) | mandarina | kg × porción comestible |
| PATATA (a peso) | patata_cruda | kg |
| FILETE PECHUGA FINO, PECHUGA FAMILIAR | pechuga_pollo_cruda | siempre pregunta los gramos |
| FILETE SALMÓN | salmon_atlantico | siempre pregunta los gramos |
| ATÚN CLARO OLIVA PK6 | atun_lata_aceite | 6 latas × g escurridos |
| SARDINILLA RE. SAL O | sardina_lata_reducida_sal | pack de 2 latas × 65 g escurridos |
| CEBOLLA TUBO | cebolla | malla de 1 kg × porción comestible |
| TOM.FRITO EST.CASERO | salsa_tomate_frito | bote |
| BARRA 100% INTEGRAL | pan_integral | g por barra (puede comprar otro tipo: lo nuevo irá a Dudas) |
| SALTEADO VERD. ASADA | verduras_asadas_hacendado | bolsa 450 g |
| SALTEADO DE VERDURAS | salteado_verduras_hacendado | bolsa 600 g |

**Ignorar** (se parecen a la dieta pero no lo son): LENTEJA COCIDA, MUESLI CON FRUTAS, GRIEGO NATURAL P-6 (yogur
entero), 12 HUEVOS SUPER GRAN y 6 HUEVOS GRANDES-L (Victor trae huevos caseros; si compra, «Ajustar»), TOM. RECETA ARTESANA, TOMATE FRITO BRICK, T.CHERRY PERA NEGRO, PARRILLADA VERDURA A, PIM PIQ TRADICIONAL,
PATATA PREFREG. FINA, SALMÓN CON VERDURAS, LECHE SEMI, LECHE ETERA GAZA PA.

**Sin línea conocida** (la primera vez irán a Dudas y la respuesta se recuerda): yogur_griego_ligero, tomate (natural),
aceite_oliva, anacardos, cacao_polvo, crema_cacahuete,
kiwi_verde, platano, pimiento_rojo, zanahoria, sal.

### Flujo de punta a punta

```
Correo (Gmail, PDF adjunto) ─Apps Script cada hora─► Worker POST /tickets (MAIL_TOKEN) ─┐
                                                                              ├─► KV «TICKETS»: cola de tickets parseados
App «Subir ticket» (PDF o texto) ──────────► Worker POST /tickets (APP_TOKEN)─┘    (líneas + fecha + hash; sin tienda,
                                                                                    hora, tarjeta ni nº de factura)
App al abrirse / «Sincronizar» ──POST /tickets/pendientes──► lista
   └─ clasifica en el iPhone (tabla + aprendido + conjunto de la dieta) → compras | Dudas | descartadas
   └─ POST /tickets/recibidos {hashes} → el Worker los borra de KV (y TTL de 30 días por si acaso)
```

- La subida desde la app también pasa por la cola para tener un único camino (y sin red se aplica en local y se avisa).
- Mismo hash ya aplicado (llegó por correo y lo subí) → «Ticket ya aplicado», no suma.
- Correo (D1 a): el Apps Script busca cada hora los correos de Mercadona sin la etiqueta `nt-procesado`, manda el PDF adjunto (base64) al Worker, que lo lee con `pdf-texto.js` y lo parsea, y etiqueta el hilo. Dudas solo en la app (D2 a). Sin Gemini (D3 a).
- Recursos nuevos de Cloudflare (gratis): namespace KV `TICKETS` y secreto `MAIL_TOKEN` (solo puede escribir en
  `/tickets`; si se filtra el del Apps Script, nadie lee la cola). Los crea Victor (OK previo).
- Regla 6: ni el ticket ni el inventario ni el diario van a Gemini ni a USDA. La cola vive en el Worker de Victor.

## 5. Pantallas (F4)

- **Alimentos → Inventario** (y entrada en Más): lista por grupo con stock («1,2 kg · ≈ 1 paquete», «sin contar»,
  «0 (revisa)»), «Sincronizar inventario», «Subir ticket», contador «Dudas (2)» y «Hacer recuento» (todos o uno: gramos
  o envases). Cada alimento: historial (recuentos, compras, ajustes, consumo por día) y «Ajustar» (± gramos con motivo).
- **Dudas**: por línea, el texto del ticket, la cantidad y los candidatos como botones; gramos editables (rellenos si
  se pueden calcular); «No es de la dieta»; casilla «Recordar para la próxima vez» (marcada por defecto → `aprendido`).
- **Lista de la compra**: §6. Aviso en el Diario («2 dudas de tickets») al abrir la app (D2 a).
- Clases y tokens de la paleta, `inventario.css`, sin scroll horizontal a 375 px, `track` + error visible.

## 6. Lista de la compra

```
necesidad(f) = Σ gramos del menú de f en cada día de hoy … hoy+N−1   (elegirMenu con el plan; recetas como en §2)
             + margen: 2 días más de menú (D5 b; `margen_dias` de data/inventario.json)
faltan(f)    = max(0, necesidad(f) − max(0, stock(f)))   (el stock no resta hoy y la necesidad ya incluye el menú de hoy: sin doble conteo;
               si el recuento es de hoy, la necesidad de f resta lo registrado hoy, sin bajar de 0)
comprar(f)   = faltan(f) en envases enteros del producto habitual (el primero de la tabla) y en gramos
```

- Días sin menú (fines de semana, vacaciones, Navidad) suman 0 y se dicen («sáb y dom sin menú: no cuentan»).
- Alimento sin contar: sale con la necesidad entera y «stock desconocido».
- Horizonte N = 7 días desde hoy (D4 a; `horizonte_dias`, ajustable en la pantalla). Agrupada como el inventario; compartir/copiar como texto.

## 7. Fases

| Fase | Quién | Qué |
|---|---|---|
| F1 | desarrollador (Sonnet high) | `core/inventario.js`: conjunto, consumo derivado, recetas, porción comestible, eventos, stock, lista de la compra + tests (incluido el de 3 días + 1 ticket calculado a mano) |
| F2 | catalogo (Sonnet medium) | `data/tickets-mercadona.json` (tamaños de envase con fuente) y `porcion_comestible` de los alimentos de la dieta; fixture |
| F3 | desarrollador (Sonnet high) | `core/pdf-texto.js`, `core/tickets.js`, Worker `/tickets*` + KV, Apps Script y pasos, subida desde la app |
| F4 | desarrollador (Sonnet medium) | Pantallas Inventario, Dudas y Lista; capturas a 375 px |

## 8. Fixtures

`tests/fixtures/tickets/ticket-2026-09-09.txt` y `ticket-2026-10-26.txt`: el texto de las líneas de producto y la
fecha, sin empresa/NIF, tienda, teléfono, hora, OP, nº de factura, tarjeta, AUT/AID ni IVA. Un PDF de prueba para
`pdf-texto.js` se genera en el test (mismo tipo de fuentes), nunca a partir de los PDF reales.
