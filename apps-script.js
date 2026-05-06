/**
 * ERGOMEDI-TRACKER Backend - Google Only (No Firebase)
 * Versión 6: Ultra-compatible (Todo vía GET/JSONP para evitar bloqueos de CORS)
 */

const MEDS_SHEET_NAME = 'medications';
const HISTORY_SHEET_NAME = 'history';
const USERS_SHEET_NAME = 'users';
const FOLDER_NAME = 'ERGOMEDI_PRESCRIPTIONS';

const ADMIN_EMAIL = 'francisco.rojasp@gmail.com';
const ADMIN_PHONE = '+584244736489';

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(MEDS_SHEET_NAME)) {
    ss.insertSheet(MEDS_SHEET_NAME).appendRow(['id', 'userId', 'name', 'dosage', 'times', 'timesPerDay', 'durationDays', 'startDate', 'notes', 'dosesTaken', 'takenTodayCount', 'lastResetDate', 'lastTakenDate', 'prescriptionUrl', 'updatedAt']);
  }
  if (!ss.getSheetByName(HISTORY_SHEET_NAME)) {
    ss.insertSheet(HISTORY_SHEET_NAME).appendRow(['id', 'userId', 'medId', 'medName', 'dosage', 'timestamp', 'date']);
  }
  const usersSheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!usersSheet) {
    ss.insertSheet(USERS_SHEET_NAME).appendRow(['id', 'identifier', 'name', 'lastLogin', 'role', 'phone', 'waApiKey']);
    const sheet = ss.getSheetByName(USERS_SHEET_NAME);
    sheet.appendRow(['admin-001', ADMIN_EMAIL, 'Francisco Rojas (Admin)', new Date(), 'admin', ADMIN_PHONE, '']);
    sheet.appendRow(['admin-002', ADMIN_PHONE, 'Francisco Rojas (Phone Admin)', new Date(), 'admin', ADMIN_PHONE, '']);
  } else {
    // Asegurar que existan las nuevas columnas
    const headers = usersSheet.getRange(1, 1, 1, usersSheet.getLastColumn()).getValues()[0];
    if (!headers.includes('phone')) usersSheet.getRange(1, 6).setValue('phone');
    if (!headers.includes('waApiKey')) usersSheet.getRange(1, 7).setValue('waApiKey');
  }
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  if (!folders.hasNext()) DriveApp.createFolder(FOLDER_NAME);
}

function doGet(e) {
  const action = e.parameter.action;
  const userId = e.parameter.userId;
  const callback = e.parameter.callback;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  let result;
  
  // LOGIN
  if (action === 'login') {
    const identifier = e.parameter.identifier;
    const sheet = ss.getSheetByName(USERS_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    let user = data.find(row => row[1] == identifier);
    
    if (!user) {
      const newId = Utilities.getUuid();
      const role = (identifier === ADMIN_EMAIL || identifier === ADMIN_PHONE) ? 'admin' : 'user';
      sheet.appendRow([newId, identifier, '', new Date(), role]);
      result = { id: newId, identifier: identifier, role: role };
    } else {
      const rowIndex = data.indexOf(user) + 1;
      sheet.getRange(rowIndex, 4).setValue(new Date());
      result = { id: user[0], identifier: user[1], name: user[2], role: user[4], phone: user[5], waApiKey: user[6] };
    }
  } 
  // UPDATE PROFILE
  else if (action === 'updateProfile' && userId) {
    const sheet = ss.getSheetByName(USERS_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const profile = JSON.parse(e.parameter.data);
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == userId) {
        if (profile.name !== undefined) sheet.getRange(i + 1, 3).setValue(profile.name);
        if (profile.phone !== undefined) sheet.getRange(i + 1, 6).setValue(profile.phone);
        if (profile.waApiKey !== undefined) sheet.getRange(i + 1, 7).setValue(profile.waApiKey);
        break;
      }
    }
    result = { success: true };
  }
  // SAVE MED (Enviado vía GET para evitar CORS)
  else if (action === 'saveMed' && userId) {
    const sheet = ss.getSheetByName(MEDS_SHEET_NAME);
    const med = JSON.parse(e.parameter.data);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    let rowIndex = -1;
    if (med.id) {
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] == med.id && data[i][1] == userId) { rowIndex = i + 1; break; }
      }
    }
    const row = headers.map(h => {
      if (h === 'userId') return userId;
      if (h === 'times') return JSON.stringify(med[h]);
      if (h === 'updatedAt') return new Date();
      if (h === 'dosesTaken' || h === 'takenTodayCount' || h === 'durationDays' || h === 'timesPerDay') {
        return parseInt(med[h]) || 0;
      }
      return med[h] || '';
    });
    if (rowIndex > -1) sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    else { med.id = Utilities.getUuid(); row[0] = med.id; sheet.appendRow(row); }
    result = { success: true, id: med.id };
  }
  // DELETE MED — deletes ALL rows with this id (handles duplicates from previous bugs)
  else if (action === 'deleteMed' && userId) {
    const sheet = ss.getSheetByName(MEDS_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    // Iterate in reverse so row indices don't shift as we delete
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][0] == e.parameter.id && data[i][1] == userId) {
        sheet.deleteRow(i + 1);
      }
    }
    result = { success: true };
  }
  // LOG HISTORY
  else if (action === 'logHistory' && userId) {
    const sheet = ss.getSheetByName(HISTORY_SHEET_NAME);
    const log = JSON.parse(e.parameter.data);
    log.id = Utilities.getUuid();
    log.userId = userId;
    const headers = sheet.getDataRange().getValues()[0];
    const row = headers.map(h => log[h] || '');
    sheet.appendRow(row);
    result = { success: true };
  }
  // GET DATA
  else if (userId) {
    if (action === 'getMeds') {
      const sheet = ss.getSheetByName(MEDS_SHEET_NAME);
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const rows = data.slice(1)
        .filter(row => row[1] == userId)
        .map(row => {
          let obj = {};
          headers.forEach((header, i) => obj[header] = row[i]);
          if (obj.times) {
            try { obj.times = JSON.parse(obj.times); } catch(e) { obj.times = []; }
          }
          return obj;
        });

      // Layer 1: Deduplicate by id — keep entry with highest dosesTaken
      const seenById = {};
      rows.forEach(med => {
        const key = String(med.id);
        if (!seenById[key] || (med.dosesTaken || 0) >= (seenById[key].dosesTaken || 0)) {
          seenById[key] = med;
        }
      });

      // Layer 2: Deduplicate by name+dosage — catches rows with DIFFERENT ids that are the same plan
      // (happens when optimistic temp-ids caused multiple appendRow calls in previous sessions)
      const seenByName = {};
      Object.values(seenById).forEach(med => {
        const nameKey = String(med.name).trim().toLowerCase() + '|' + String(med.dosage).trim().toLowerCase();
        if (!seenByName[nameKey] || (med.dosesTaken || 0) >= (seenByName[nameKey].dosesTaken || 0)) {
          seenByName[nameKey] = med;
        }
      });
      result = Object.values(seenByName);
    } else if (action === 'getHistory') {
      const sheet = ss.getSheetByName(HISTORY_SHEET_NAME);
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      result = data.slice(1)
        .filter(row => row[1] == userId)
        .map(row => {
          let obj = {};
          headers.forEach((header, i) => obj[header] = row[i]);
          return obj;
        }).reverse();
    }
  } else {
    result = { error: 'Unauthorized or invalid action' };
  }

  return jsonResponse(result, callback);
}

// doPost se mantiene solo para subida de archivos pesados (base64)
function doPost(e) {
  let postData;
  try {
    postData = JSON.parse(e.postData.contents);
  } catch(err) {
    postData = e.parameter || {};
  }
  const action = postData.action;
  if (action === 'upload') {
    const folder = DriveApp.getFoldersByName(FOLDER_NAME).next();
    const blob = Utilities.newBlob(Utilities.base64Decode(postData.base64), postData.mimeType, postData.fileName);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return jsonResponse({ url: file.getUrl() }, null);
  }
  return jsonResponse({error: 'only upload supported in doPost'}, null);
}

/**
 * Función que debe ejecutarse cada minuto mediante un activador (trigger).
 *
 * CORRECCIONES:
 * 1. Zona horaria: Compara horas como strings "HH:MM" usando la zona del script
 *    (Ajusta en: Configuración del proyecto de Apps Script > Zona horaria)
 * 2. Deduplicación: Usa PropertiesService para no re-enviar la misma alerta
 * 3. Canal doble: Email (nativo, sin config extra) + WhatsApp si el usuario lo configuró
 */
function checkAndSendAlerts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const usersSheet = ss.getSheetByName(USERS_SHEET_NAME);
  const medsSheet = ss.getSheetByName(MEDS_SHEET_NAME);

  const usersData = usersSheet.getDataRange().getValues();
  const medsData = medsSheet.getDataRange().getValues();

  // Hora actual en la zona horaria del script (configúrala en Apps Script > Configuración)
  const now = new Date();
  const nowStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'HH:mm');
  const today = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  // Cache anti-duplicados: clave = userId_medId_time_offset
  const props = PropertiesService.getScriptProperties();
  const cacheKey = 'alerts_sent_' + today;
  let sentAlerts = {};
  try { sentAlerts = JSON.parse(props.getProperty(cacheKey) || '{}'); } catch(e) {}

  // Generar los 3 tiempos de alerta: -10min, -5min, 0min
  function addMinutes(timeStr, mins) {
    const [h, m] = timeStr.split(':').map(Number);
    const d = new Date(2000, 0, 1, h, m + mins);
    return Utilities.formatDate(d, 'UTC', 'HH:mm');
  }

  usersData.slice(1).forEach(userRow => {
    const userId    = String(userRow[0]);
    const userEmail = String(userRow[1]); // Email registrado en el login
    const phone     = String(userRow[5] || '');
    const apiKey    = String(userRow[6] || '');

    medsData.slice(1).forEach(medRow => {
      if (String(medRow[1]) !== userId) return;

      const medId   = String(medRow[0]);
      const medName = medRow[2];
      const dosage  = medRow[3];
      let times = [];
      try { times = JSON.parse(medRow[4] || '[]'); } catch(e) {}

      times.forEach(scheduledTime => {
        // Calcular los 3 momentos de alerta
        const alerts = [
          { offset: -10, triggerTime: addMinutes(scheduledTime, -10), label: '10 min' },
          { offset: -5,  triggerTime: addMinutes(scheduledTime, -5),  label: '5 min'  },
          { offset: 0,   triggerTime: scheduledTime,                  label: '¡AHORA!'  },
        ];

        alerts.forEach(alert => {
          if (alert.triggerTime !== nowStr) return;

          // Clave única para este envío
          const dedupeKey = `${userId}_${medId}_${scheduledTime}_${alert.offset}`;
          if (sentAlerts[dedupeKey]) return; // Ya fue enviada

          // ── MENSAJE ──────────────────────────────────────────────
          let subject = '';
          let body    = '';
          let waMsg   = '';

          if (alert.offset === -10) {
            subject = `⏰ En 10 minutos: ${medName}`;
            body    = `Hola,\n\nEn 10 minutos es hora de tomar tu dosis de:\n\n• Medicamento: ${medName}\n• Dosis: ${dosage}\n• Hora programada: ${scheduledTime}\n\nPrepara tu medicación con anticipación.\n\n— ERGOMEDI-TRACKER`;
            waMsg   = `⏰ *Recordatorio ERGOMEDI* _(10 min)_: En 10 minutos debes tomar *${medName}* (${dosage}) a las ${scheduledTime}. ¡Prepárala!`;
          } else if (alert.offset === -5) {
            subject = `⚠️ En 5 minutos: ${medName}`;
            body    = `Hola,\n\nEn 5 minutos es hora de tomar tu dosis de:\n\n• Medicamento: ${medName}\n• Dosis: ${dosage}\n• Hora programada: ${scheduledTime}\n\n¡No lo olvides!\n\n— ERGOMEDI-TRACKER`;
            waMsg   = `⚠️ *Recordatorio ERGOMEDI* _(5 min)_: Faltan 5 minutos para tomar *${medName}* (${dosage}).`;
          } else {
            subject = `✅ ¡HORA DE TU DOSIS! ${medName}`;
            body    = `Hola,\n\n¡Es el momento de tomar tu medicamento!\n\n• Medicamento: ${medName}\n• Dosis: ${dosage}\n• Hora: ${scheduledTime}\n\nAbre ERGOMEDI-TRACKER y confirma la toma.\n\n— ERGOMEDI-TRACKER`;
            waMsg   = `✅ *¡ES HORA! ERGOMEDI*: Toma tu dosis de *${medName}* (${dosage}) ahora mismo. ¡No lo olvides!`;
          }

          // ── EMAIL (canal principal, siempre disponible) ───────────
          if (userEmail && userEmail.includes('@')) {
            try {
              MailApp.sendEmail({ to: userEmail, subject: subject, body: body });
              console.log(`Email enviado a ${userEmail} para ${medName} (${alert.label})`);
            } catch(err) {
              console.error(`Error email a ${userEmail}: ${err.message}`);
            }
          }

          // ── WHATSAPP (canal secundario, solo si está configurado) ──
          if (phone && apiKey) {
            sendWhatsAppMessage(phone, waMsg, apiKey);
          }

          // Marcar como enviada
          sentAlerts[dedupeKey] = true;
        });
      });
    });
  });

  // Guardar cache (se auto-limpia al cambiar de día)
  props.setProperty(cacheKey, JSON.stringify(sentAlerts));

  // Limpiar cache de días anteriores para no acumular
  const yesterday = Utilities.formatDate(new Date(now.getTime() - 86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  props.deleteProperty('alerts_sent_' + yesterday);
}

function sendWhatsAppMessage(phone, text, apiKey) {
  const cleanPhone = phone.replace('+', '').replace(/\s/g, '');
  const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(text)}&apikey=${apiKey}`;
  try {
    UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    console.log(`WhatsApp enviado a ${phone}`);
  } catch (e) {
    console.error(`Error WhatsApp a ${phone}: ${e.message}`);
  }
}

function jsonResponse(data, callback) {
  const json = JSON.stringify(data);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run this ONCE from the Apps Script editor to physically delete all duplicate
 * medication rows from the Sheet, keeping the one with the highest dosesTaken.
 * Menu: Run > cleanupDuplicates
 */
function cleanupDuplicates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('medications');
  if (!sheet) { Logger.log('Sheet not found'); return; }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const nameIdx   = headers.indexOf('name');
  const dosageIdx = headers.indexOf('dosage');
  const userIdx   = headers.indexOf('userId');
  const doseIdx   = headers.indexOf('dosesTaken');

  // Map: nameKey -> { rowNum (1-indexed), dosesTaken }
  const best = {};
  const rowsToDelete = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const nameKey = String(row[userIdx]) + '|' +
                    String(row[nameIdx]).trim().toLowerCase() + '|' +
                    String(row[dosageIdx]).trim().toLowerCase();
    const doses = parseInt(row[doseIdx]) || 0;
    const sheetRow = i + 1; // convert 0-based array index to 1-based sheet row

    if (!best[nameKey]) {
      best[nameKey] = { sheetRow, doses };
    } else if (doses >= best[nameKey].doses) {
      rowsToDelete.push(best[nameKey].sheetRow); // old best is now a duplicate
      best[nameKey] = { sheetRow, doses };
    } else {
      rowsToDelete.push(sheetRow); // current row is the duplicate
    }
  }

  // Delete in reverse order so indices don't shift
  rowsToDelete.sort((a, b) => b - a).forEach(r => sheet.deleteRow(r));
  Logger.log('Deleted ' + rowsToDelete.length + ' duplicate rows.');
}
