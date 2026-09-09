// Backend del módulo de entrenamiento: Google Sheets como repositorio de
// manuales y Google Drive como almacenamiento de imágenes.
//
// Instalación (una sola vez):
// 1. Crea una hoja de cálculo nueva en Google Sheets.
// 2. Extensiones > Apps Script. Borra el contenido de Code.gs y pega este archivo.
// 3. Implementar > Nueva implementación > Tipo "Aplicación web".
//    - Ejecutar como: Yo (tu cuenta).
//    - Quién tiene acceso: Cualquier usuario.
// 4. Copia la URL que termina en /exec y pégala como API_URL en HTMLS/config.js.

var SHEET_TRAININGS = 'trainings';
var DRIVE_ROOT_FOLDER_NAME = 'PRP Energki - Manuales (Imagenes)';
var TRAININGS_HEADER = ['id', 'title', 'status', 'version', 'updated_at', 'content_json'];

function doGet(e) {
  try {
    var action = e.parameter.action;
    if (action === 'listTrainings') return respond(listTrainings());
    if (action === 'getTraining') return respond(getTraining(e.parameter.id));
    return respond({ error: 'Acción no reconocida: ' + action });
  } catch (err) {
    return respond({ error: err.message });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action === 'saveTraining') return respond(saveTraining(body));
    if (body.action === 'uploadAsset') return respond(uploadAsset(body));
    if (body.action === 'deleteTraining') return respond(deleteTraining(body.id));
    return respond({ error: 'Acción no reconocida: ' + body.action });
  } catch (err) {
    return respond({ error: err.message });
  }
}

function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TRAININGS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_TRAININGS);
    sheet.appendRow(TRAININGS_HEADER);
  }
  return sheet;
}

function listTrainings() {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var rows = sheet.getRange(2, 1, lastRow - 1, TRAININGS_HEADER.length).getValues();
  return rows
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      return { id: r[0], title: r[1], status: r[2], version: r[3], updatedAt: r[4] };
    });
}

function findRowIndexById(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2; // +2: encabezado en fila 1, datos desde fila 2
  }
  return -1;
}

function getTraining(id) {
  if (!id) return { error: 'Falta el id' };
  var sheet = getSheet();
  var rowIndex = findRowIndexById(sheet, id);
  if (rowIndex === -1) return { error: 'Manual no encontrado' };

  var row = sheet.getRange(rowIndex, 1, 1, TRAININGS_HEADER.length).getValues()[0];
  var content = JSON.parse(row[5] || '{}');
  content.id = row[0];
  content.title = row[1];
  content.status = row[2];
  content.version = row[3];
  return content;
}

function saveTraining(payload) {
  var sheet = getSheet();
  var id = payload.id;
  var now = new Date().toISOString();
  var contentJson = JSON.stringify({
    configuracion: payload.configuracion || {},
    canvas: payload.canvas || null,
    paneles: payload.paneles || [],
    paginas: payload.paginas || null,
    steps: payload.steps || []
  });

  if (id) {
    var rowIndex = findRowIndexById(sheet, id);
    if (rowIndex !== -1) {
      var currentVersion = Number(sheet.getRange(rowIndex, 4).getValue()) || 1;
      sheet.getRange(rowIndex, 2, 1, 5).setValues([[
        payload.title || 'Sin título',
        payload.status || 'draft',
        currentVersion + 1,
        now,
        contentJson
      ]]);
      return { id: id, version: currentVersion + 1 };
    }
    // El id vino del cliente (manual nuevo con id pre-generado para poder subir
    // imágenes a su carpeta antes de guardar) pero aún no existe una fila: se crea con ese mismo id.
    sheet.appendRow([id, payload.title || 'Sin título', payload.status || 'draft', 1, now, contentJson]);
    return { id: id, version: 1 };
  }

  id = Utilities.getUuid();
  sheet.appendRow([id, payload.title || 'Sin título', payload.status || 'draft', 1, now, contentJson]);
  return { id: id, version: 1 };
}

function deleteTraining(id) {
  if (!id) return { error: 'Falta el id' };
  var sheet = getSheet();
  var rowIndex = findRowIndexById(sheet, id);
  if (rowIndex === -1) return { error: 'Manual no encontrado' };

  sheet.deleteRow(rowIndex);

  var folder = findTrainingFolderById(id);
  if (folder) folder.setTrashed(true);

  return { id: id, deleted: true };
}

function sanitizeName(str) {
  var cleaned = String(str || '').replace(/[\\\/:*?"<>|]/g, '-').trim();
  return cleaned || 'sin-titulo';
}

function getRootFolder() {
  var folders = DriveApp.getFoldersByName(DRIVE_ROOT_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(DRIVE_ROOT_FOLDER_NAME);
}

// Busca la carpeta de un manual por el identificador corto en su nombre,
// sin depender del título (que puede haber cambiado desde que se creó).
function findTrainingFolderById(trainingId) {
  var suffix = '(' + String(trainingId).slice(0, 8) + ')';
  var root = getRootFolder();
  var folders = root.getFolders();
  while (folders.hasNext()) {
    var f = folders.next();
    if (f.getName().indexOf(suffix) !== -1) return f;
  }
  return null;
}

// Una carpeta por manual, nombrada con el título y un identificador corto y estable.
function getTrainingFolder(trainingId, title) {
  var existing = findTrainingFolderById(trainingId);
  if (existing) return existing;
  var root = getRootFolder();
  var folderName = sanitizeName(title) + ' (' + String(trainingId).slice(0, 8) + ')';
  return root.createFolder(folderName);
}

var MIME_EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

function countFilesInFolder(folder) {
  var count = 0;
  var files = folder.getFiles();
  while (files.hasNext()) { files.next(); count++; }
  return count;
}

function uploadAsset(payload) {
  if (!payload.base64) return { error: 'Falta la imagen' };
  if (!payload.trainingId) return { error: 'Falta el id del manual' };

  var folder = getTrainingFolder(payload.trainingId, payload.title);
  var base64Data = String(payload.base64).split(',').pop();
  var mimeType = payload.mimeType || 'image/png';
  var bytes = Utilities.base64Decode(base64Data);

  // Sin nombre de archivo original: {título}-{número de imagen}-{fecha}.
  // El número sube con cada imagen nueva del mismo manual, así nunca se repite.
  var imageNumber = countFilesInFolder(folder) + 1;
  var date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  var extension = MIME_EXTENSIONS[mimeType] || 'png';
  var fileName = sanitizeName(payload.title) + '-' + imageNumber + '-' + date + '.' + extension;

  var blob = Utilities.newBlob(bytes, mimeType, fileName);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { assetId: file.getId(), url: 'https://lh3.googleusercontent.com/d/' + file.getId() };
}
