# ¿Qué ceno? — Registro de revisión

## Ronda 1 — CAMBIOS

Revisado sobre `dc7d583` (diff `d24a028..dc7d583`). `npm test`: 452/452 en verde (ejecutado por el revisor). `npm run worker:check` según el ejecutor.

**Comprobado por el revisor**
- Reglas de CLAUDE.md: nutrientes solo desde el documento con `sumLines`; la IA solo propone ids y gramos (`cenas-validate.js` descarta ids que no se enviaron, gramos ≤ 0 o > `MAX_GRAMS` y cenas sin proteína); a Gemini viajan solo `alimentos` (lista compacta sin `incluir=no` ni sin datos) y `deficits` (nombres sin dígitos, ≤ 8; el Worker devuelve 400 si traen cifras); sin claves; rutas con `readFile` de `tests/helpers.js` (regla 8); sin dependencias nuevas; `sw.js` en `nt-v14` con los ficheros nuevos; `cenas.css` tras `navegacion.css`.
- Verificación a mano con `data/foods.csv` (columnas `energia_kcal` y `proteina_g` leídas del CSV, no con `sumLines`): en un día típico (1.515 kcal registradas, referencia de 2.000 kcal, R = 485) las 3 propuestas coinciden al céntimo. Por ejemplo, «Tu receta Lentejas caseras»: lentejas 180 g + yogur 125 g + chía 3 g + chocolate 10 g + nueces 10 g + kiwi 69 g = 485,85 kcal y 27,86 g de proteína (motor y cálculo a mano). También coinciden en el día vacío y en el día en que te pasas.
- Casos límite probados con datos: día vacío, día con 358 kcal de más (modo cubierto, aviso de UL de selenio ya superado), sin plan (aviso `sin_plan`), semilla con 0 días de historial, descartes (crema de calabacín, Monterey Jack, tortilla y yogur de vainilla, con su motivo).
- Capturas a 375 px, en claro y en oscuro (Diario con la tarjeta de Cena, menú de los tres puntos, pantalla «¿Qué ceno?» y confirmación): `scrollWidth` = 375 en todas, solo tokens, la barra inferior no tapa nada (`padding-bottom` 120 px), Diario activo. Entradas correctas: botón solo en la tarjeta de Cena y entrada en los tres puntos.
- Los 17 criterios tienen test; los fallos de abajo son de comportamiento con los datos reales que los criterios no detectaban (dos vienen de huecos de la ESPEC, ya corregida: §6.1, §6.2, §6.3, §10 y criterios 18-20).

**Correcciones** (en orden de prioridad)

1. **BLOQUEANTE — La cena no puede intentar cubrir el día entero** (`core/cenas.js`, `ajustar`/`proponerCenas`). Con el día vacío propone una cena de 1.972 kcal (salmón 265 g + arroz 225 g + pavo 60 g + …). Esperado (ESPEC §6.3, actualizada): `E* = min(R, 0,45 × meta_kcal, kcal con factores 1,5)` (`CENA_MAX_FRAC = 0.45`). Cuando `R` supera ese tope y el día no está vacío, aviso `cena_tope` con el texto de la ESPEC. Tests: criterio 18 (día vacío y meta de 2.000 → ninguna propuesta pasa de 900 + margen; aviso `cena_tope` con un día de 600 kcal registradas).
2. **BLOQUEANTE — Verdura añadida absurda y «verdura cruda» que no se come cruda** (`core/cenas.js` `completar`, `habitualesDe`, `candidatosLigeros`, `opcionesMuyLigeras`; `data/cenas-semilla.json`). Hoy se añade «Berenjena cruda 25 g · añadida para completar» (gana el empate por id) y, con el día pasado, se ofrece «Solo si te apetece: verdura cruda — berenjena 25 g». Esperado (ESPEC §6.1-§6.2):
   - «más habitual» = más cenas; empate, más gramos habituales; empate, id;
   - verdura añadida con `max(gramos habituales, 100)` g (`VERDURA_COMPLETAR_G`);
   - nueva clave `crudas: ["pepino", "zanahoria"]` en la semilla; la «verdura cruda» de los modos cubierto y ligero sale solo de ahí.
   Tests: criterio 19.
3. **BLOQUEANTE — «Más ideas» gasta cuota cuando el resultado no se puede usar** (`ui/cenas-screen.js`). En los modos ligero y cubierto el botón está activo, pero `proponerCenas` solo procesa `ideasIA` en modo normal: se gasta una llamada para nada (regla 10). Esperado: el botón solo aparece en modo normal o en `sin_candidatos` con R ≥ 400 (ESPEC §6.1). Test: criterio 20 (en ligero y cubierto no hay botón y `ideasCena` no se llama).
4. **MENOR — Huevo en fracciones** (`core/cenas.js`, `gramosEscalados`). Sale «Huevo entero crudo 40 g». Esperado (ESPEC §6.3): una proteína con porción en el catálogo se redondea a un número entero de su primera porción (huevo: 50, 100, …; mínimo 1). Test con el huevo.
5. **MENOR — `docs/cenas/notas.md`, regla 6.** Falta la redacción literal de Victor. Pon primero esta, citada tal cual: «A Gemini viajan mi frase o la lista compacta del catálogo y, en '¿Qué ceno?', solo los nombres de los nutrientes con déficit; nunca cantidades, nutrientes por alimento ni el diario». Después puede ir tu versión ampliada como nota técnica (≤ 8 nombres, sin cifras, alimentos sin datos fuera de la lista). Esa redacción no estaba en la ESPEC: no es fallo tuyo.
6. **MENOR — Textos** (`core/cenas.js`, `ui/cenas-screen.js`):
   - Con 0 días de historial, el aviso `semilla` dice «Aún tienes 0 días con cena en la app». Debe decir «Aún no tienes cenas en la app: uso tus cenas de Cronometer.» (con N ≥ 1, el texto actual).
   - El yogur y la chía del postre habitual llevan la etiqueta «añadida para completar». Pon «postre habitual»; «añadida para completar» queda solo para la verdura y el hidrato.
   - En la confirmación, `source_text` sale con comillas anidadas («¿Qué ceno?: Tu receta «Lentejas caseras»»). Usa `¿Qué ceno? · <origen>` y pasa los tests que lo comprueben.

**Siguiente ronda**: corregir 1-6 con sus tests y actualizar `notas.md` (y el comentario de `ESPEC` §6 si cambia alguna constante). Sin llamadas reales a Gemini en esta ronda: la prueba real de `/cenas` la hace el revisor al final.

## Ronda 2 — CAMBIOS

Revisado sobre `6ef8ec4` (diff `578a81e..6ef8ec4`). `npm test`: 460/460 (0 omitidos; los de UI corren con jsdom). `npm run worker:check`: correcto.

**Comprobado por el revisor**
- Las 6 correcciones de la ronda 1 están hechas y con test:
  - tope de cena: con el día vacío salen 903, 760 y 885 kcal; con 380 kcal registradas sale `cena_tope` «propongo como mucho 900 kcal»;
  - zanahoria 100 g como verdura añadida y `crudas` en la semilla; con el día pasado, «zanahoria 61 g»;
  - «Más ideas» oculto y bloqueado en los modos ligero y cubierto;
  - huevo en porciones enteras de 50 g;
  - redacción literal de Victor en `notas.md`;
  - textos y etiquetas.
- Verificación a mano con `data/foods.csv` (columnas del CSV, sin `sumLines`) en 5 días (típico, vacío, 380 kcal registradas, ligero y pasado): las 12 propuestas coinciden exactamente en kcal y proteína. Por ejemplo, en el modo ligero (R = 172), «Cena ligera: merluza con zanahoria» = merluza 105 g + zanahoria 100 g + aceite 5 g = 171,30 kcal y 19,83 g de proteína.
- Acepto la interpretación del límite (`T + margen`, con T el tope de cena) y el `source_text` nuevo: la ESPEC (§6.3 y §9) ya lo recoge.

**Correcciones**

1. **BLOQUEANTE — Menos de 3 propuestas en un día normal** (`core/cenas.js`). En el día típico (R = 485, criterio 21) solo salen 2: lentejas y la variante del 23-sep. Las cenas de la semilla se descartan porque su parte fija ya no cabe. Por ejemplo, la del 22-sep: yogur, chía, chocolate, nueces, kiwi, aceite y zanahoria suman 372 kcal fijas, y con salmón y pan al mínimo pasa de 710 kcal. Esperado (ESPEC §6.3, actualizada):
   - **a.** `salsa` escala con `fh`.
   - **b.** Si no cabe, se quitan uno a uno el chocolate, las nueces y la fruta que traiga la cena de origen (nunca el yogur ni la chía), hasta que quepa. Se anota en `quitados` y la tarjeta muestra «Sin … para que quepa».
   - **c.** Si aun así quedan menos de 3, se completa con candidatos del modo ligero ajustados con el escalado normal y `E*`.
   Tests: criterios 21 y 22 (el día del criterio 21 es exactamente el de arriba).
2. **MENOR — `notas.md`**: añade las constantes nuevas (`CENA_MAX_FRAC`, `VERDURA_COMPLETAR_G`, `crudas`) y lo de esta ronda a la propuesta de CLAUDE.md, si cambia algo.

**Siguiente ronda**: la corrección 1 (a, b y c) con sus tests. Sin llamadas reales a Gemini.

## Ronda 3 — CAMBIOS (solo un MENOR)

Revisado sobre `230a650` (diff `081ef09..230a650`). `npm test`: 466/466, 0 omitidos.

**Comprobado por el revisor**
- Corrección 1 (a, b, c) y 2 hechas y con test. En el día del criterio 21 (R = 485) salen 3 propuestas, todas dentro del límite:
  - lentejas, 485,85 kcal;
  - 22-sep con sardina y sin chocolate, 515,43 kcal;
  - 21-sep con pan de molde, huevo 50 g y tomate frito escalado a 60 g, 490,94 kcal.
- Verificación a mano con `data/foods.csv` en 5 días (típico, vacío, 380 kcal registradas, ligero y pasado): las 13 propuestas coinciden exactamente en kcal y proteína.
- **Gemini real** (revisor, 2 llamadas de las 15). Prueba de `POST /cenas` con el código del Worker y el día del criterio 21:
  - viajaron solo `alimentos` (57, con id, nombre, alias, porciones, estado, grupo y defecto, sin nutrientes) y `deficits` (8 nombres sin cifras: «Vitamina D», «EPA y DHA», «Vitamina A», «Cobalamina», «Ácido alfa-linolénico», «Calcio», «Potasio», «Cobre»);
  - la 1.ª llamada recibió un 503 de Google y el Worker devolvió `google_caido` (mi script inyectaba `callGemini` sin el envoltorio de reintento, como hace `dev-server.mjs`); la 2.ª, por el camino de producción (`defaultCallModel`), devolvió 5 cenas, todas con ids del catálogo y yogur griego de postre;
  - el motor las reescaló y enseñó 2 que caben («Sardinas con arroz y pimiento» 510,6 kcal; «Merluza con calabacín y patata» 509,0 kcal); las 3 propuestas de siempre no cambian.
- Capturas a 375 px en claro y oscuro: sin scroll horizontal, 3 tarjetas, etiquetas y avisos «Sin … para que quepa» legibles, barra inferior con Diario activo.
- Acepto que `seQuedaCorta` se compare con `min(R, tope) × 0,9` y que las cenas ligeras de relleno no lleven yogur (el criterio 9 es para las normales).

**Correcciones**

1. **MENOR — Quitar para que quepa y luego añadir extras es incoherente** (`core/cenas.js`, `conExtras`). La cena del 17-sep sale con «Sin manzana cruda con piel para que quepa» (62 kcal) y, a la vez, con chocolate 10 g y nueces 10 g añadidos por el motor (125 kcal). Esperado: si `ajustar` tuvo que quitar algo del candidato (`quitados` no vacío), `conExtras` no prueba extras de postre para ese candidato. Test de regresión con esa cena (la del 17-sep en el día de 1.337 kcal de las capturas, o uno sintético equivalente): con `quitados` no hay ninguna línea `extra`.

**Siguiente ronda**: solo la corrección 1 con su test. Sin llamadas reales a Gemini.
