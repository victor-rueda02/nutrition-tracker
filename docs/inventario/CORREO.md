# Tickets de Mercadona por correo: puesta en marcha

Qué hace (decisión D1 a de `ESPEC.md`): un script de Google Apps Script en tu cuenta de Gmail busca **cada hora** los correos de
Mercadona con el ticket digital (PDF) que aún no tengan la etiqueta `nt-procesado`, manda cada PDF a tu Worker y pone la etiqueta.
El Worker lee el PDF, se queda **solo con la fecha, la hora, las líneas de producto y un hash** (nunca el PDF, la tienda, el NIF, el OP,
el nº de factura ni la tarjeta) y lo deja en una cola de 30 días. La app lo recoge cuando abres el inventario o pulsas
«Sincronizar inventario»; las dudas se resuelven en la app (D2 a). **Nada de esto va a Gemini ni a USDA.**

Son tres partes: A (Cloudflare, en tu PC), B (Apps Script, en el navegador) y C (probar). Hazlas en este orden. La parte A crea
recursos de Cloudflare, pone un secreto y publica el Worker: por eso se hace cuando tú des el OK.

## Parte A · Cloudflare (PowerShell, en la carpeta del proyecto)

1. **Crea la cola (KV, gratis)**:
   ```powershell
   npx wrangler kv namespace create TICKETS
   ```
   Imprime un bloque con un `id` (32 caracteres hexadecimales). Cópialo.
2. **Pégalo en `worker/wrangler.toml`**: al final del fichero hay un bloque comentado con `[[kv_namespaces]]`. Quita el `#` de
   esas tres líneas y sustituye `PEGA-AQUI-EL-ID-DEL-NAMESPACE` por tu `id`. (El `id` no es un secreto; puede ir en el repositorio.)
3. **Crea el token del correo** (distinto del de la app) y guárdalo en tu gestor de contraseñas:
   ```powershell
   npm run token
   ```
   Copia lo que imprime.
4. **Ponlo como secreto del Worker**:
   ```powershell
   npm run worker:secret:mail
   ```
   Cuando lo pida, pega el token y pulsa Intro. (Este token solo vale para `POST /tickets`: aunque se filtrara, nadie podría leer
   tu cola ni usar la IA.)
5. **Publica el Worker**: `npm run worker:deploy`.
6. **Comprueba**: abre `https://<tu-worker>.workers.dev/health` en el navegador. Debe salir `"tickets":true,"mail":true`
   (solo «sí» o «no»; nunca los valores). Si sale `false`, falta ese paso (2 o 4) o no has vuelto a publicar.

## Parte B · Apps Script (en el navegador, con la cuenta de Gmail donde llegan los tickets)

1. Abre <https://script.google.com> y pulsa **Nuevo proyecto**. Ponle de nombre «Tickets Mercadona» (arriba a la izquierda).
2. **Pega el código**: en el editor, borra lo que haya en `Código.gs` y pega **todo** el contenido de
   `scripts/apps-script/tickets-mercadona.gs`. Pulsa el icono de guardar (o `Ctrl+S`).
3. **Guarda la dirección y el token** (nunca en el código): en el menú de la izquierda, **Configuración del proyecto**
   (la rueda dentada) → baja hasta **Propiedades del script** → **Editar propiedades del script** → **Añadir propiedad**, dos veces:
   - `WORKER_URL` = `https://<tu-worker>.workers.dev` (sin barra al final)
   - `MAIL_TOKEN` = el token del paso A3
   Pulsa **Guardar propiedades del script**.
4. **Autoriza el script**: vuelve a **Editor** (los símbolos `<>`), elige la función `comprobarWorker` en el desplegable de arriba
   y pulsa **Ejecutar**. Google pedirá permisos:
   - «Revisar permisos» → elige tu cuenta.
   - Saldrá «Google no ha verificado esta aplicación». Es normal: el script es tuyo. Pulsa **Configuración avanzada** →
     **Ir a Tickets Mercadona (no seguro)** → **Permitir**.
   - Los permisos son: leer y etiquetar tu correo de Gmail (para buscar los tickets y poner `nt-procesado`) y conectar con un
     servicio externo (tu Worker). El script solo abre los hilos que cumplen la consulta de Mercadona.
   Abajo, en **Registro de ejecución**, debe salir `HTTP 200 {"ok":true,... "tickets":true,"mail":true}`.
5. **Crea el disparador horario**. Dos formas, elige una:
   - Más fácil: selecciona la función `instalarDisparador` y pulsa **Ejecutar** una vez.
   - A mano: menú de la izquierda → **Activadores** (el reloj) → **Añadir activador** → función `procesarTickets`, origen
     «Basado en tiempo», tipo «Temporizador por horas», **cada hora** → **Guardar**.
6. **Prueba**: selecciona `procesarTickets` y pulsa **Ejecutar**. En el registro verás cuántos hilos encontró y, por cada PDF,
   `Ticket recibido (...)` con la fecha y el nº de líneas. Los correos aparecerán en Gmail con la etiqueta `nt-procesado`.

## Parte C · Probar de punta a punta

1. **Paso obligatorio**: abre un correo con tu ticket de Mercadona, mira la **dirección exacta del remitente** y pon esa dirección en
   `CONSULTA` del script (`from:(esa-direccion) has:attachment filename:pdf -label:nt-procesado -label:nt-no-leido newer_than:30d`).
   No dejes `from:mercadona` a secas: coge cualquier correo de la marca (publicidad, facturas…). Comprueba en la caja de búsqueda de
   Gmail que sale tu ticket.
2. Ejecuta `procesarTickets` (B6). Si salió `Ticket recibido`, el ticket está en la cola del Worker.
3. En la app: Alimentos → Inventario → **Sincronizar inventario** (pantalla de la fase F4). Las líneas de la dieta suman, las de
   fuera se ignoran y las dudosas van a **Dudas**.
4. **Sin esperar a la app**, puedes ver la cola con PowerShell (usa tu token de la app, no el del correo):
   ```powershell
   $t = Read-Host 'Token'
   Invoke-RestMethod -Method Post -Uri https://<tu-worker>.workers.dev/tickets/pendientes -Headers @{ 'X-App-Token' = $t }
   ```
5. También puedes probar el Worker con el texto de un ticket (sin Gmail):
   ```powershell
   $t = Read-Host 'Token del correo'
   $texto = [IO.File]::ReadAllText((Resolve-Path tests\fixtures\tickets\ticket-2026-10-26.txt), [Text.Encoding]::UTF8)
   $cuerpo = @{ texto = $texto } | ConvertTo-Json
   Invoke-RestMethod -Method Post -Uri https://<tu-worker>.workers.dev/tickets -Headers @{ 'X-Mail-Token' = $t } -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($cuerpo))
   ```
   (Esos tickets de prueba llevan fechas pasadas: no sumarán nada a un inventario cuyo recuento sea posterior.)

## Cuando algo falla

El registro del script está en **Ejecuciones** (menú de la izquierda) → abre la ejecución → «Registro». Los errores del Worker salen
con `npm run worker:logs`.

| Registro | Qué pasa | Qué hacer |
|---|---|---|
| `ERROR 401 … token_invalido` | `MAIL_TOKEN` del script ≠ secreto del Worker | Repite A4 y B3 con el mismo valor |
| `ERROR 500 … tickets_sin_configurar` | Falta el KV `TICKETS` en el Worker | Pasos A1, A2 y A5 |
| `ERROR 0 …` | Sin respuesta (URL mal escrita o red) | Revisa `WORKER_URL`; vuelve a intentarlo |
| `ERROR 503 …` o `1102` (CPU superada) | Google/Cloudflare fallan, o el Worker gratuito se queda sin CPU leyendo el PDF | Sube el ticket desde la app («Pegar el texto del ticket») y avisa al coordinador |
| `PDF no legible … 400/413/422` (PDF de más de 2 MB, base64 raro o que el Worker no entiende) | El Worker no entiende ese PDF (otro formato, un adjunto que no es el ticket) | El hilo recibe `nt-no-leido` y deja de reintentarse. Si era un ticket, **sube el texto desde la app** («Pegar el texto del ticket») y avisa de que cambió el formato. Para que vuelva a intentarse, quita la etiqueta `nt-no-leido` en Gmail |
| No sale ningún hilo | La consulta no coincide | Prueba `CONSULTA` en la caja de búsqueda de Gmail y ajústala |

- **Ver o quitar el disparador**: **Activadores** (el reloj). Para parar el correo, borra el activador; el Worker no hace nada solo.
- **Reenviar un ticket**: quita la etiqueta `nt-procesado` del correo. Aunque se reenvíe, el Worker y la app lo reconocen por su hash
  y no lo suman dos veces («Ticket ya aplicado»).
- **Cuota**: Apps Script gratuito permite este uso de sobra (una ejecución por hora y unos pocos PDF). Cloudflare KV gratuito
  también (unas pocas escrituras al día).
- **Privacidad**: en la cola del Worker solo hay fecha, hora, líneas de producto (cantidad, descripción, precios, peso) y el hash; caduca a
  los 30 días y la app la borra al recogerla. El PDF no se guarda en ningún sitio.
