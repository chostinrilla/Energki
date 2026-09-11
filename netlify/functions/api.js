// Backend del módulo de entrenamiento, versión Netlify Functions.
//
// Reemplaza al Apps Script de server/apps-script/Code.gs, pero habla
// directamente con la API oficial de Google Sheets/Drive usando una cuenta
// de servicio. Esto evita la restricción de "quién tiene acceso" que Apps
// Script hereda de las políticas de uso compartido de Google Workspace: aquí
// el acceso no depende de compartir nada como "cualquier usuario", sino de
// que la cuenta de servicio tenga permiso directo sobre la hoja y la carpeta
// de Drive (se le comparten como a una persona más).
//
// Variables de entorno necesarias (configúralas en Netlify, nunca en el
// repositorio):
//   GOOGLE_SERVICE_ACCOUNT_KEY  -> contenido completo del JSON de la cuenta
//                                   de servicio, tal cual lo descargó Google.
//   GOOGLE_SHEET_ID             -> ID de la hoja de cálculo (de su URL).
//   GOOGLE_DRIVE_FOLDER_ID      -> ID de la carpeta compartida donde se
//                                   guardan las imágenes de los manuales.
//
// La hoja debe tener una pestaña llamada "trainings" con encabezados:
// id | title | status | version | updated_at | content_json

const { google } = require('googleapis');
const { randomUUID } = require('crypto');
const { Readable } = require('stream');

const SHEET_NAME = 'trainings';
const MIME_EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const DRIVE_ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

// Se reutiliza el cliente autenticado entre invocaciones "calientes" de la
// función (mismo contenedor de Lambda), para no rehacer el login en cada
// llamada. Si el contenedor es nuevo, simplemente se vuelve a crear.
let cachedAuthClient = null;
async function getAuthClient() {
  if (cachedAuthClient) return cachedAuthClient;
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
  cachedAuthClient = await auth.getClient();
  return cachedAuthClient;
}

async function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: await getAuthClient() });
}

async function getDriveClient() {
  return google.drive({ version: 'v3', auth: await getAuthClient() });
}

function respond(data, statusCode = 200) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Casi siempre esto se llama desde el mismo dominio de Netlify, pero se
      // deja abierto por si se prueba desde localhost o desde otro origen.
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
    body: JSON.stringify(data),
  };
}

// ---- Hoja de cálculo (equivalente a listTrainings/getTraining/saveTraining/deleteTraining de Code.gs) ----

async function getAllRows() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:F`,
  });
  return res.data.values || [];
}

async function listTrainings() {
  const rows = await getAllRows();
  return rows
    .filter((r) => r[0])
    .map((r) => ({ id: r[0], title: r[1], status: r[2], version: r[3], updatedAt: r[4] }));
}

// Devuelve el número de fila real en la hoja (1-indexado, contando el
// encabezado) o -1 si no existe. Igual que findRowIndexById en Code.gs.
async function findRowIndexById(id) {
  const rows = await getAllRows();
  const idx = rows.findIndex((r) => r[0] === id);
  return idx === -1 ? -1 : idx + 2;
}

async function getTraining(id) {
  if (!id) return { error: 'Falta el id' };
  const rowIndex = await findRowIndexById(id);
  if (rowIndex === -1) return { error: 'Manual no encontrado' };

  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A${rowIndex}:F${rowIndex}`,
  });
  const row = (res.data.values || [[]])[0];
  const content = JSON.parse(row[5] || '{}');
  content.id = row[0];
  content.title = row[1];
  content.status = row[2];
  content.version = row[3];
  return content;
}

async function saveTraining(payload) {
  const sheets = await getSheetsClient();
  const id = payload.id;
  const now = new Date().toISOString();
  const contentJson = JSON.stringify({
    configuracion: payload.configuracion || {},
    canvas: payload.canvas || null,
    paneles: payload.paneles || [],
    paginas: payload.paginas || null,
    steps: payload.steps || [],
  });

  if (id) {
    const rowIndex = await findRowIndexById(id);
    if (rowIndex !== -1) {
      const currentRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!D${rowIndex}`,
      });
      const currentVersion = Number((currentRes.data.values || [[1]])[0][0]) || 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!B${rowIndex}:F${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[payload.title || 'Sin título', payload.status || 'draft', currentVersion + 1, now, contentJson]],
        },
      });
      return { id, version: currentVersion + 1 };
    }
    // El id vino del cliente (manual nuevo con id pre-generado para poder
    // subir imágenes a su carpeta antes de guardar) pero aún no existe una
    // fila: se crea con ese mismo id.
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:F`,
      valueInputOption: 'RAW',
      requestBody: { values: [[id, payload.title || 'Sin título', payload.status || 'draft', 1, now, contentJson]] },
    });
    return { id, version: 1 };
  }

  const newId = randomUUID();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:F`,
    valueInputOption: 'RAW',
    requestBody: { values: [[newId, payload.title || 'Sin título', payload.status || 'draft', 1, now, contentJson]] },
  });
  return { id: newId, version: 1 };
}

// El id numérico interno de la pestaña "trainings" (gid), necesario para
// borrar una fila con batchUpdate. Se cachea igual que el cliente de auth.
let cachedSheetGid = null;
async function getSheetGid() {
  if (cachedSheetGid != null) return cachedSheetGid;
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties' });
  const sheet = (meta.data.sheets || []).find((s) => s.properties.title === SHEET_NAME);
  if (!sheet) throw new Error(`No se encontró la hoja "${SHEET_NAME}"`);
  cachedSheetGid = sheet.properties.sheetId;
  return cachedSheetGid;
}

async function deleteTraining(id) {
  if (!id) return { error: 'Falta el id' };
  const rowIndex = await findRowIndexById(id);
  if (rowIndex === -1) return { error: 'Manual no encontrado' };

  const sheets = await getSheetsClient();
  const sheetGid = await getSheetGid();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId: sheetGid, dimension: 'ROWS', startIndex: rowIndex - 1, endIndex: rowIndex },
          },
        },
      ],
    },
  });

  const folder = await findTrainingFolderById(id);
  if (folder) {
    const drive = await getDriveClient();
    await drive.files.update({ fileId: folder.id, requestBody: { trashed: true }, supportsAllDrives: true });
  }

  return { id, deleted: true };
}

// ---- Drive (equivalente a uploadAsset y sus funciones de apoyo en Code.gs) ----

function sanitizeName(str) {
  const cleaned = String(str || '').replace(/[\\/:*?"<>|]/g, '-').trim();
  return cleaned || 'sin-titulo';
}

// Busca la carpeta de un manual por el identificador corto en su nombre,
// sin depender del título (que puede haber cambiado desde que se creó).
async function findTrainingFolderById(trainingId) {
  const suffix = `(${String(trainingId).slice(0, 8)})`;
  const drive = await getDriveClient();
  const res = await drive.files.list({
    q: `'${DRIVE_ROOT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const files = res.data.files || [];
  return files.find((f) => f.name.includes(suffix)) || null;
}

// Una carpeta por manual, nombrada con el título y un identificador corto y estable.
async function getTrainingFolder(trainingId, title) {
  const existing = await findTrainingFolderById(trainingId);
  if (existing) return existing;
  const drive = await getDriveClient();
  const folderName = `${sanitizeName(title)} (${String(trainingId).slice(0, 8)})`;
  const res = await drive.files.create({
    requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [DRIVE_ROOT_FOLDER_ID] },
    fields: 'id, name',
    supportsAllDrives: true,
  });
  return res.data;
}

async function countFilesInFolder(folderId) {
  const drive = await getDriveClient();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (res.data.files || []).length;
}

async function uploadAsset(payload) {
  if (!payload.base64) return { error: 'Falta la imagen' };
  if (!payload.trainingId) return { error: 'Falta el id del manual' };

  const folder = await getTrainingFolder(payload.trainingId, payload.title);
  const base64Data = String(payload.base64).split(',').pop();
  const mimeType = payload.mimeType || 'image/png';
  const buffer = Buffer.from(base64Data, 'base64');

  // Sin nombre de archivo original: {título}-{número de imagen}-{fecha}.
  // El número sube con cada imagen nueva del mismo manual, así nunca se repite.
  const imageNumber = (await countFilesInFolder(folder.id)) + 1;
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const extension = MIME_EXTENSIONS[mimeType] || 'png';
  const fileName = `${sanitizeName(payload.title)}-${imageNumber}-${date}.${extension}`;

  const drive = await getDriveClient();
  const createRes = await drive.files.create({
    requestBody: { name: fileName, parents: [folder.id] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id',
    supportsAllDrives: true,
  });
  const fileId = createRes.data.id;

  // No se intenta compartir el archivo como "cualquiera con el enlace": la
  // política de la unidad compartida de la empresa lo rechaza (error de
  // Google "publishOutNotPermitted"). En vez de eso, la imagen se sirve a
  // través de getAsset, que la lee con la cuenta de servicio y la entrega
  // sin necesidad de que el archivo sea público.
  return { assetId: fileId, url: `/.netlify/functions/api?action=getAsset&id=${fileId}` };
}

// Sirve el contenido de un archivo de Drive usando la cuenta de servicio,
// sin depender de que el archivo tenga un enlace público (ver nota en
// uploadAsset). El resultado se puede cachear agresivamente porque cada
// imagen subida crea un archivo nuevo; el mismo id nunca cambia de contenido.
async function getAsset(fileId) {
  if (!fileId) return respond({ error: 'Falta el id del archivo' }, 400);
  const drive = await getDriveClient();
  const meta = await drive.files.get({ fileId, fields: 'mimeType, name', supportsAllDrives: true });
  const media = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  return {
    statusCode: 200,
    headers: {
      'Content-Type': meta.data.mimeType || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      // El id de un archivo nunca cambia de contenido (cada imagen nueva crea
      // un archivo nuevo), así que se puede cachear de forma permanente.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
    body: Buffer.from(media.data).toString('base64'),
    isBase64Encoded: true,
  };
}

// Manda un archivo a la papelera de Drive (no lo borra en definitiva, igual
// que deleteTraining con la carpeta de un manual) — se usa cuando el editor
// reemplaza o quita la imagen de una página, para que esa imagen vieja no se
// quede huérfana en la carpeta del manual para siempre. No falla si el
// archivo ya no existe o ya estaba en la papelera: es una limpieza de mejor
// esfuerzo, nunca debe tumbar el guardado que la dispara.
async function trashAsset(fileId) {
  if (!fileId) return { error: 'Falta el id del archivo' };
  try {
    const drive = await getDriveClient();
    await drive.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true });
    return { id: fileId, trashed: true };
  } catch (err) {
    return { id: fileId, trashed: false, error: err.message };
  }
}

// ---- Handler HTTP ----

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond({});

  try {
    if (event.httpMethod === 'GET') {
      const action = (event.queryStringParameters || {}).action;
      if (action === 'listTrainings') return respond(await listTrainings());
      if (action === 'getTraining') return respond(await getTraining((event.queryStringParameters || {}).id));
      if (action === 'getAsset') return await getAsset((event.queryStringParameters || {}).id);
      return respond({ error: 'Acción no reconocida: ' + action });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      if (body.action === 'saveTraining') return respond(await saveTraining(body));
      if (body.action === 'uploadAsset') return respond(await uploadAsset(body));
      if (body.action === 'deleteTraining') return respond(await deleteTraining(body.id));
      if (body.action === 'trashAsset') return respond(await trashAsset(body.id));
      return respond({ error: 'Acción no reconocida: ' + body.action });
    }

    return respond({ error: 'Método no soportado' }, 405);
  } catch (err) {
    return respond({ error: err.message }, 500);
  }
};
