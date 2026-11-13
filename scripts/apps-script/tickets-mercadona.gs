/**
 * Tickets de Mercadona -> NutritionTracker (Google Apps Script, en tu cuenta de Gmail).
 *
 * Cada hora busca los correos de Mercadona con un PDF adjunto que aún no tengan la etiqueta «nt-procesado», manda cada PDF
 * (en base64) a la cola de tickets de TU Worker (POST /tickets) y, si el Worker responde 200, pone la etiqueta al correo.
 * El Worker lee el PDF, se queda solo con la fecha, las líneas de producto y un hash, y lo deja en su cola; la app lo recoge
 * con «Sincronizar inventario». Pasos para ponerlo en marcha: docs/inventario/CORREO.md.
 *
 * NO escribas aquí la dirección del Worker ni el token: van en «Propiedades del script» (Configuración del proyecto):
 *   WORKER_URL  p. ej. https://nutrition-tracker-ai.<tu-subdominio>.workers.dev   (sin barra final)
 *   MAIL_TOKEN  el mismo valor que pusiste con `npm run worker:secret:mail`
 */

// ---------- Ajustes (lo único que puedes tocar aquí) ----------

// Qué correos busca. Es una consulta de Gmail normal (pruébala en la caja de búsqueda de Gmail). Si te llegan correos de
// Mercadona que no son tickets, acótala con la dirección del remitente: from:(la-direccion-que-veas-en-el-correo).
var CONSULTA = 'from:mercadona has:attachment filename:pdf -label:nt-procesado -label:nt-no-leido newer_than:30d';
var ETIQUETA_HECHO = 'nt-procesado';   // el Worker lo recibió (200)
var ETIQUETA_NO_LEIDO = 'nt-no-leido'; // el Worker contestó 422: ese PDF no se puede leer (no se reintenta cada hora)
var MAX_HILOS = 10;                    // correos por ejecución (el resto, en la hora siguiente)

// ---------- Programa ----------

/** Se ejecuta cada hora (disparador). También puedes lanzarlo a mano con «Ejecutar». */
function procesarTickets() {
  var props = PropertiesService.getScriptProperties();
  var base = String(props.getProperty('WORKER_URL') || '').replace(/\/+$/, '');
  var token = props.getProperty('MAIL_TOKEN');
  if (!base || !token) {
    throw new Error('Faltan las propiedades del script WORKER_URL y MAIL_TOKEN (Configuración del proyecto > Propiedades del script).');
  }
  var hecho = etiqueta_(ETIQUETA_HECHO);
  var noLeido = etiqueta_(ETIQUETA_NO_LEIDO);
  var hilos = GmailApp.search(CONSULTA, 0, MAX_HILOS);
  Logger.log('Hilos por procesar: ' + hilos.length);
  var enviados = 0;

  hilos.forEach(function (hilo) {
    var pdfs = 0;
    var errores = 0;     // fallos que se reintentan en la hora siguiente (red, 5xx, token...)
    var ilegibles = 0;   // el Worker rechaza ese PDF (400, 413, 422…): no tiene sentido reintentar
    hilo.getMessages().forEach(function (mensaje) {
      mensaje.getAttachments().forEach(function (adjunto) {
        if (!esPdf_(adjunto)) return;
        pdfs++;
        var r = enviar_(base, token, adjunto);
        if (r.codigo === 200) {
          enviados++;
          Logger.log('Ticket recibido (' + adjunto.getName() + '): ' + r.cuerpo);
        } else if (!reintentable_(r.codigo)) {
          // 400, 413, 422… (PDF mal formado, demasiado grande o que el Worker no entiende): reintentar no lo arregla
          ilegibles++;
          Logger.log('PDF no aceptado (' + r.codigo + '), se marca «' + ETIQUETA_NO_LEIDO + '» (' + adjunto.getName() + '): ' + r.cuerpo);
        } else {
          errores++;
          Logger.log('ERROR ' + r.codigo + ' con ' + adjunto.getName() + ': ' + r.cuerpo);
        }
      });
    });
    if (pdfs === 0) return;                          // ningún PDF de verdad: se mira otra vez la próxima hora
    if (errores === 0 && ilegibles === 0) hilo.addLabel(hecho);
    else if (errores === 0) hilo.addLabel(noLeido);  // solo hubo PDF que el Worker no sabe leer
    // con errores temporales no se etiqueta: se reintenta en la próxima ejecución
  });
  Logger.log('Tickets enviados: ' + enviados);
}

/** Crea el disparador horario (ejecútala UNA vez; alternativa a crearlo a mano en «Activadores»). */
function instalarDisparador() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'procesarTickets') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('procesarTickets').timeBased().everyHours(1).create();
  Logger.log('Disparador creado: procesarTickets cada hora.');
}

/** Comprueba que el Worker responde y tiene la cola y el token del correo configurados (no manda ningún ticket). */
function comprobarWorker() {
  var base = String(PropertiesService.getScriptProperties().getProperty('WORKER_URL') || '').replace(/\/+$/, '');
  if (!base) throw new Error('Falta la propiedad del script WORKER_URL.');
  var r = UrlFetchApp.fetch(base + '/health', { muteHttpExceptions: true });
  Logger.log('HTTP ' + r.getResponseCode() + ' ' + r.getContentText() + '  (debe decir "tickets":true y "mail":true)');
}

// ---------- Utilidades ----------

function etiqueta_(nombre) {
  return GmailApp.getUserLabelByName(nombre) || GmailApp.createLabel(nombre);
}

// Solo se reintenta lo que puede arreglarse solo o con el token: sin respuesta (0), token (401), límite (429) y 5xx.
function reintentable_(codigo) {
  return codigo === 0 || codigo === 401 || codigo === 429 || codigo >= 500;
}

function esPdf_(adjunto) {
  return adjunto.getContentType() === 'application/pdf' || /\.pdf$/i.test(adjunto.getName());
}

// POST /tickets con el token del correo. No lanza: devuelve { codigo, cuerpo } (0 si ni siquiera hubo respuesta).
function enviar_(base, token, adjunto) {
  try {
    var r = UrlFetchApp.fetch(base + '/tickets', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Mail-Token': token },
      payload: JSON.stringify({ pdf_base64: Utilities.base64Encode(adjunto.getBytes()) }),
      muteHttpExceptions: true
    });
    return { codigo: r.getResponseCode(), cuerpo: r.getContentText().slice(0, 300) };
  } catch (e) {
    return { codigo: 0, cuerpo: String(e) };
  }
}
