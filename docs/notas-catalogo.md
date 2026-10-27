# Notas del catálogo (rama `catalogo`)

Trabajo sobre `data/foods.csv` (y su copia `tests/fixtures/alimentos_iniciales.csv`) del 18-10-2026.
Este documento es para el coordinador que integra en `main`: qué cambió, qué decisiones de Victor deben pasar a
`CLAUDE.md` y qué queda pendiente (incluido lo que necesita código de la app, fuera del alcance de esta rama).

**Resultado:** 69 alimentos (antes 64), 55 enviados a la IA (antes 49), **57 completos** (antes 48), 12 incompletos
(todos con `incluir=no` y sin datos: recetas por calcular y puntuales). `npm test`: 254 tests en verde.
Gasto: 21 llamadas a USDA (de 100); BEDCA, consultas a su web (sin cuota); 0 llamadas a Gemini.

## Decisiones de Victor para pasar a CLAUDE.md

1. **Fuentes de nutrientes: USDA, etiquetas que pase Victor y BEDCA** (Base de Datos Española de Composición de
   Alimentos, https://www.bedca.net), aprobada para **alimentos españoles** que USDA no tiene bien. Nunca valores
   "típicos" de memoria. Cuando se usa BEDCA o una etiqueta, el origen de cada valor va en `fuente_usda`, y el
   `termino_busqueda_usda` y el `fdcId` de `usda/eleccion.csv` quedan vacíos para que `scripts/usda.mjs` no lo pise
   (ver "Para el coordinador", punto 5). Consulta de BEDCA: `POST` de un XML a
   `https://www.bedca.net/bdpub/procquery.php` (nivel 1: buscar por `f_ori_name`; nivel 2: valores por `f_id`).
   Ojo: BEDCA da la niacina como *equivalentes de niacina* (incluye triptófano): no usarla como `vitamina_b3_mg`.
2. **Lo que dicta Victor es peso en crudo y sin hueso** (lo que realmente se come). Las palabras de cocinado
   ("a la plancha", "al horno", "hervido", "frito") describen el plato, no el peso: los alimentos que se cocinan
   llevan `peso_en_crudo=si` (hoy 20: arroz, pasta, avena, carnes, pescados, huevo, patata y verduras). Si alguna
   vez pesa cocinado o con hueso, lo corrige en la confirmación. Generaliza la regla "Peso en crudo" de la sección 4
   (hoy dice "marcado en `pechuga_pollo_cruda`"). Las variantes cocinadas `merluza_cocida` y `patata_asada` quedan
   con `incluir=no` (se conservan por el diario y para elegirlas a mano).
3. **Recetas: excepción a "todo en crudo".** Una receta es una fila del catálogo con `estado=cocinado`, sin
   `peso_en_crudo` y notas "Gramos del plato cocinado"; sus nutrientes se calculan con `scripts/recetas.mjs` desde
   `data/recetas.json` (formato en `data/SCHEMA.md`). Añadir el script a la sección 3 (herramientas de `scripts/`).
4. **EPA y DHA = 0 en alimentos vegetales** (USDA deja la celda vacía; ningún vegetal terrestre los tiene). Es un 0
   real, no un dato inventado. Aplicado en chía y pimiento amarillo (los demás vegetales ya traían 0).
5. **Alias:** "pan" a secas = barra de pan blanco; "arroz" a secas = arroz blanco de grano largo; "jamón" a secas no
   identifica nada (come curado serrano y cocido); sin "ternera" ni "solomillo" a secas (regla de cortes).
   Genéricos con un solo alimento aceptados por Victor: "chocolate", "yogur", "griego", "queso", "galletas" (si
   come otro tipo, lo dirá). Solo merecen alias las frases que el código no casa ya (acentos y plurales simples
   ya se toleran; plurales irregulares como "nuez"/"nueces", no). Un alias corto que queda dentro de uno más largo de
   otro alimento (de otro grupo) es válido: si dices el largo y la IA elige el corto, la app avisa
   (`alias_mas_especifico`, ver CLAUDE.md §4). Hoy: "pan" / "pan de molde" / "pan integral", "atún" / "lata de atún",
   "pechuga de pavo" / "pechuga de pavo en lonchas", "lentejas" y "chorizo" / "lentejas con chorizo".
6. **Productos con etiqueta y fortificación** (corn flakes): kcal, macros, fibra, azúcares, sal (sodio = sal ÷ 2,5)
   y vitaminas y minerales declarados, de la etiqueta; ácido fólico a DFE × 1,7; lo que USDA trae por fortificación
   de EE. UU. y la etiqueta no declara, vacío; lo natural del alimento, de USDA.

## Cambios por tarea (commits en `catalogo`)

| Commit | Tarea | Cambio |
|---|---|---|
| `31e114c` | 1. Alias | Alias nuevos donde el código no casaba (nuez, musli, cornflakes, pescadilla, lonchas de queso, pan bimbo, filete de pollo, arroz largo…); fuera "ternera", "solomillo", "jamón" a secas y "pan" del integral. `tests/catalogo.test.js` |
| `e313404` | 1. Alias | Nuevos `pan_blanco_barra` y `jamon_cocido` (alias "jamón york") |
| `4745371` | 2. peso_en_crudo | 18 alimentos marcados; `merluza_cocida` y `patata_asada` a `incluir=no`. **`tests/fixtures/reglas_variantes.csv`**: copia congelada del catálogo para los tests de reglas de variantes (`rulesFoods`/`rulesList` en `tests/helpers.js`), así pulir el catálogo no rompe esos tests |
| `cc90d90` | 3. Excluidos | `mayonesa` activada (USDA 171009; alias "mahonesa") |
| `189116d` | 3. Excluidos | `chorizo` activado: BEDCA 2264 + huecos de USDA 173859 |
| `d1795d7` | 4. Recetas | `scripts/recetas.mjs` + `recetas-lib.mjs` + `tests/recetas.test.js`, `data/recetas.json` (con una receta de ejemplo que nunca va al catálogo), formato en `data/SCHEMA.md`. `verduras_asadas_hacendado` calculada y `parrillada_verduras_hacendado` nueva (proporciones del envase) |
| `b9d8807` | 5. Corn flakes | Etiqueta de Corn Flakes 0 % azúcar Hacendado; vacías A, C y D (fortificación de EE. UU.) |
| `1c941fa` | 6. Incompletos | BEDCA + huecos de USDA en merluza (merluza europea, no whiting), jamón serrano, pan de barra (B1, B2, B9 y hierro sin enriquecer) y galleta María; nuevos `brocoli` y `champinon` (BEDCA); EPA/DHA = 0 vegetales; atún USDA 173708 (escurrido, con sal) |
| `25c6c09` | 6. Merluza | Macros de la etiqueta de la merluza que compra Victor (merluza del Cabo: 82 kcal, 18 g de proteína; BEDCA daba 11,9 g); micros de BEDCA; agua de USDA (la de BEDCA no cuadra con 18 g de proteína) |

## Informe de completitud (31 obligatorios, umbral 80 %)

Detalle completo en `usda/informe.md` (regenerado). Alimentos que se envían a la IA con algún hueco:

| Alimento | Obligatorios | Faltan | Nota |
|---|---|---|---|
| pimiento_amarillo | 27/31 | E, K, colina, ALA | USDA no tiene más; BEDCA no tiene pimiento amarillo |
| verduras_asadas_hacendado, parrillada_verduras_hacendado | 27/31 | E, K, colina, ALA | Heredado del pimiento amarillo |
| corn_flakes | 28/31 | A, C, D | A propósito: fortificación de EE. UU. que la etiqueta no declara |
| semillas_chia | 25/31 | A, D, K, B5, B6, colina | Completa desde EPA/DHA = 0. BEDCA no la tiene y CIQUAL 15047 tampoco tiene esos datos |
| pan_molde_blanco | 26/31 | B1, B2, B3, B9, hierro | Vaciados por el enriquecimiento de EE. UU.; BEDCA no publica su pan de molde. La etiqueta del pan lo resolvería |
| chocolate_negro_85 | 30/31 | colina | C de BEDCA 28 (0), D y B9 de CIQUAL 31074; ninguna fuente tiene colina |
| jamon_curado | 29/31 | B5, manganeso | Huecos de FNDDS (estimado) |
| muesli | 31/31 | | Mn y B5 de CIQUAL 32113 (muesli Bircher, aproximado) |
| pistachos_crudos, galleta_maria | 29/31 | K, colina (+ B5/Mn) | |
| pasta_seca, chorizo, pan_blanco_barra | 30/31 | colina / B5 / B3 | |

Los 12 incompletos restantes tienen `incluir=no` y ningún dato: recetas pendientes (lentejas, repollo al horno,
crema de calabacín, tortilla de patata) y 8 puntuales que Victor no quiere activar.

## Salteados de verduras Hacendado (rama cat/f-salteados)

Dos productos ultracongelados, dos filas (grupos distintos, no variantes). Victor: «si no digo nada, el salteado de verduras; si digo salteado de verduras asadas, el de asadas».
- **Método**: receta en `data/recetas.json` con las verduras del catálogo a partes iguales (20 g de cada una; la etiqueta dice «proporción variable»: **micros estimados**). La etiqueta va en el campo `etiqueta` de la receta (kcal, grasa, saturadas, hidratos, azúcares, fibra, proteína y sodio = sal ÷ 2,5 × 1000: 8 y 12 mg); `recetas.mjs --aplicar` y la app la respetan. El resto (agua, mono/poli, almidón, vitaminas, minerales, aminoácidos) es de la receta.
- **`salteado_verduras_hacendado`** (nueva; judías verdes, brócoli, pimiento rojo, champiñón, cebolla; alias «salteado de verduras»): sin pérdida de agua las kcal calculadas son 29,6 frente a 31 de la etiqueta (diferencia de proporciones, no de agua), así que no hay `peso_final_g`. 31/31 obligatorios.
- **`verduras_asadas_hacendado`** (id conservado; calabacín, cebolla, berenjena, pimiento rojo y amarillo; alias «salteado de verduras asadas» y «verduras asadas»): 27 kcal con verduras crudas, así que `peso_final_g` = 58,7 g por cada 100 g crudos (agua perdida al asar, ~41 %) para que cuadren los 46 kcal. 27/31 (faltan E, K, colina y ALA, del pimiento amarillo).
- **Estado y peso**: `estado=cocinado`, sin `peso_en_crudo` (lo fija recetas.mjs): Victor pesa el producto tal cual sale de la bolsa (congelado, ya salteado o asado), no hay variante cruda y las verduras crudas son solo ingredientes. `rol_cena=verdura`; `nombre_corto` «Salteado de verduras» y «Verduras asadas».
- **Ronda 2**: filas regeneradas solo con `recetas.mjs --aplicar` (sin retoques a mano); `peso_final_g` de las asadas = 58,7. La parrillada no tenía valores de etiqueta puestos a mano. Roles de «¿Qué ceno?» por decisión de Victor: `jamon_curado`, `jamon_cocido`, `chorizo` → proteina; `pan_integral`, `avena_copos` → hidrato; sin rol (ya vacíos): `lentejas_secas`, `muslo_pollo_con_piel`, `almendras_crudas` (no cena legumbres, asados ni frutos secos).
- **Alias**: «salteado de verduras» está contenido en «salteado de verduras asadas». Si la IA elige el normal para «salteado de verduras asadas», la regla «alias más específico» (encargo H) lo marca con confianza baja y ofrece cambiar a las asadas (por eso los dos salteados van en grupos distintos).

## Pendiente con Victor

- **Recetas caseras**: lentejas, repollo al horno, crema de calabacín y tortilla de patata. Victor pasará
  ingredientes en crudo y peso final del plato cuando cocine; entonces se añaden a `data/recetas.json` y
  `node scripts/recetas.mjs --aplicar`.
- **Jamón cocido**: USDA ~8 % de grasa; el cocido extra español suele tener menos. Mejor con su etiqueta.
- **Mayonesa**: USDA es de soja; la española suele ser de girasol (vitamina K probablemente alta, E baja).
- **Pan de molde**: con su etiqueta se rellenarían B1, B2, B3, B9 y hierro.
- **Verduras congeladas**: aplazado por Victor. Idea: filas propias con USDA "frozen, unprepared", en un grupo
  distinto del crudo (si comparten grupo, el código elige siempre la variante cruda por defecto).
- Aminoácidos y almidón de las filas de BEDCA siguen siendo de USDA (pueden no cuadrar con la proteína de BEDCA).
- Biotina (B8) de la etiqueta de corn flakes: no hay columna; anotada en `notas`.

## Para el coordinador (código de la app y CLAUDE.md, fuera del alcance de esta rama)

1. **Excluidos elegidos a mano se activan**: en la confirmación, elegir un alimento con `incluir=no` lo pasa a
   `incluir=si` en el dispositivo (`frontend/js/ui/app.js`, `activate`). Con `merluza_cocida`/`patata_asada` eso las
   vuelve a enviar a la IA.
2. **`peso_en_crudo` y variantes del mismo grupo**: si la IA elige la variante cocinada de un grupo cuyo crudo tiene
   `peso_en_crudo=si`, el código la respeta. Lo coherente sería redirigir a la fila marcada (`resolveVariant`).
3. **"Pesado cocinado"**: no hay forma de dictar que el peso es cocinado; hoy se cambia el alimento a mano.
4. **"pan tostado"**: `tostado` es un estado y `peso_en_crudo` solo cubre las palabras de cocinado; sale
   "variante no disponible".
5. **`scripts/usda.mjs filas` aplica el `fdcId` de `eleccion.csv` aunque el alimento no tenga término** (y con
   `--sobrescribir` pisaría datos de BEDCA o de etiqueta). Esta rama lo evita vaciando esos `fdcId`; sería más
   robusto que `filas` omita los alimentos que `searchPlan` omite.
6. **"Guardar como receta"**: `scripts/recetas-lib.mjs` es puro (solo importa de `frontend/js/core/`); para usarlo
   desde la app habría que moverlo a `frontend/js/core/`. Formato y reglas en `data/SCHEMA.md`.
7. **CLAUDE.md, sección 5**: actualizar recuentos (69 alimentos, 57 completos, 254 tests) y mencionar
   `tests/fixtures/reglas_variantes.csv`.

## `usda.mjs`: ingredientes solo de receta (19-10-2026)
`candidatos` y `filas` aceptan `--incluir-excluidos` (todos los `incluir=no` con término) o `--incluir id1,id2` para
volcar datos USDA en ingredientes que solo se usan en recetas, **sin activarlos** (la fila sigue con `incluir=no`).
Los que no tienen término o son recetas siguen omitidos. Ejemplo: `node --env-file=.env scripts/usda.mjs filas --incluir morro_cerdo`.

## Rama `cat/d-e-atun-huecos` (21-10-2026)
- **Receta `atun_lata_con_aceite`** («Lata de atún con aceite»): 60 g de `atun_lata_aceite` + 20 g de `aceite_oliva`, peso final 80 g, porción `lata:80`, `rol_cena=proteina`, alias solo `lata de atún` (31/31 obligatorios; 369,5 kcal y 21,8 g de proteína por 100 g). Decidido por Victor (21-10-2026): alias solo «lata de atún» («atún en lata» ya es alias de `atun_lata_aceite` y «una lata» es demasiado genérico). Con «una lata de atún», que contiene también «atún» (alias del atún escurrido), elige la IA entre las dos filas.
- **Huecos con BEDCA/CIQUAL** (CIQUAL 2020 en inglés, `Table Ciqual 2020_ENG_2020 07 07.xls`):
  - `muesli` 29 -> 31/31: manganeso 1,61 y B5 0,6 de CIQUAL 32113 (muesli Bircher de copos con frutas, sin azúcar: aproximado, no es el Hacendado crunchy). El «promedio sin fortificar» (32141) y el 32138 no traen micros; el 32108 trae B5 = 5 mg, que parece añadido, y se descartó.
  - `chocolate_negro_85` 27 -> 30/31: D = 2,16 µg y B9 = 52 µg de CIQUAL 31074 (chocolate negro > 70 % de cacao; encaja con la fila en Fe, Mg y Mn). La D viene del propio cacao (D2); el 0 de BEDCA 28 era de otro producto (menos cacao) y recopilado, no medido, y se descartó. C = 0 de BEDCA 28 (CIQUAL da «< 0,5»). Colina: ninguna fuente.
  - `semillas_chia`, `corn_flakes`, `pasta_seca`: sin cambios. Chía: ni BEDCA ni CIQUAL (15047) tienen A, D, K, B5, B6 ni colina. Corn flakes: A, C y D siguen vacíos a propósito (fortificación). Pasta: la colina no está en BEDCA 598 ni en CIQUAL; B1, B2, B3, B9 y hierro ya están en la fila (USDA sin enriquecer), no se tocan.
- `leche_entera` (O, 22-10-2026): etiqueta Gaza por 100 ml -> 100 g con densidad 1,03 (64 kcal, grasa 3,6, sat 2,7, hidratos 4,6, azucares 4,6, proteina 3,2, sodio 48 mg, B12 0,40 ug, calcio 120 mg); resto de USDA 172217; fibra sin declarar (se mantiene el 0 de USDA).
- `pan_integral` (O, 22-10-2026): etiqueta Mercadona pan integral 51 % (256 kcal, grasas 1,3/0,2/0,3/0,7, hidratos 49, azucares 2,9, fibra 4,3, proteina 10, sodio 560 mg); micros de BEDCA 2163 Pan integral (agua, A, D, E, C, B1, B2, B6, B9, B12, Ca, Fe, Mg, P, K, Zn, Se; niacina en equivalentes, no usada); B3, B5, K, colina, Cu y Mn de USDA 172688 (sin fortificar: B3 4,4 y folato normales de trigo integral); almidon y trans vacios (no cuadran con la etiqueta); termino y fdcId vacios en la fila y en eleccion.csv.
- `chocolate_negro_85` (O, 22-10-2026): etiqueta Hacendado (608 kcal, grasa 52, sat 33, hidratos 18, azucares 13, fibra 14, proteina 11, sodio 12 mg); resto de USDA 170273 y D, B9, C de CIQUAL/BEDCA (encargo E) sin cambios; mono/poli/trans de USDA (no declarados).
- `yogur_griego_natural` (O, 22-10-2026): etiqueta Hacendado (129 kcal, grasa 10,8, sat 6,7, hidratos 3,9, proteina 3,9, sodio 48 mg, calcio 141); micros base de BEDCA 118 Yogur griego (10 g grasa, 3,6 g proteina: encaja) y huecos de USDA 171284 Yogurt, plain, whole milk (no el griego colado); mono, poli, colesterol y ALA reescalados por la grasa y aminoacidos por la proteina; trans vacio.
- `almendras_crudas` (O, 22-10-2026): etiqueta Almendra natural Hacendado (642 kcal, grasa 54,8, sat 4,2, mono 37,4, poli 13, hidratos 5,9, azucares 5,9, fibra 12,2, proteina 25,2, sodio 8 mg, Fe 4,3, Mg 260, P 460, Ca 240); resto de USDA 170567 (aminoacidos y almidon sin reescalar).
- `avena_copos` (O, 22-10-2026): etiqueta Avena molida Hacendado (384 kcal, grasa 7,1, sat 1,3, hidratos 59,9, azucares 1,0, fibra 10, proteina 12,2); sal < 0,01 g -> sodio 4 mg (tope; USDA daba 6); resto de USDA 173904 sin enriquecer.
- `cacao_polvo` (O, 22-10-2026): etiqueta cacao desgrasado Hacendado alcalinizado (375 kcal, grasa 16, sat 10,2, hidratos 16,3, azucares 0,7, fibra 31,7, proteina 25,5, sodio 12 mg); resto de USDA 169594 (con alcali) en lugar del natural 169593: potasio 1524 -> 2509 mg, cafeina 230 -> 78 mg.
- `aceite_oliva` (O, 22-10-2026): etiqueta Coosur AOVE por 100 ml -> 100 g (densidad 0,91): 903,3 kcal, grasa 100 (91/0,91 exacto, sin pasarse), sat 13,187, mono 78,022, poli 8,791, vitamina E 19,78 mg, ceros reales; resto de USDA 171413 (el AOVE Foundation 748608 trae solo 1/31).
- `semillas_chia` (O, 22-10-2026): etiqueta Hacendado (464 kcal, grasa 34, sat 4, hidratos 2,6, azucares 0,4, fibra 30, proteina 22, sodio 4 mg, ALA 18,9 g declarado fuera de la tabla); resto de USDA 170554. Repaso de lo declarado fuera de la tabla en los anteriores: aplicado (leche B12 y Ca, yogur Ca, almendras Fe/Mg/P/Ca, aceite vitamina E, pan integral mono/poli).
- `crema_cacahuete` (O, 22-10-2026): etiqueta Just Loading (627 kcal, grasa 49,2, sat 6,3, hidratos 16,1, azucares 4,7, fibra 8,5, proteina 26, sodio 20 mg, Mg 168); resto de USDA 172470.
- `arroz_blanco_crudo` (O, 22-10-2026): etiqueta Hacendado (347 kcal, grasa 0,8, sat 0,3, hidratos 78, proteina 6,5); azucares (< 0,5), sal (< 0,5) y fibra (no declarada) conservados de USDA 169756; sin enriquecer.
- `salsa_tomate_frito` (O, 22-10-2026; el id real es `salsa_tomate_frito`, nombre «Tomate frito» y alias intactos): etiqueta Hacendado estilo casero (104 kcal, grasa 5, sat 0,5, hidratos 12,4, azucares 9,7, proteina 2, sodio 320 mg); micros de BEDCA 1759 Tomate frito (6,4 g grasa, mas parecido que la marinara de USDA) y huecos (K, B3, B5, colina, Cu, Mn, ALA) de USDA 171192; mono/poli de BEDCA reescalados por la grasa.
- `salsa_tomate_frito_oliva` (NUEVA, O): Tomate frito con aceite de oliva Hacendado (77 kcal, grasa 3,5, sat 0,3, hidratos 9,5, azucares 6,9, proteina 1,5, sodio 400 mg); mismo origen de micros; grupo propio (el aviso alias_mas_especifico salta si la IA elige el casero para «tomate frito con aceite de oliva»), rol_cena=salsa, sin cantidad_habitual_g. Recuentos de tests: 74 alimentos, 60 a la IA, 63 completos, 51 roles.
- `nueces` (O, 22-10-2026): etiqueta Hacendado (716 kcal, grasa 69,6, sat 6, mono 9,6, poli 53,7, hidratos 2,2, azucares 1,7, fibra 6,2, proteina 17, Fe 2,4, Mg 150, P 349, omega-3 11,2 g -> ala_g); sal 0 = redondeo UE: sodio 2 mg de USDA; resto de USDA 170187.
- `pistachos_tostados_sin_sal` (O, 22-10-2026): etiqueta Hacendado (616 kcal, grasa 52,5, sat 6,5, mono 27,3, poli 18,5, hidratos 11, azucares 11, fibra 11,4, proteina 21,6, Fe 3,2, Mg 110, P 490); sal 0 = redondeo UE: sodio 5 mg (tope; USDA 6); almidon vacio; resto de USDA 170185. `pistachos_crudos` sin tocar.
- `datiles_deglet_noor` (O, 22-10-2026): etiqueta Hacendado sin hueso (296 kcal, hidratos 68, azucares 68, fibra 7,5, proteina 2,2); grasa < 0,5, saturadas/mono/poli 0 y sal 0 de la etiqueta son redondeos UE: se conservan los valores de USDA 171726 (grasa 0,39, sodio 2 mg).
- `muesli` (O, 22-10-2026): etiqueta Muesli Crunchy 0 % azucares anadidos Hacendado (Cerealto Foods): 401 kcal, grasa 12, sat 1,4, mono 9, poli 2,1, hidratos 52, azucares 3,2, fibra 23, proteina 8,8, sodio 32 mg; micros siguen siendo USDA FAMILIA + Mn y B5 de CIQUAL (muesli Bircher): base aproximada, no es el crunchy de Victor, que tiene mucha mas fibra y grasa. BEDCA 1878 Muesli descartado: es un muesli fortificado (D 4,25, B6 1,7, B12 0,85, folato 201, C 51) y la etiqueta no declara vitaminas.
- `pasta_seca` (O, 22-10-2026): etiqueta macarrones Hacendado (361 kcal, grasa 1,5, sat 0,3, hidratos 72, azucares 3,6, fibra 3,5, proteina 13, sodio 4 mg); resto de USDA 168927 sin enriquecer (colina sigue vacia).
- `pavo_fiambre` (O, 22-10-2026): SIN CAMBIOS (sin etiqueta). BEDCA 1699/2286 «Pavo, fiambre» trae 9,4 g de grasa y 15,3 g de proteina (no es una pechuga magra) y le faltan casi todas las vitaminas; se deja USDA «Turkey breast, sliced, prepackaged». Pendiente: etiqueta de Victor.
- `pan_molde_blanco` (O): etiqueta Hacendado (250 kcal, grasa 2,7, sat 0,7, hidratos 46, azucares 3,0, fibra 3,0, proteina 9,0, sodio 480 mg); B1 0,19, B2 0,04, B9 27 y hierro 1,4 de BEDCA 2161 (pan blanco de molde TOSTADO: el sin tostar, 2104, no trae valores); B3 vacia (BEDCA solo da equivalentes); resto de USDA 174924. 30/31.
- `queso_tierno_loncha` (O): etiqueta Hacendado (374 kcal, grasa 32, sat 22, hidratos 0,5, proteina 21, sodio 480 mg, calcio 729); azucares 0 de USDA; base USDA Edam mantenida: BEDCA 2516 «Queso tierno, generico» (25,4 g grasa, 26 g proteina) tampoco encaja y no trae K, B3, B5, colina, Cu ni Mn.
- `huevo` (O, 22-10-2026): porcion `huevo:54` (antes `huevo grande:50`): huevos caseros ecologicos de Victor, 61,4 g con cascara x 0,88 = 54 g comestibles. El 12 % de cascara es el de USDA SR Legacy (huevo entero crudo); la API de FoodData Central no lo publica en la ficha ni esta en la cache (solo `foodPortions`), asi que es el valor del manual SR Legacy: cuadra con USDA (large 50 g comestibles = 57 g con cascara). Nutrientes sin cambios (USDA 171287). Tests: «2 huevos» = 108 g, «un huevo» = 54, cenas con huevo a multiplos de 54.
- `atun_lata_aceite` (O, 22-10-2026): etiqueta Hacendado, columna 60 g escurrido ÷ 0,6: 255 kcal, grasa 18,33, sat 2,83, proteina 21,67, sodio 480 mg (antes 198 kcal, 8,21 g de grasa, 29,1 g de proteina); hidratos/azucares (< 0,5 en 60 g) 0 de USDA; mono/poli del USDA de soja reescalados por la grasa (aproximado: el de Victor es de oliva); aminoacidos y resto de USDA 173708 sin reescalar por la proteina.
- `atun_lata_con_aceite` (receta, O): ingredientes 60 g de atun + 14 g de aceite (antes 20 g), peso final 80 g, campo `etiqueta` con la columna de 100 g neto (352 kcal, grasa 31, sat 4,6, hidratos 0,9, proteina 18, sodio 360 mg). La etiqueta muestra 25 g de grasa en 80 g netos y 11 g en 60 g escurridos: el liquido son ~14 g de aceite y el resto jugo/agua. Antes 369,5 kcal/100 g; ahora 352. Porcion `lata:80` y alias «lata de atún» sin cambios.
- `sardina_lata_aceite` (O, 22-10-2026): etiqueta Hacendado, columna 65 g escurrido ÷ 0,65: 212,3 kcal, grasa 15,08, sat 2,31, proteina 18,46, sodio 683 mg; EPA+DHA 620 mg/100 g neto -> 0,858 g/100 g escurrido (supuesto: casi todo en el pescado), repartido con la proporcion de USDA (EPA 0,413, DHA 0,445); mono/poli reescalados por la grasa; resto de USDA 175139.
- `jamon_cocido` (O, 22-10-2026): etiqueta Hacendado (101 kcal, grasa 2,5, sat 0,9, hidratos 0,9, azucares 0,9, proteina 18,6, sodio 760 mg); base de micros BEDCA 965 «Jamon cocido, categoria s/e» (3 g grasa, 21 g proteina; antes USDA jamon curado con 8 % de grasa): D, B1, B2, B6, B12, B9, Fe, P, K, Zn, Se; huecos de USDA 168295; mono/poli/colesterol/ALA reescalados por la grasa. Termino y fdcId vacios (fila y eleccion.csv).
- `lentejas_secas` (O, 22-10-2026): etiqueta lenteja pardina Hacendado (320 kcal, grasa 1,2, sat 0,2, hidratos 48,1, azucares 1,3, fibra 9,6, proteina 24,5, sodio 20 mg); almidon vacio (el de USDA superaba los hidratos); resto de USDA 172420 (BEDCA 1065 descartada: sodio 227 mg no creible). Receta `lentejas_caseras` recalculada con `recetas.mjs --aplicar`; las demas recetas no cambian.
- `mayonesa` (O, 22-10-2026): Hacendado de girasol (confirmado por Victor). Etiqueta 599 kcal, grasa 65, sat 7,9, hidratos 2,4, azucares 1,3, proteina 0,6, sodio 440 mg; micros base BEDCA 1708 «Mayonesa con aceite de girasol» (A, D, B1, B2, B6, B9, B12, Ca, Fe, Mg, P, K(potasio), Zn); vitamina E, colesterol, mono y poli de BEDCA reescalados por la grasa (x65/75,6). Frente a la de soja de USDA: vitamina E 3,3 -> 13,3 mg. Vitamina K (USDA 163 ug, de soja; BEDCA no la trae) y ALA (USDA 5,3 g, de soja) quedan VACIAS: 29/31. Termino y fdcId vacios.
- `galleta_maria` (O, 22-10-2026): etiqueta Hacendado (443 kcal, grasa 14, sat 1,4, mono 11, poli 1,6, hidratos 71, azucares 20, fibra 2,2, proteina 7,0, sodio 400 mg), porcion `galleta:5,6` (test: 3 galletas = 16,8 g); resto de BEDCA 2675 y USDA 172819 como antes. Duda: colesterol 65,9 y vitamina A 160 vienen de BEDCA/USDA de galleta con mantequilla y no cuadran con una grasa de 1,4 g saturada.
- `galleta_maria` (O): colesterol y vitamina A vaciados a proposito (decision de Victor, 22-10-2026): venian de galleta con mantequilla y no cuadran con una de aceite (sat 1,4 g). 28/31. `mayonesa`: vitamina K y ALA siguen vacias (decision de Victor).
- Correcciones del revisor (22-10-2026): `termino_busqueda_usda` vacio en todas las filas con etiqueta o BEDCA (y termino + fdcId vacios en usda/eleccion.csv); `fdc_id` conservado en la fila donde USDA rellena huecos (yogur, jamon cocido, mayonesa, pan integral, tomates fritos); yogur dha_g 0; tomates fritos: mono/poli derivados del aceite de oliva del catalogo (5 g y 3,5 g por 100 g) y vitamina D 0 de USDA; almendras sin almidon.
- `anacardos` (NUEVO, del iPhone, O): etiqueta Hacendado anacardo natural (604 kcal, grasa 48,2, sat 8,2, mono 31,1, poli 8,8, hidratos 19, azucares 7,7, fibra 3,6, proteina 21,9, Fe 5,3, Mg 250, P 489; sal 0 -> sodio 5 mg tope, USDA 12), almidon vacio; resto USDA 170162. Sin rol_cena; 30/31.
- `bebida_de_avena` (NUEVO, del iPhone, O): etiqueta Hacendado por 100 ml ÷ densidad 1,03 SUPUESTA (sin cifra de fuente): 45,6 kcal, grasa 0,68, hidratos 7,96, azucares 5,24, fibra 0,68, proteina 1,55, sodio 11,65 mg. Antes estaba emparejada con la bebida de arroz de USDA (171942). USDA solo tiene la avena en FNDDS (2705412, estimado, enriquecida): calcio, D, B2, B12 y A vacios (la etiqueta no declara enriquecimiento). 24/31 = 77 %: queda «pendiente de completar». Sin rol_cena.
- `salchichon` (NUEVO, del iPhone, O): casero, estimado con BEDCA 2310 «Salchichon» (419,8 kcal, grasa 34,7, proteina 25,8; el salami italiano de USDA tenia 26 g de grasa); A, D, K, B3, B5, colina, Cu, Mn y aminoacidos de USDA 172966; EPA/DHA/ALA vacios. rol_cena=proteina; 26/31.
- `cafe_expreso` (NUEVO, del iPhone, O): cafe natural Marcilla; se conserva el expreso de USDA 171891 (31/31) y se anota la marca. Sin alias ni porciones (el export no los traia). Sin rol_cena.
- `pan_molde_integral` (NUEVA, O): Hacendado (248 kcal, grasa 3,8, sat 0,7, hidratos 41, azucares 2,5, fibra 7,5, proteina 8,7, sodio 480), porcion `rebanada:32`, alias «pan de molde integral», grupo propio, rol hidrato; micros BEDCA 2164 «Pan integral, de molde, tostado» (no hay sin tostar) y huecos USDA 172688; 31/31. Test: 2 rebanadas = 64 g; con `pan_molde_blanco` salta alias_mas_especifico. Las tres «recetas» de un ingrediente del iPhone (salchichon_2, bebida_de_avena_2, cafe_solo_expreso) NO se copian. Recuentos de tests: 79 alimentos, 65 a la IA, 67 completos, 12 incompletos, 53 roles.
- `cafe_expreso` (O): alias «café|café solo|expreso» y porcion `taza:30` (test: «un café» = 30 g).
- Ronda de menores (O, 22-10-2026): `salsa_tomate_frito` fuente con mono/poli derivados del aceite de oliva; `atun_lata_aceite` sin vitamina K (era de aceite de soja) y la receta `atun_lata_con_aceite` hereda la K sin dato (30/31); `jamon_cocido` colesterol 50 de BEDCA 965; `salchichon` ALA 0,25 (18:3 de BEDCA 2310), D y colina sin dato; `fdc_id` quitado de `salsa_tomate_frito_oliva` y `pan_molde_integral` (queda en la fila por defecto); `galleta_maria` sin grasas trans; textos de tests y notas de anacardos corregidos.
- `queso_fresco` (NUEVO, Q, 22-10-2026): queso fresco Hacendado (etiqueta «queso blanco pasteurizado», tipo Burgos), grupo propio, `procesado`, `incluir=si`, `rol_cena=proteina` (decisión del coordinador), alias «queso fresco» y «queso de burgos», sin porciones. Etiqueta: 157 kcal, grasa 10,9, sat 7,3, hidratos 3,7, azucares 3,7, proteina 11, sodio 372 mg (sal 0,93 ÷ 2,5), calcio 320, fosforo 230. Base de micros BEDCA 2507 «Queso fresco de burgos» (15,4 g grasa, 12,4 g proteina: algo mas graso que la etiqueta; USDA «Cheese, fresh, queso fresco» 172223 tiene 23,8 g y es un queso mexicano, peor): agua, fibra 0, A, C, E, B1, B2, B6, B9, B12, Fe, Mg, K, Zn, Se. Mono, poli, colesterol, A y E de BEDCA reescalados por la grasa (x10,9/15,4); D desde colecalciferol 0,1 de BEDCA (su "Vitamina D" 0 es incoherente), reescalada por la grasa (0,07). Huecos (K vitamina, B3, B5, colina, Cu, Mn, ALA, EPA, DHA) de USDA 172223, reescalados por grasa (x10,9/23,82: K, ALA, EPA, DHA) o proteina (x11/18,09: B3, B5, colina, Cu, Mn). 31/31. Trans, almidon y aminoacidos vacios. Termino USDA vacio; `fdc_id` 172223 porque USDA rellena huecos. Sin fibra declarada en la etiqueta: se usa el 0 de BEDCA. Test: «queso fresco» → `queso_fresco`; `queso_tierno_loncha` (alias «queso») para «queso fresco» salta `alias_mas_especifico`. Pendiente: Victor puede cambiar `rol_cena`; porcion (loncha o unidad) si la quiere.
- `bebida_de_avena` (R, 23-10-2026): 24 -> 29/31, completa. Etiqueta intacta (kcal, macros, mono/poli, fibra, sal; por 100 ml ÷ 1,03). Calcio 1 mg, B5 0,079 mg y manganeso 0,04 mg de CIQUAL 18905 (Oat-based drink, plain, prepacked: sin enriquecer). Vitamina A = 0 (retinol y RAE = 0 en FNDDS 2705412) y B2 = 0,008 mg (FNDDS; nivel natural, un enriquecimiento daria ~0,2): no dependen de la fortificacion. D y B12 siguen vacias: en USDA son de enriquecimiento (D 1,7, B12 0,5 "added") y CIQUAL solo da «<0,25» y «-». CIQUAL «<0,01» de B2 no se usa (no es cifra). Recuentos de tests: 69 completos, 11 incompletos.
- Retirada de 11 alimentos sin datos y con `incluir=no` (S, 23-10-2026), por petición de Victor: `crema_calabacin`, `tortilla_patata`, `repollo_al_horno`, `coca_cola`, `tinto_verano`, `ron`, `lengua_cerdo`, `salsa_cerdo_lata`, `salchicha_desayuno_cerdo`, `yogur_griego_vainilla` y `queso_monterey_jack`. Quitados de `foods.csv`, del fixture `alimentos_iniciales.csv`, de `usda/eleccion.csv` y de `usda/informe.md` (nota); `data/retirados.json` los lista para que la actualización del documento los borre del iPhone. De `data/cenas-semilla.json` se quitaron sus líneas y la cena del 19-sep entera (solo quedaban pan, pepino y pera: sin proteína ni plato); 5 cenas. Los docs de `docs/cenas/` (historia) no se tocan. Catálogo: 69 alimentos, 66 a la IA, 69 completos, 0 incompletos, 50 con `rol_cena`, 3 con `incluir=no` (patata_asada, merluza_cocida, morro_cerdo). Los tests de "sin datos" usan `tests/fixtures/sin_datos.csv` (`foodsConSinDatos` en `helpers.js`).

## Rama `cat/z-huecos-micros` (27-10-2026): huecos de los totales parciales
- **Regla de Victor: B12 y vitamina D = 0 en vegetales sin enriquecer** (como EPA/DHA). Aplicada a `semillas_chia` (D) y `bebida_de_avena` (D y B12); `fuente_usda` lleva «B12/D = 0: vegetal sin enriquecer». Revisado el resto: `corn_flakes` (D vacía, producto enriquecido), `morro_cerdo` y `lentejas_caseras` (animal) se dejan; setas sin tocar.
- `semillas_chia`: B6 0,202 de USDA Foundation 2710819 «Chia seeds, dry, raw»; A (RAE) 0, K 3,7 y colina 78,7 de USDA FNDDS 2707590 (estimado: ni SR Legacy 170554 ni Foundation 2710819 los traen; SR 170554 da 54 UI de vitamina A, sin retinol ni RAE). B5 sigue vacía (ni FNDDS, ni BEDCA, ni CIQUAL 15047). Pendiente de Victor: si no quiere valores FNDDS, vaciar esas tres celdas.
- `bebida_de_avena`: D y B12 = 0 (regla de Victor: vegetal sin enriquecer); los de USDA (1,7 y 0,5) son de enriquecimiento y no se usan.
- `salchichon`: azúcares 0,26, EPA 0,004, DHA 0,007, D 0,9 y colina 72,6 de USDA 174582 «Salami, dry or hard, pork, beef» (SR Legacy; BEDCA 2310/2084/1748 no los trae). Azúcares (USDA) + almidón (BEDCA) superan los hidratos de BEDCA (2 g) por mezclar fuentes.
- `chorizo`: azúcares 0 (USDA 173859, SR Legacy) y B5 1,011 (USDA 174582, salami curado, análogo al chorizo español curado; se descarta Foundation 746781, chorizo fresco frito). `lentejas_caseras` recalculada con `recetas.mjs --aplicar` (lleva chorizo).
- `anacardos` colina 58,83 (estimado: escalado por agua desde USDA 170571, tostado sin sal, 61 mg × (100−5,2)/(100−1,7), con el agua de 170162 crudo). USDA da la misma colina (52,1) en la almendra cruda 170567 y tostada 170158, así que tostar no la cambia salvo por el agua.
- `pan_blanco_barra` B3 2,142 de USDA 172816 «Bread, pita, white, unenriched» (SR Legacy; pan blanco de harina sin enriquecer). USDA sí tiene pan blanco sin enriquecer: la pita 172816. BEDCA 2160 solo da equivalentes de niacina (sin triptófano) y CIQUAL siguió con 503.
- Siguen vacíos: `chocolate_negro_85` colina (USDA 170273/170272/170271 no la traen) y `semillas_chia` B5.
