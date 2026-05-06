/**
 * ERGOMEDI-TRACKER Backend - Google Only (No Firebase)
 * Versión 7: Multi-usuario con timezone por usuario, nombre de paciente y médico
 *
 * COLUMNAS USERS:
 *   [0] id | [1] identifier | [2] name (legacy) | [3] lastLogin | [4] role
 *   [5] phone | [6] waApiKey | [7] patientName | [8] doctorName | [9] utcOffset
 *
 * utcOffset: offset en MINUTOS respecto a UTC (e.g. Venezuela UTC-4 → -240)
 *            Lo envía el cliente con cada petición como getTimezoneOffset() negado.
 */

const MEDS_SHEET_NAME    = 'medications';
const HISTORY_SHEET_NAME = 'history';
const USERS_SHEET_NAME   = 'users';
const FOLDER_NAME        = 'ERGOMEDI_PRESCRIPTIONS';

const ADMIN_EMAIL = 'francisco.rojasp@gmail.com';
const ADMIN_PHONE = '+584244736489';

// ── Setup (ejecutar UNA vez desde el editor de Apps Script) ───────────
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Medications sheet
  if (!ss.getSheetByName(MEDS_SHEET_NAME)) {
    ss.insertSheet(MEDS_SHEET_NAME).appendRow([
      'id','userId','name','dosage','times','timesPerDay',
      'durationDays','startDate','notes','dosesTaken',
      'takenTodayCount','lastResetDate','lastTakenDate','prescriptionUrl','updatedAt'
    ]);
  }

  // History sheet
  if (!ss.getSheetByName(HISTORY_SHEET_NAME)) {
    ss.insertSheet(HISTORY_SHEET_NAME).appendRow([
      'id','userId','medId','medName','dosage','timestamp','date'
    ]);
  }

  // Users sheet
  const usersSheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!usersSheet) {
    const s = ss.insertSheet(USERS_SHEET_NAME);
    s.appendRow(['id','identifier','name','lastLogin','role','phone','waApiKey','patientName','doctorName','utcOffset']);
    s.appendRow(['admin-001', ADMIN_EMAIL,  'Francisco Rojas (Admin)',        new Date(), 'admin', ADMIN_PHONE, '', 'Francisco Rojas Pineda', '', -240]);
    s.appendRow(['admin-002', ADMIN_PHONE,  'Francisco Rojas (Phone Admin)',  new Date(), 'admin', ADMIN_PHONE, '', 'Francisco Rojas Pineda', '', -240]);
  } else {
    // Ensure new columns exist
    const headers = usersSheet.getRange(1, 1, 1, usersSheet.getLastColumn()).getValues()[0];
    const ensure  = (col, name) => { if (!headers.includes(name)) usersSheet.getRange(1, col).setValue(name); };
    ensure(6,  'phone');
    ensure(7,  'waApiKey');
    ensure(8,  'patientName');
    ensure(9,  'doctorName');
    ensure(10, 'utcOffset');
  }

  // Prescriptions folder
  if (!DriveApp.getFoldersByName(FOLDER_NAME).hasNext()) {
    DriveApp.createFolder(FOLDER_NAME);
  }
}

// ── doGet ─────────────────────────────────────────────────────────────
function doGet(e) {
  const action   = e.parameter.action;
  const userId   = e.parameter.userId;
  const callback = e.parameter.callback;
  const ss       = SpreadsheetApp.getActiveSpreadsheet();

  let result;

  // ── LOGIN ────────────────────────────────────────────────────────────
  if (action === 'login') {
    const identifier = e.parameter.identifier;
    // Capture utcOffset sent by the client (in minutes)
    const utcOffset  = parseInt(e.parameter.utcOffset) || 0;
    const sheet      = ss.getSheetByName(USERS_SHEET_NAME);
    const data       = sheet.getDataRange().getValues();
    let user         = data.find(row => row[1] == identifier);

    if (!user) {
      // New user — auto-register
      const newId = Utilities.getUuid();
      const role  = (identifier === ADMIN_EMAIL || identifier === ADMIN_PHONE) ? 'admin' : 'user';
      sheet.appendRow([newId, identifier, '', new Date(), role, '', '', '', '', utcOffset]);
      result = { id: newId, identifier, role, patientName: '', doctorName: '', utcOffset };
    } else {
      const rowIndex = data.indexOf(user) + 1;
      // Update lastLogin and utcOffset
      sheet.getRange(rowIndex, 4).setValue(new Date());
      sheet.getRange(rowIndex, 10).setValue(utcOffset);
      result = {
        id:          user[0],
        identifier:  user[1],
        name:        user[2],
        role:        user[4],
        phone:       user[5],
        waApiKey:    user[6],
        patientName: user[7] || '',
        doctorName:  user[8] || '',
        utcOffset:   utcOffset
      };
    }
  }

  // ── UPDATE PROFILE ───────────────────────────────────────────────────
  else if (action === 'updateProfile' && userId) {
    const sheet   = ss.getSheetByName(USERS_SHEET_NAME);
    const data    = sheet.getDataRange().getValues();
    const profile = JSON.parse(e.parameter.data);
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == userId) {
        if (profile.name        !== undefined) sheet.getRange(i + 1, 3).setValue(profile.name);
        if (profile.phone       !== undefined) sheet.getRange(i + 1, 6).setValue(profile.phone);
        if (profile.waApiKey    !== undefined) sheet.getRange(i + 1, 7).setValue(profile.waApiKey);
        if (profile.patientName !== undefined) sheet.getRange(i + 1, 8).setValue(profile.patientName);
        if (profile.doctorName  !== undefined) sheet.getRange(i + 1, 9).setValue(profile.doctorName);
        if (profile.utcOffset   !== undefined) sheet.getRange(i + 1, 10).setValue(profile.utcOffset);
        break;
      }
    }
    result = { success: true };
  }

  // ── SAVE MED (via GET to avoid CORS) ─────────────────────────────────
  else if (action === 'saveMed' && userId) {
    const sheet   = ss.getSheetByName(MEDS_SHEET_NAME);
    const med     = JSON.parse(e.parameter.data);
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    let rowIndex  = -1;
    if (med.id) {
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] == med.id && data[i][1] == userId) { rowIndex = i + 1; break; }
      }
    }
    const row = headers.map(h => {
      if (h === 'userId')    return userId;
      if (h === 'times')     return JSON.stringify(med[h]);
      if (h === 'updatedAt') return new Date();
      if (['dosesTaken','takenTodayCount','durationDays','timesPerDay'].includes(h)) return parseInt(med[h]) || 0;
      return med[h] || '';
    });
    if (rowIndex > -1) sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    else { med.id = Utilities.getUuid(); row[0] = med.id; sheet.appendRow(row); }
    result = { success: true, id: med.id };
  }

  // ── DELETE MED ───────────────────────────────────────────────────────
  else if (action === 'deleteMed' && userId) {
    const sheet = ss.getSheetByName(MEDS_SHEET_NAME);
    const data  = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][0] == e.parameter.id && data[i][1] == userId) sheet.deleteRow(i + 1);
    }
    result = { success: true };
  }

  // ── LOG HISTORY ──────────────────────────────────────────────────────
  else if (action === 'logHistory' && userId) {
    const sheet   = ss.getSheetByName(HISTORY_SHEET_NAME);
    const log     = JSON.parse(e.parameter.data);
    log.id        = Utilities.getUuid();
    log.userId    = userId;
    const headers = sheet.getDataRange().getValues()[0];
    sheet.appendRow(headers.map(h => log[h] || ''));
    result = { success: true };
  }

  // ── GET MEDS ─────────────────────────────────────────────────────────
  else if (action === 'getMeds' && userId) {
    const sheet      = ss.getSheetByName(MEDS_SHEET_NAME);
    const data       = sheet.getDataRange().getValues();
    const headers    = data[0];
    const dateFields = ['lastResetDate','startDate'];
    const intFields  = ['dosesTaken','takenTodayCount','durationDays','timesPerDay'];
    const toYMD = d => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const rows = data.slice(1)
      .filter(row => row[1] == userId)
      .map(row => {
        const obj = {};
        headers.forEach((h, i) => {
          const val = row[i];
          if (dateFields.includes(h) && val instanceof Date) obj[h] = toYMD(val);
          else if (intFields.includes(h)) obj[h] = parseInt(val) || 0;
          else obj[h] = val;
        });
        if (obj.times) { try { obj.times = JSON.parse(obj.times); } catch(e) { obj.times = []; } }
        return obj;
      });

    // Deduplicate by id, then by name+dosage
    const byId   = {};
    rows.forEach(m => { const k = String(m.id); if (!byId[k] || m.dosesTaken >= (byId[k].dosesTaken||0)) byId[k] = m; });
    const byName = {};
    Object.values(byId).forEach(m => {
      const k = `${String(m.name).trim().toLowerCase()}|${String(m.dosage).trim().toLowerCase()}`;
      if (!byName[k] || m.dosesTaken >= (byName[k].dosesTaken||0)) byName[k] = m;
    });
    result = Object.values(byName);
  }

  // ── GET HISTORY ──────────────────────────────────────────────────────
  else if (action === 'getHistory' && userId) {
    const sheet   = ss.getSheetByName(HISTORY_SHEET_NAME);
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    result = data.slice(1)
      .filter(row => row[1] == userId)
      .map(row => { const obj = {}; headers.forEach((h, i) => obj[h] = row[i]); return obj; })
      .reverse();
  }

  else {
    result = { error: 'Unauthorized or invalid action' };
  }

  return jsonResponse(result, callback);
}

// ── doPost (solo para subida de imágenes en base64) ───────────────────
function doPost(e) {
  let postData;
  try { postData = JSON.parse(e.postData.contents); } catch(err) { postData = e.parameter || {}; }
  if (postData.action === 'upload') {
    const folder = DriveApp.getFoldersByName(FOLDER_NAME).next();
    const blob   = Utilities.newBlob(Utilities.base64Decode(postData.base64), postData.mimeType, postData.fileName);
    const file   = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return jsonResponse({ url: file.getUrl() }, null);
  }
  return jsonResponse({ error: 'only upload supported in doPost' }, null);
}

// ── checkAndSendAlerts ────────────────────────────────────────────────
/**
 * Se ejecuta cada minuto mediante un trigger (activador).
 *
 * CORRECCIÓN DE TIMEZONE:
 *   Cada usuario almacena su `utcOffset` (minutos respecto a UTC,
 *   equivalente al valor que devuelve -new Date().getTimezoneOffset() en JS).
 *   Ej: Venezuela UTC-4 → utcOffset = -240
 *
 *   Para comparar con los horarios programados (que están en hora LOCAL
 *   del usuario), calculamos qué hora local es PARA ESE USUARIO en este momento:
 *     localMs = Date.now() + utcOffset * 60_000
 *   y formateamos como "HH:MM".
 */
function checkAndSendAlerts() {
  const ss          = SpreadsheetApp.getActiveSpreadsheet();
  const usersSheet  = ss.getSheetByName(USERS_SHEET_NAME);
  const medsSheet   = ss.getSheetByName(MEDS_SHEET_NAME);
  const usersData   = usersSheet.getDataRange().getValues();
  const medsData    = medsSheet.getDataRange().getValues();

  const nowUtcMs = Date.now(); // ms since epoch, timezone-agnostic
  const todayUtc = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');

  // Anti-duplicate cache (resets daily)
  const props     = PropertiesService.getScriptProperties();
  const cacheKey  = 'alerts_sent_' + todayUtc;
  let sentAlerts  = {};
  try { sentAlerts = JSON.parse(props.getProperty(cacheKey) || '{}'); } catch(e) {}

  function addMinutes(timeStr, mins) {
    const [h, m] = timeStr.split(':').map(Number);
    const d = new Date(2000, 0, 1, h, m + mins);
    return Utilities.formatDate(d, 'UTC', 'HH:mm');
  }

  usersData.slice(1).forEach(userRow => {
    const userId      = String(userRow[0]);
    const userEmail   = String(userRow[1]);
    const phone       = String(userRow[5] || '');
    const apiKey      = String(userRow[6] || '');
    const patientName = String(userRow[7] || '');

    // UTC offset in minutes (e.g. -240 for UTC-4)
    const utcOffset   = parseInt(userRow[9]) || 0;

    // Calculate current LOCAL time for this user
    const localMs     = nowUtcMs + utcOffset * 60_000;
    const localDate   = new Date(localMs);
    const nowHHMM     = Utilities.formatDate(localDate, 'UTC', 'HH:mm'); // use UTC formatter on adjusted time

    medsData.slice(1).forEach(medRow => {
      if (String(medRow[1]) !== userId) return;
      const medId   = String(medRow[0]);
      const medName = medRow[2];
      const dosage  = medRow[3];
      let times     = [];
      try { times = JSON.parse(medRow[4] || '[]'); } catch(e) {}

      times.forEach(scheduledTime => {
        const alerts = [
          { offset: -10, triggerTime: addMinutes(scheduledTime, -10), label: '10 min' },
          { offset: -5,  triggerTime: addMinutes(scheduledTime, -5),  label: '5 min'  },
          { offset:  0,  triggerTime: scheduledTime,                  label: '¡AHORA!' },
        ];

        alerts.forEach(alert => {
          if (alert.triggerTime !== nowHHMM) return;

          const dedupeKey = `${userId}_${medId}_${scheduledTime}_${alert.offset}`;
          if (sentAlerts[dedupeKey]) return;

          const greeting = patientName ? `Hola ${patientName},` : 'Hola,';
          let subject = '', body = '', waMsg = '';

          if (alert.offset === -10) {
            subject = `⏰ En 10 minutos: ${medName}`;
            body    = `${greeting}\n\nEn 10 minutos es hora de tomar:\n\n• Medicamento: ${medName}\n• Dosis: ${dosage}\n• Hora: ${scheduledTime}\n\nPrepara tu medicación con anticipación.\n\n— ERGOMEDI-TRACKER`;
            waMsg   = `⏰ *Recordatorio ERGOMEDI* _(10 min)_: ${greeting} En 10 minutos debes tomar *${medName}* (${dosage}) a las ${scheduledTime}. ¡Prepárala!`;
          } else if (alert.offset === -5) {
            subject = `⚠️ En 5 minutos: ${medName}`;
            body    = `${greeting}\n\nEn 5 minutos es hora de:\n\n• Medicamento: ${medName}\n• Dosis: ${dosage}\n• Hora: ${scheduledTime}\n\n¡No lo olvides!\n\n— ERGOMEDI-TRACKER`;
            waMsg   = `⚠️ *Recordatorio ERGOMEDI* _(5 min)_: Faltan 5 minutos para tomar *${medName}* (${dosage}).`;
          } else {
            subject = `✅ ¡HORA DE TU DOSIS! ${medName}`;
            body    = `${greeting}\n\n¡Es el momento de tu medicamento!\n\n• Medicamento: ${medName}\n• Dosis: ${dosage}\n• Hora: ${scheduledTime}\n\nAbre ERGOMEDI-TRACKER y confirma la toma.\n\n— ERGOMEDI-TRACKER`;
            waMsg   = `✅ *¡ES HORA! ERGOMEDI*: ${greeting} Toma tu dosis de *${medName}* (${dosage}) ahora mismo.`;
          }

          // Email
          if (userEmail && userEmail.includes('@')) {
            try { MailApp.sendEmail({ to: userEmail, subject, body }); } catch(err) {}
          }

          // WhatsApp (CallMeBot)
          if (phone && apiKey) sendWhatsAppMessage(phone, waMsg, apiKey);

          sentAlerts[dedupeKey] = true;
        });
      });
    });
  });

  // Persist cache; clean up yesterday
  props.setProperty(cacheKey, JSON.stringify(sentAlerts));
  const yesterday = Utilities.formatDate(new Date(nowUtcMs - 86400000), 'UTC', 'yyyy-MM-dd');
  props.deleteProperty('alerts_sent_' + yesterday);
}

function sendWhatsAppMessage(phone, text, apiKey) {
  const cleanPhone = phone.replace('+', '').replace(/\s/g, '');
  const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(text)}&apikey=${apiKey}`;
  try { UrlFetchApp.fetch(url, { muteHttpExceptions: true }); } catch(e) {}
}

function jsonResponse(data, callback) {
  const json = JSON.stringify(data);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run ONCE from the editor to physically delete duplicate medication rows.
 */
function cleanupDuplicates() {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const sheet   = ss.getSheetByName('medications');
  if (!sheet) { Logger.log('Sheet not found'); return; }
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const nameIdx   = headers.indexOf('name');
  const dosageIdx = headers.indexOf('dosage');
  const userIdx   = headers.indexOf('userId');
  const doseIdx   = headers.indexOf('dosesTaken');
  const best = {};
  const rowsToDelete = [];
  for (let i = 1; i < data.length; i++) {
    const row     = data[i];
    const nameKey = `${row[userIdx]}|${String(row[nameIdx]).trim().toLowerCase()}|${String(row[dosageIdx]).trim().toLowerCase()}`;
    const doses   = parseInt(row[doseIdx]) || 0;
    const sheetRow = i + 1;
    if (!best[nameKey]) { best[nameKey] = { sheetRow, doses }; }
    else if (doses >= best[nameKey].doses) { rowsToDelete.push(best[nameKey].sheetRow); best[nameKey] = { sheetRow, doses }; }
    else { rowsToDelete.push(sheetRow); }
  }
  rowsToDelete.sort((a, b) => b - a).forEach(r => sheet.deleteRow(r));
  Logger.log('Deleted ' + rowsToDelete.length + ' duplicate rows.');
}
