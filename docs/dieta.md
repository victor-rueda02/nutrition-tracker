# Dieta fija de Victor (lunes a viernes)

Qué es, cómo se calcula y cómo se mantiene. Léelo antes de tocar `data/dieta.json`, el plan de objetivos o cualquier
alimento que use la dieta. Estado a 12-11-2026.

## Dónde vive

- **`data/dieta.json`** (versión 2; formato en `data/SCHEMA.md`): una versión por periodo del plan de objetivos
  (`volumen_p20_rutina_nov`, `volumen_p19`, `volumen_p18`, `volumen_p17`, `volumen_p16`), cada una con el menú normal de
  lunes a viernes y el de descanso (`tipos.descanso`). Más un `dias` en la raíz (= p20 normal) para apps antiguas.
- **En la app**: Diario → tres puntos → «Copiar dieta del día» (`elegirMenu` en `frontend/js/core/dieta.js`): con la fecha
  del Diario elige el periodo del plan y, si el día es de descanso (por la semana o por una excepción como «Hoy es:
  Descanso»), su menú de descanso. Se puede ir a días futuros para prepararlos. Sábado, domingo, vacaciones y Navidad no
  tienen menú.
- **El plan de objetivos está en el iPhone** (ajuste `plan_objetivos`; se exporta e importa en Objetivos). La última
  versión preparada fuera de la app es la del 11-11-2026 (`nutritiontracker-objetivos-2026-11-11.json`). Si se pierde, se
  rehace con lo de abajo.
- **Página de la dieta** (privada, en claude.ai): menús de cada día, plan de cocina, compra, congelador y todas las
  versiones. El enlace está en la memoria del coordinador; se actualiza a mano cuando cambia la dieta.

## Plan de objetivos (resumen)

| Periodo | Desde → hasta | Peso | Proteína (objetivo) |
|---|---|---|---|
| `volumen_p20` | 26-10 → 01-11-2026 | 73,7 kg | 2,0 g/kg |
| `volumen_p20_rutina_nov` | 02-11 → 22-11-2026 | 73,9 kg | 2,0 g/kg (≈ 148 g) |
| `volumen_p19` | desde 23-11-2026 | 74 kg (estimado) | 1,9 g/kg |
| `vacaciones_dic` | 12-12 → 20-12-2026 | 74,2 kg | solo mínimo 1,6 g/kg |
| `navidad` | 24-12-2026 → 11-01-2027 | 74,4 kg | solo mínimo 1,6 g/kg |
| `volumen_p18` | desde 12-01-2027 | 74,5 kg | 1,8 g/kg |
| `volumen_p17` | desde 08-02-2027 | 74,8 kg | 1,7 g/kg |
| `volumen_p16` | desde 08-03-2027 | 75,2 kg | 1,6 g/kg |

- Rutina (desde el 02-11): lunes, martes, jueves, viernes y sábado **fuerza** (3700 kcal, hidratos 57 %); miércoles y
  domingo **carrera** (3600 kcal, 56 %); **descanso** 3300 kcal (55 %), solo para días sin entreno. Todos los periodos:
  proteína mínimo 1,6 g/kg, grasa 25-30 % de las kcal, fibra ≥ 35 g, saturadas ≤ 10 % (meta de Victor ≈ 8 %).
- Excepciones: del 17 al 22-11-2026, descanso (decisión de Victor; el motivo está en la memoria privada del coordinador). Los pesos de p19 en adelante son estimados: se
  cambian en Objetivos cuando Victor tenga la media real («desde hoy» crea un tramo `<periodo>_AAAAMMDD`, que la dieta
  sigue reconociendo).

## Reglas con que se calcula (las de `scripts/dieta/reglas-optimizador.mjs`)

- Nutrientes siempre desde `data/foods.csv` (valor por 100 g × gramos / 100); celda vacía = sin dato. Pesos en crudo y
  sin hueso, salvo recetas (plato cocinado) y latas (escurrido).
- Por día: kcal ±5 % del objetivo del tipo (en la práctica ±1-3 %); proteína entre el objetivo y el 110 %; grasa 25-30 %;
  hidratos 90-110 % del objetivo; fibra ≥ 35 g; saturadas ≤ 10 %; sodio ≤ 2000 mg; B1, B3 y ALA por energía; mínimos
  EFSA de vitamina C, B2, B5, B6, B9, colina, calcio, hierro, magnesio, fósforo, potasio, zinc, cobre y manganeso; nunca
  por encima de un UL.
- Por semana (media de lunes a viernes): vitaminas A, D, E, K y B12, EPA+DHA y selenio (`comprobar.mjs` las enseña). La vitamina D se queda en
  ≈ 9 µg/día: la cubre el suplemento (no se cuenta en la app).
- Azúcares por encima de 90 g (fruta entera): aceptado.
- Sin totales parciales: todos los alimentos de la dieta tienen sus 31 nutrientes obligatorios (algunos estimados; ver
  `docs/notas-catalogo.md`, ramas AK, AM y AM2).

## Estructura de la semana (p20 normal; las demás versiones mueven gramos y en p17 y p16 quitan el pollo del jueves y del viernes)

- **Fijos**: desayuno avena 90 + cacao 5 + bebida de avena 300 + crema de cacahuete 10; almuerzo (dentro del desayuno en
  la app) pan integral 70 con tomate natural 60 y aceite, almendras 15, anacardos 10 y una mandarina; merienda corn flakes,
  muesli 25, bebida de avena 300, manzana 150 y plátano 100. Postre de la comida: yogur griego ligero 125, chía 3,
  chocolate 85 % 8 y kiwi 100. Postre de la cena: yogur ligero 125, chía 3, dátiles y, según el día, nueces o almendras.
- **Lunes**: táper de lentejas caseras 625 g + arroz; cena patata, verduras asadas, zanahoria, 2 huevos y atún (1 lata).
- **Martes**: arroz con verduras asadas, pollo y tomate frito; cena patata y salmón 200 g.
- **Miércoles** (carrera): arroz, verduras asadas, pollo 200 y tomate frito; cena macarrones con salteado de verduras,
  2 huevos y tomate frito.
- **Jueves**: arroz con lentejas (lentejas secas, zanahoria, cebolla, pimiento rojo); cena patata, verduras, 2 huevos,
  atún (1 lata), pollo y tomate frito.
- **Viernes**: arroz, verduras asadas, pimiento rojo, pollo, 2 huevos y tomate frito; cena patata y sardinillas reducidas en sal 130 g.

## Decisiones de Victor (no cambiarlas sin preguntar)

- Excluidos: jamón, pavo y pollo cocido o en fiambre. Queso y embutido, poco. El chocolate se queda.
- Pescado azul: salmón un solo día (200 g); otro día, sardinillas reducidas en sal Hacendado. Atún claro en aceite de
  oliva Hacendado: como mucho 2 latas a la semana (mercurio; desde p18, 1). Chía: como mucho 3 g por comida.
- 8 huevos a la semana; avena, legumbres y nueces se mantienen.
- Lunes: táper de lentejas caseras (625 g; desde p18, 500 g y sin atún). Martes: el pollo puede bajar hasta 30 g.
- Envases que se estropean, enteros en la semana: bebida de avena 600 ml/día (3 briks de 1 L; aguanta 3 días abierta),
  bote de tomate frito de 380 g entre martes y viernes (aguanta 5 días), pimiento rojo entero (jueves y viernes).
- Aceite: Victor lo echa con pulverizador. Al hablarle de aceite, en **flus** (1 flus ≈ 0,3 g, provisional; porción
  `flus` del aceite). `dieta.json` sigue en gramos.
- No añadir sal donde ya hay tomate frito o lentejas caseras (sodio).
- Alimentos nuevos para la dieta, solo con su OK.

## Mantenerla

- Después de cambiar el catálogo: `node scripts/dieta/comprobar.mjs` (la dieta publicada contra las reglas con el
  catálogo actual). Si algo falla, ajustar gramos o regenerar.
- Para cambiar la dieta: edita la semana base (`scripts/dieta/semana-base.mjs`: alimentos fijos y palancas con su
  rango) o las versiones y tipos (`reglas-optimizador.mjs`, que copia el plan del iPhone), y luego
  `node scripts/dieta/generar.mjs` (enseña cada día) y `--escribir` (escribe `data/dieta.json`). p20 normal no se
  reoptimiza: es la semana que Victor sigue. Regenerar con el catálogo de otro día puede mover unos gramos de los menús
  que no son fijos (p. ej. tras las estimaciones AM y AM2, p16 lunes de descanso): revisa el diff antes de publicar. `npm test` valida el fichero; después, `git push`.
- Al cambiar la dieta, actualizar también la página privada (memoria del coordinador).
