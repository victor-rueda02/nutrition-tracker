# NutritionTracker

App personal para registrar comidas dictando en el iPhone. Dices «150 de arroz, 2 huevos y una cucharada de aceite», una IA
(Gemini) lo traduce a alimentos **de tu catálogo** con sus gramos, lo confirmas y se guarda. Los nutrientes los calcula el
código con tu documento de alimentos (`data/foods.csv`): la IA nunca calcula nutrientes ni inventa alimentos.

- `frontend/`: la app (PWA sin frameworks). Funciona sin conexión salvo el dictado.
- `worker/`: Cloudflare Worker que habla con Gemini y guarda la clave.
- `data/`: documento de alimentos (`data/foods.csv`), nutrientes, objetivos (`data/targets.json`) y su formato (`data/SCHEMA.md`).
- `scripts/`: herramientas para tu PC (servidor local, pruebas con Gemini, nutrientes de USDA).
- `usda/`: de dónde sale cada dato de nutrientes (`eleccion.csv`, `informe.md`).
- `tests/`: `npm test` (sin red: la IA siempre es simulada).

A internet solo viajan la frase dictada y la lista compacta del catálogo (sin nutrientes ni diario). El diario vive en el
iPhone: haz copias (ver «Copias de seguridad»).

## Requisitos

- Node.js 20.6 o superior (probado con Node 24) y npm.
- `npm install` en la carpeta del proyecto (instala lo necesario para los tests y `wrangler` para el Worker).
- Un fichero `.env` en la raíz con tus claves. **Nunca va al repositorio** (está en `.gitignore`):

  ```
  GEMINI_API_KEY=tu_clave_de_gemini
  USDA_API_KEY=tu_clave_de_fooddata_central
  APP_TOKEN=opcional_en_local
  ```

## Probar en tu PC

```
npm run dev        # app en http://localhost:8080/
npm run dev:lan    # además, desde el iPhone en la misma Wi-Fi (te dice la dirección)
npm test
```

`npm test` incluye una prueba de layout con Chrome headless (Chrome, Chromium o Edge; tarda unos 40 s). Sin Chrome se salta sola;
con Chrome, para saltarla: `NT_SIN_CHROME=1 npm test` (PowerShell: `$env:NT_SIN_CHROME='1'; npm test`).

En la app: **Documento → Conexión**, Worker = `http://localhost:8080` (o la dirección que te dé `dev:lan`), Token = tu
`APP_TOKEN` de `.env` (o `local` si no lo pusiste) → Guardar → Probar. Cada «Procesar» es una llamada real a Gemini.

## Desplegar (una vez)

Necesitas una cuenta de GitHub, una de Cloudflare (gratis) y tu clave de Gemini. En los pasos, `TU-USUARIO` es tu usuario
de GitHub y `TU-REPO` el nombre del repositorio.

### 1. La app en GitHub Pages

1. En GitHub, crea un repositorio **público** y vacío llamado `TU-REPO` (sin README ni licencia).
2. En la carpeta del proyecto, comprueba que `.env` no aparece en `git status` y sube el código:

   ```
   git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
   git push -u origin main
   ```

3. En GitHub: repositorio → **Settings → Pages** → «Build and deployment»: Source **Deploy from a branch**, Branch
   **main**, carpeta **/ (root)** → Save.
4. En 1-2 minutos estará en `https://TU-USUARIO.github.io/TU-REPO/` (te lleva a `frontend/`).

Se publica todo el repositorio, también `data/foods.csv` (decidido: no es privado). Las claves no: viven en `.env` y en el
Worker.

### 2. El Worker (la IA)

1. Edita `worker/wrangler.toml` y pon tu origen de GitHub Pages, **sin** `/TU-REPO` y sin barra final:

   ```
   ALLOWED_ORIGIN = "https://TU-USUARIO.github.io"
   ```

   Haz commit y push.
2. Inicia sesión en Cloudflare (se abre el navegador): `npx wrangler login`
3. Comprueba que el Worker se empaqueta (no publica nada): `npm run worker:check`
4. Publica **desde tu terminal**: `npm run worker:deploy`. La primera vez te pregunta qué subdominio `*.workers.dev` quieres
   para tu cuenta: responde que sí y escribe uno libre (letras, números y guiones). Si se lanza sin terminal interactiva,
   intenta registrar uno por su cuenta y falla si ese nombre está ocupado: vuelve a ejecutarlo tú. Al terminar muestra la
   dirección del Worker: `https://nutrition-tracker-ai.TU-SUBDOMINIO.workers.dev`.
5. Genera el token compartido entre la app y el Worker y guárdalo en tu gestor de contraseñas: `npm run token`
6. Pon los secretos (te los pide por teclado; pégalos y pulsa Intro):

   ```
   npm run worker:secret:gemini    # tu clave de Gemini
   npm run worker:secret:usda      # tu clave de FoodData Central (api.data.gov): solo los 40 caracteres, sin comillas
   npm run worker:secret:token     # el token del paso 5
   ```

   La de USDA solo hace falta para «Estimar con IA» (platos que no están en tu documento); sin ella, dictar funciona igual.

7. Comprueba en el navegador: `https://nutrition-tracker-ai.TU-SUBDOMINIO.workers.dev/health` debe responder
   `{"ok":true,"configurado":true,"token":"sin_token"}`.

### 3. El iPhone

1. En **Safari**, abre `https://TU-USUARIO.github.io/TU-REPO/` → botón **Compartir** → **Añadir a pantalla de inicio**.
2. Abre la app **desde el icono** (tiene su propio almacenamiento, distinto del de Safari: usa siempre el icono). La primera
   vez carga `data/foods.csv` del repositorio.
3. **Documento → Conexión**: Worker = `https://nutrition-tracker-ai.TU-SUBDOMINIO.workers.dev`, Token = el de
   `npm run token` → **Guardar** → **Probar**. Debe decir «Todo correcto: el Worker responde, tiene sus secretos y el token
   es el correcto».
4. Dicta una comida de prueba con el micrófono del teclado.

## Actualizar

- **La app**: `git push`. GitHub Pages la publica en 1-2 minutos. En el iPhone, abre la app, ciérrala y vuelve a abrirla:
  la versión nueva se descarga por detrás y se ve en la segunda apertura.
- **El Worker** (prompt, validación, modelo): `npm run worker:deploy`. La app no necesita cambios. El modelo de Gemini se
  cambia en `GEMINI_MODEL` de `worker/wrangler.toml`.
- **Tu documento de alimentos**: el del repositorio solo se usa la primera vez. Para cargar uno nuevo en el iPhone:
  **Documento → Importar documento** (desde Archivos o iCloud Drive; vale el CSV de Excel en español o con comas).
- Para ver qué pasa en el Worker en directo: `npm run worker:logs`.

## Copias de seguridad

El diario solo está en el iPhone. **Documento → Copia de seguridad → Exportar diario** (menú Compartir → «Guardar en
Archivos»). Para restaurarlo, **Importar diario**: muestra un resumen antes de aplicar, fusiona por comida (gana la versión
más reciente) y nunca borra. Si borras la app del iPhone, pierdes lo que no hayas exportado.

Desde la misma pantalla puedes exportar tu documento de alimentos: «Exportar documento (Excel)» (punto y coma y coma
decimal) o «(CSV con comas)» (el formato de `data/foods.csv`).

## Tu documento de alimentos

- Formato y reglas: `data/SCHEMA.md`.
- Nutrientes de USDA (en tu PC): `node --env-file=.env scripts/usda.mjs candidatos` → elige en `usda/eleccion.csv` →
  `node --env-file=.env scripts/usda.mjs filas` → revisa `usda/foods.propuesto.csv` y `usda/informe.md` → cópialo a
  `data/foods.csv`.
- Probar frases con Gemini real: `node --env-file=.env scripts/try-phrases.mjs --foods data/foods.csv "150 de arroz y 2 huevos"`
  (una llamada por frase).

## Problemas frecuentes

| Lo que ves | Causa probable | Qué hacer |
|---|---|---|
| «No se pudo contactar con el servidor de la IA…» al Probar o al dictar | `ALLOWED_ORIGIN` no es tu GitHub Pages (el navegador bloquea la respuesta) o la dirección del Worker está mal | `ALLOWED_ORIGIN = "https://TU-USUARIO.github.io"` en `worker/wrangler.toml`, `npm run worker:deploy`, y revisa la dirección en Documento → Conexión |
| «El Worker responde, pero el token no es correcto» / «El token no es correcto» | El token de la app no es el del Worker | Ponlo igual en los dos: `npm run worker:secret:token` y Documento → Conexión |
| «El Worker responde, pero le faltan secretos» | Falta `GEMINI_API_KEY` o `APP_TOKEN` en el Worker | `npm run worker:secret:gemini` / `npm run worker:secret:token` |
| «El Worker no tiene la clave de USDA…» o «USDA rechaza la clave del Worker…» al estimar | Falta `USDA_API_KEY` en el Worker o no es válida | `npm run worker:secret:usda` y pega solo la clave (40 letras y números) |
| «Se ha alcanzado el límite de uso gratuito de la IA» | Cuota gratuita de Gemini agotada | Espera; mientras, «Añadir a mano». El texto dictado se conserva |
| «El servicio de IA ha fallado» | Error de Gemini o modelo no disponible | Prueba de nuevo; mira `npm run worker:logs`; revisa `GEMINI_MODEL` y `GEMINI_MODEL_FALLBACK` (si Google devuelve 5xx, el Worker reintenta una vez y prueba el modelo de respaldo) |
| No ves un cambio de la app | Caché de la app | Ciérrala y ábrela dos veces |

## Coste

Cero: GitHub Pages, Cloudflare Workers (plan gratuito) y la API gratuita de Gemini (cuota limitada: una llamada por
dictado, más un reintento si la respuesta llega mal).
