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
