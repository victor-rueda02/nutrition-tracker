# Plan de objetivos: formato

El plan de objetivos es un documento JSON tuyo, como el catálogo de alimentos: lo escribes a mano o con otro
asistente, lo importas en la app (Objetivos → «Importar plan») y lo exportas de vuelta («Exportar plan»). La app lo
guarda en el dispositivo y lo lleva en la copia de seguridad del diario.

Dice qué objetivos de kcal, macros y micronutrientes tienes **cada día**: por periodos (con fecha de inicio y fin
opcional), con tipos de día (entreno, descanso…) asignados por día de la semana y con excepciones por fecha concreta.
Lo que el plan no define usa las referencias EFSA/UE de `data/targets.json`.

Cada día del diario se evalúa con los objetivos que el plan da para **ese día**, no con los de hoy.

## Ejemplo completo

```json
{
  "tipo": "plan_objetivos",
  "version": 1,
  "nombre": "Plan 2026-27",
  "perfil": "hombre",
  "periodos": [
    {
      "id": "volumen_otono_2026",
      "nombre": "Volumen otoño 2026",
      "inicio": "2026-09-15",
      "fin": "2026-12-20",
      "peso_kg": 74,
      "nota": "Superávit moderado, 4 días de fuerza",
      "valores": {
        "energia_kcal": { "objetivo": 2900 },
        "proteina_g": { "unidad": "g/kg", "min": 1.8, "objetivo": 2.0 },
        "grasa_total_g": { "unidad": "%kcal", "min": 25, "max": 35 },
        "hidratos_g": { "objetivo": 380 },
        "fibra_g": { "min": 30 },
        "vitamina_d_ug": { "min": 20 },
        "sodio_mg": { "max": 2300 }
      },
      "tipos": {
        "entreno": {
          "nombre": "Entreno",
          "valores": {
            "energia_kcal": { "objetivo": 3100 },
            "hidratos_g": { "unidad": "g/kg", "objetivo": 5.5 }
          }
        },
        "descanso": {
          "nombre": "Descanso",
          "valores": {
            "energia_kcal": { "objetivo": 2700 },
            "hidratos_g": { "objetivo": 300 }
          }
        }
      },
      "semana": {
        "lun": "entreno", "mar": "descanso", "mie": "entreno", "jue": "descanso",
        "vie": "entreno", "sab": "descanso", "dom": "descanso"
      }
    },
    {
      "id": "navidad_2026",
      "nombre": "Navidad",
      "inicio": "2026-12-21",
      "fin": "2027-01-06",
      "peso_kg": 76,
      "valores": {
        "energia_kcal": { "unidad": "kcal/kg", "objetivo": 36 },
        "proteina_g": { "unidad": "g/kg", "min": 1.6 }
      }
    },
    {
      "id": "mantenimiento_2027",
      "nombre": "Mantenimiento",
      "inicio": "2027-01-07",
      "peso_kg": 76,
      "valores": {
        "energia_kcal": { "unidad": "kcal/kg", "objetivo": 34 },
        "proteina_g": { "unidad": "g/kg", "min": 1.6, "objetivo": 1.8 },
        "grasa_total_g": { "unidad": "%kcal", "objetivo": 30 },
        "hidratos_g": { "unidad": "%kcal", "objetivo": 50 }
      },
      "tipos": {
        "entreno": { "nombre": "Entreno", "valores": { "hidratos_g": { "unidad": "%kcal", "objetivo": 55 } } }
      },
      "semana": { "lun": "entreno", "mie": "entreno", "vie": "entreno" }
    }
  ],
  "excepciones": [
    { "fecha": "2026-10-22", "tipo": "entreno", "nota": "Cambié el entreno del viernes al jueves" },
    { "fecha": "2026-10-23", "tipo": "descanso" },
    {
      "fecha": "2026-12-24",
      "nota": "Nochebuena",
      "valores": { "energia_kcal": { "max": 3500 }, "sodio_mg": null }
    }
  ]
}
```

## Segundo ejemplo: semana con tres tipos de día

Puedes tener tantos tipos como quieras; la app los lista todos en «Hoy es», en la edición y en el Diario. Aquí, una
semana de fuerza de lunes a viernes, recuperación (RH + movilidad) el sábado y descanso el domingo; las kcal y los
macros cambian por tipo y el resto sale del periodo o de la referencia:

```json
{
  "tipo": "plan_objetivos",
  "version": 1,
  "nombre": "Semana de fuerza",
  "perfil": "hombre",
  "periodos": [
    {
      "id": "fuerza_2026",
      "nombre": "Fuerza otoño 2026",
      "inicio": "2026-10-19",
      "peso_kg": 75,
      "valores": {
        "proteina_g": { "unidad": "g/kg", "min": 1.8 },
        "fibra_g": { "min": 30 },
        "magnesio_mg": { "min": 400 },
        "vitamina_d_ug": { "min": 20 }
      },
      "tipos": {
        "fuerza": {
          "nombre": "Fuerza",
          "valores": {
            "energia_kcal": { "objetivo": 2900 },
            "hidratos_g": { "unidad": "g/kg", "objetivo": 5 },
            "grasa_total_g": { "unidad": "%kcal", "min": 25, "max": 30 }
          }
        },
        "rh_movilidad": {
          "nombre": "RH + movilidad",
          "valores": {
            "energia_kcal": { "objetivo": 2600 },
            "hidratos_g": { "unidad": "g/kg", "objetivo": 4 }
          }
        },
        "descanso": {
          "nombre": "Descanso",
          "valores": {
            "energia_kcal": { "objetivo": 2400 },
            "hidratos_g": { "unidad": "g/kg", "objetivo": 3 },
            "grasa_total_g": { "unidad": "%kcal", "min": 30, "max": 35 }
          }
        }
      },
      "semana": {
        "lun": "fuerza", "mar": "fuerza", "mie": "fuerza", "jue": "fuerza", "vie": "fuerza",
        "sab": "rh_movilidad", "dom": "descanso"
      }
    }
  ],
  "excepciones": []
}
```

El sábado 24-10-2026, por ejemplo: «RH + movilidad», 2600 kcal, hidratos 4 g/kg × 75 = 300 g, proteína al menos
135 g (del periodo) y grasa, la referencia EFSA (70 g), porque ese tipo no la define.

## Empezar desde la app: «Crear plan»

Si no tienes plan, Objetivos → «Crear plan» genera uno con:

- un periodo «Mis objetivos» abierto desde hoy, con tu perfil y **todos** los valores de referencia de
  `data/targets.json` escritos de forma explícita (kcal, macros y los 31 micronutrientes; B1, niacina y ALA ya
  calculados con las 2000 kcal de referencia, así que no cambian si cambias las kcal);
- los tipos `fuerza` («Fuerza», de lunes a viernes), `rh_movilidad` («RH + movilidad», sábado) y `descanso`
  («Descanso», domingo), cada uno con las kcal, proteína, hidratos y grasa de referencia, para que pongas las tuyas.

Desde ahí, ajusta las kcal de cada tipo en la pantalla o exporta el plan y edítalo como plantilla.

## Campos

### Raíz

| Campo | Obligatorio | Qué es |
|---|---|---|
| `tipo` | sí | Siempre `"plan_objetivos"`. |
| `version` | sí | Siempre `1`. |
| `nombre` | no | Nombre del plan, para reconocerlo en la app. |
| `perfil` | no | Perfil de las referencias EFSA para lo que el plan no define: `"hombre"` (por defecto) o `"mujer"`. |
| `periodos` | sí | Lista de periodos (puede estar vacía). |
| `excepciones` | no | Lista de días concretos con cambios. |

### Periodo

| Campo | Obligatorio | Qué es |
|---|---|---|
| `id` | sí | Identificador único, sin espacios (`volumen_otono_2026`). |
| `nombre` | sí | Lo que verás en la app y en el Diario. |
| `inicio` | sí | Primer día, `AAAA-MM-DD`. Dos periodos no pueden empezar el mismo día. |
| `fin` | no | Último día (incluido), `AAAA-MM-DD`. Sin `fin`, el periodo sigue hasta que empiece otro. |
| `peso_kg` | si usas `g/kg` o `kcal/kg` | Tu peso en ese periodo. |
| `valores` | no | Objetivos por defecto del periodo (ver «Objetivo de un nutriente»). |
| `tipos` | no | Tipos de día del periodo: `{ "clave": { "nombre": "…", "valores": { … } } }`. La clave es libre (`entreno`, `descanso`, `pierna`, `refeed`…). |
| `semana` | no | Qué tipo toca cada día de la semana: claves `lun`, `mar`, `mie`, `jue`, `vie`, `sab`, `dom` (también valen `lunes`, `miércoles`, `sábado`…). Un día que no aparece no tiene tipo y usa los valores por defecto del periodo. |
| `nota` | no | Texto libre. |

Cada periodo define sus propios tipos: «entreno» puede tener valores distintos en volumen y en mantenimiento.

### Excepción

| Campo | Obligatorio | Qué es |
|---|---|---|
| `fecha` | sí | El día, `AAAA-MM-DD`. Una sola excepción por fecha. |
| `tipo` | no | Cambia el tipo de ese día (un entreno movido). Tiene que existir en el periodo vigente ese día. |
| `peso_kg` | no | Peso de ese día, para `g/kg` y `kcal/kg`. |
| `valores` | no | Objetivos solo para ese día. |
| `nota` | no | Texto libre. |

El selector «Hoy es: Entreno / Descanso» de la pantalla Objetivos escribe una excepción con solo `fecha` y `tipo`.

### Objetivo de un nutriente

La clave es la columna del nutriente en tu documento de alimentos (`energia_kcal`, `proteina_g`, `vitamina_b12_ug`,
`magnesio_mg`… cualquiera de `data/nutrients.json`) o `epa_dha` (EPA + DHA sumados). El valor es un objeto con
al menos uno de estos límites:

| Límite | Significado | En el Diario |
|---|---|---|
| `min` | al menos | por debajo hasta llegar a `min` |
| `objetivo` | acercarse | sin `min`/`max`: en objetivo entre el 90 % y el 110 % |
| `max` | como mucho | por encima si pasa de `max` |

Se pueden combinar: `{ "min": 25, "max": 35 }` es un rango; `{ "min": 1.8, "objetivo": 2.0 }` es «al menos 1,8 y
mejor 2,0» (en objetivo desde `min` hasta el 110 % del objetivo). Tiene que cumplirse `min ≤ objetivo ≤ max`.

`null` en lugar del objeto quita el objetivo de ese nutriente ese día o en esa capa (ver prioridad): `"sodio_mg": null`.
Un número suelto (`"fibra_g": 30`) **no** vale: escribe `{ "min": 30 }` o `{ "objetivo": 30 }`.

El UL de la EFSA (máximo tolerable) no forma parte del plan: siempre sale de `data/targets.json` y el Diario avisa
aparte si se supera, aunque cumplas tus objetivos.

### Unidades (`unidad`)

`unidad` es opcional y vale para todos los límites de esa entrada.

| `unidad` | Para | Cálculo |
|---|---|---|
| (sin `unidad`) | todos | La unidad de la columna: `kcal`, `g`, `mg` o `µg` (`_ug`). |
| `"kcal/kg"` | `energia_kcal` | × `peso_kg` |
| `"g/kg"` | `proteina_g`, `hidratos_g`, `grasa_total_g`, `fibra_g` | × `peso_kg` |
| `"%kcal"` | `proteina_g`, `hidratos_g`, `azucares_g` (4 kcal/g); `grasa_total_g`, `grasas_saturadas_g` (9 kcal/g) | % × kcal del día ÷ kcal por gramo |

También se acepta escribir la propia unidad de la columna (`"g"`, `"mg"`, `"kcal"`), que no cambia nada.

**Kcal del día** (para `%kcal`): las de la energía ya resuelta para ese día: su `objetivo`; si no tiene, el punto medio
entre `min` y `max`; si solo tiene uno de los dos, ese. Si ese día no hay objetivo de energía, se usan las kcal de
referencia de `targets.json` (2000). Con esas mismas kcal se calculan la B1, la niacina y el ALA de la referencia EFSA.

Ejemplo con 74 kg y 2900 kcal: `{ "unidad": "g/kg", "min": 1.8 }` de proteína = al menos 133,2 g;
`{ "unidad": "%kcal", "min": 25, "max": 35 }` de grasa = entre 80,6 g y 112,8 g.

## Orden de prioridad

Para cada día y **cada nutriente por separado**, se usa la primera capa que lo define:

1. **Excepción** de esa fecha: sus `valores`.
2. **Tipo del día**: el `tipo` de la excepción de esa fecha y, si no hay, el que diga `semana` para ese día de la
   semana; se usan los `valores` de ese tipo en el periodo vigente.
3. **Valores por defecto del periodo vigente**.
4. **Referencia EFSA/UE** de `data/targets.json`, con el `perfil` del plan.

- **La entrada de un nutriente se sustituye entera**: si el tipo «entreno» dice `"proteina_g": { "objetivo": 180 }`,
  el `min` que tuviera el periodo no se arrastra ese día.
- **`null` corta la cascada**: ese día ese nutriente no tiene objetivo (ni siquiera el de la referencia).
- **Periodo vigente** un día: de los periodos que lo cubren (`inicio ≤ día ≤ fin`; sin `fin`, abierto), manda el que
  empezó más tarde. Así puedes anidar un periodo corto (Navidad, vacaciones) dentro de uno largo, y un periodo nuevo sin
  `fin` sustituye al anterior sin tener que cerrarlo. Un día que no cubre ningún periodo usa solo las excepciones de
  esa fecha y la referencia.
- **Peso del día**: el `peso_kg` de la excepción y, si no tiene, el del periodo vigente.
- Los días de la semana se cuentan con la fecha del diario (hora de Madrid), sin husos horarios.

En el ejemplo:

- Lunes 19-10-2026: periodo «Volumen otoño 2026», tipo «Entreno» → 3100 kcal; hidratos 5,5 g/kg × 74 = 407 g; proteína
  y grasa, los del periodo (grasa del 25 al 35 % de 3100 kcal); magnesio, la referencia EFSA (350 mg).
- Jueves 22-10-2026: la `semana` dice descanso, pero la excepción lo cambia a entreno; el viernes 23, al revés.
- Jueves 24-12-2026: periodo «Navidad» (el volumen terminó el 20); la excepción pone un máximo de 3500 kcal y quita el
  objetivo de sodio; la proteína sale del periodo (al menos 1,6 g/kg × 76 = 121,6 g).
- Desde el 07-01-2027: «Mantenimiento», sin `fin`, hasta que añadas otro periodo.

## Editar el plan desde la app

En Objetivos puedes cambiar kcal, macros y peso del periodo vigente (sus valores por defecto o los de un tipo):

- **Desde hoy** (opción por defecto): el periodo actual termina ayer y empieza hoy un tramo nuevo con el mismo nombre,
  tipos, semana y fin, con el cambio. Los días pasados se siguen evaluando como estaban.
- **A todo el periodo**: corrige el periodo entero, también los días pasados.

Después, «Exportar plan» te da el JSON actualizado.

## Importar: validación

Al importar se valida el plan entero. Si hay algún error, no se importa nada y se listan todos:

- `tipo` o `version` que no son los de arriba; fechas que no son `AAAA-MM-DD` reales; `fin` antes de `inicio`;
- `id` repetido, dos periodos que empiezan el mismo día, dos excepciones con la misma fecha;
- un nutriente que no existe; un objetivo que no es un objeto (o `null`), sin ningún límite, con límites que no son
  números positivos (el 0 solo vale como `min`) o con `min > objetivo`, `objetivo > max` o `min > max`;
- una `unidad` que no vale para ese nutriente; `g/kg` o `kcal/kg` sin `peso_kg` disponible;
- un tipo en `semana` o en una excepción que no existe en su periodo; un día de la semana desconocido;
- un `perfil` que no está en `data/targets.json`.

Avisos (se importa igualmente, pero te los enseña antes): campos que la app no conoce (se conservan tal cual) y
periodos con `fin` que se solapan con otro (dice cuál manda en esos días).

Importar un plan **sustituye** al que tienes en el dispositivo: exporta antes el tuyo si quieres conservarlo.

## Para pedírselo a otro asistente

Pásale este fichero entero y lo que quieres («volumen de septiembre a diciembre, 74 kg, 2900 kcal, 2 g/kg de
proteína, cuatro días de entreno…»), y pídele que devuelva **solo el JSON**, con las claves de nutrientes tal como
aparecen aquí y en `data/nutrients.json`. Si algo no valida, la app te dice exactamente qué y dónde.
