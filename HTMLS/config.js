// URL del backend. Ahora es una función de Netlify (netlify/functions/api.js)
// que habla directo con la API de Google Sheets/Drive usando una cuenta de
// servicio, en vez del Apps Script (server/apps-script/Code.gs, ya en desuso).
// Al ser una ruta relativa, funciona igual en Netlify y en "netlify dev" local
// porque el sitio y la función viven en el mismo dominio.
const API_URL = '/.netlify/functions/api';
