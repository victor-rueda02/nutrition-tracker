// Service worker y aviso de versión nueva de la app. iOS suele reanudar la app instalada sin volver a cargarla, y sin
// carga no busca versión nueva: al volver a primer plano se pide (como mucho cada 5 min) y, cuando la versión nueva toma
// el control, se avisa arriba con «Recargar» y «Ahora no». Nunca se recarga solo: un borrador sin guardar se perdería.
// Todo inyectable para poder probarlo (tests/sw-update.test.js).
export const INTERVALO_MS = 5 * 60 * 1000;

export function vigilarVersion({ sw, doc, reload, now = () => Date.now(), intervaloMs = INTERVALO_MS, log = (...a) => globalThis.console?.error?.(...a) }) {
  if (!sw) return;
  const habiaVersion = Boolean(sw.controller); // la primera instalación no es «versión nueva»
  sw.addEventListener('controllerchange', () => {
    if (!habiaVersion || doc.querySelector('.aviso-version')) return;
    const aviso = doc.createElement('div');
    aviso.className = 'aviso-version';
    aviso.setAttribute('role', 'status');
    const texto = doc.createElement('span');
    texto.textContent = 'Hay una versión nueva de la app. Guarda lo que tengas a medias antes de recargar.';
    const botones = doc.createElement('span');
    botones.className = 'aviso-version-botones';
    const luego = doc.createElement('button');
    luego.type = 'button';
    luego.className = 'secondary';
    luego.textContent = 'Ahora no';
    luego.addEventListener('click', () => aviso.remove());
    const recargar = doc.createElement('button');
    recargar.type = 'button';
    recargar.textContent = 'Recargar';
    recargar.addEventListener('click', () => reload());
    botones.append(luego, recargar);
    aviso.append(texto, botones);
    doc.body.append(aviso);
  });
  return sw.register('sw.js').then((reg) => {
    let ultima = now();
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState !== 'visible' || now() - ultima < intervaloMs) return;
      ultima = now();
      Promise.resolve(reg.update()).catch((e) => log('No se pudo buscar una versión nueva de la app', e));
    });
    return reg;
  }).catch((e) => log('No se pudo registrar el service worker', e));
}
