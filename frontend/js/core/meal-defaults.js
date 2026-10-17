// Comida por defecto según la hora de Europe/Madrid.
export const MEALS = ['desayuno', 'comida', 'merienda', 'cena', 'otro'];

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// { date: 'YYYY-MM-DD', minutes: minutos desde las 00:00 } en hora de Madrid.
export function madridNow(date = new Date()) {
  const p = Object.fromEntries(formatter.formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

// 05:00-11:29 desayuno · 11:30-16:29 comida · 16:30-19:29 merienda · 19:30-23:59 cena · 00:00-04:59 otro
export function defaultMeal(date = new Date()) {
  const m = madridNow(date).minutes;
  if (m >= 5 * 60 && m < 11 * 60 + 30) return 'desayuno';
  if (m >= 11 * 60 + 30 && m < 16 * 60 + 30) return 'comida';
  if (m >= 16 * 60 + 30 && m < 19 * 60 + 30) return 'merienda';
  if (m >= 19 * 60 + 30) return 'cena';
  return 'otro';
}
