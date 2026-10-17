// Genera un token aleatorio para APP_TOKEN (el secreto compartido entre la app y el Worker).
//   npm run token
// Guárdalo en tu gestor de contraseñas: lo pondrás en el Worker (npm run worker:secret:token) y en la app
// (Documento -> Conexión). No lo subas al repositorio.
import { randomBytes } from 'node:crypto';

console.log(randomBytes(24).toString('base64url'));
