# Cenas registradas en Cronometer (17-25 sep 2026)

Referencia de lo que suelo cenar, sacada de mi export de Cronometer (7 días con cena registrada). El detalle línea a línea está en `cenas-cronometer.csv` (fecha, alimento de Cronometer, cantidad, id de mi catálogo, nota).

Úsalo como **semilla** de cenas habituales mientras el diario de la app no tenga suficiente historial propio. Cuando lo tenga, el historial real de la app manda.

## Cenas por día
| Día | Cena |
|---|---|
| 17-sep | Merluza 230 g + arroz 150 g + tomate frito 150 g + aceite + pavo en lonchas 40 g · postre: yogur griego + chía + manzana |
| 18-sep | Salida (tinto de verano, ron, Coca-Cola): **no es cena habitual, ignorar** |
| 19-sep | Tortilla de patata (2 raciones) + pan 50 g + pepino + crema de calabacín 300 g · postre: pera + yogur griego de vainilla |
| 21-sep | Crema de calabacín 250 g + arroz 175 g + huevo + tomate frito 93 g + nueces · postre: yogur griego + chocolate 85 % + kiwi |
| 22-sep | Salmón 178 g + pan de molde (3 rebanadas) + zanahoria + aceite · postre: yogur griego + chía + nueces + chocolate 85 % + kiwi |
| 23-sep | Pasta 150 g + atún 60 g + tomate frito 41 g + queso en loncha · postre: yogur griego + chía |
| 24-sep | Verduras asadas (calabacín, berenjena, cebolla, pimientos) + patata + sardinas 65 g + aceite + pan 167 g + queso · postre: yogur griego + chía |

## Patrones
- **Postre casi fijo:** yogur griego natural (125 g) con chía (3-5 g); a menudo chocolate negro 85 %, nueces y una fruta (kiwi, manzana o pera).
- **Proteína:** pescado (merluza, salmón, atún, sardinas), huevo o pavo.
- **Hidrato:** arroz (150-175 g en crudo), pasta (150 g en crudo) o pan.
- **Verdura:** crema de calabacín, verduras asadas, zanahoria o pepino.
- **Salsa y grasa:** tomate frito y aceite de oliva.

## Notas
- En Cronometer pesaba la merluza cocida y la patata asada; ahora todo se pesa **en crudo** (ids `merluza_cruda` y `patata_cruda`).
- `crema_calabacin` y `tortilla_patata` son recetas aún sin datos; `yogur_griego_vainilla` y `queso_monterey_jack` están excluidos (`incluir=no`): no proponerlos mientras sigan así.
- Los ids son los de mi catálogo en la fecha de este documento; si alguno no existe en `data/foods.csv`, buscar el equivalente actual (por ejemplo, el pan de barra).
