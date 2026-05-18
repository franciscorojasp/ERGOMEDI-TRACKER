/**
 * ERGOMEDI-TRACKER Backend - Google Only (No Firebase)
 * Version 7: Multi-usuario con timezone por usuario, nombre de paciente y medico
 *
 * COLUMNAS USERS:
 *   [0] id | [1] identifier | [2] name (legacy) | [3] lastLogin | [4] role
 *   [5] phone | [6] waApiKey | [7] patientName | [8] doctorName | [9] utcOffset
 *
 * utcOffset: offset en MINUTOS respecto a UTC (Venezuela UTC-4 -> -240)
 *            Lo envia el cliente con cada peticion como -new Date().getTimezoneOffset()
 */

var MEDS_SHEET_NAME    = 'medications';
var HISTORY_SHEET_NAME = 'history';
var USERS_SHEET_NAME   = 'users';
var FOLDER_NAME        = 'ERGOMEDI_PRESCRIPTIONS';

var ADMIN_EMAIL = 'francisco.rojasp@gmail.com';
var ADMIN_PHONE = '+584244736489';

// ==========================================================
// setup() - Ejecutar UNA vez desde el editor de Apps Script
// ==========================================================
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

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
  var usersSheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!usersSheet) {
    var s = ss.insertSheet(USERS_SHEET_NAME);
    s.appendRow(['id','identifier','name','lastLogin','role','phone','waApiKey','patientName','doctorName','utcOffset']);
    s.appendRow(['admin-001', ADMIN_EMAIL, 'Francisco Rojas (Admin)',       new Date(), 'admin', ADMIN_PHONE, '', 'Francisco Rojas Pineda', '', -240]);
    s.appendRow(['admin-002', ADMIN_PHONE, 'Francisco Rojas (Phone Admin)', new Date(), 'admin', ADMIN_PHONE, '', 'Francisco Rojas Pineda', '', -240]);
  } else {
    // Ensure new columns exist
    var headers = usersSheet.getRange(1, 1, 1, usersSheet.getLastColumn()).getValues()[0];
    if (headers.indexOf('phone')       < 0) usersSheet.getRange(1, 6).setValue('phone');
    if (headers.indexOf('waApiKey')    < 0) usersSheet.getRange(1, 7).setValue('waApiKey');
    if (headers.indexOf('patientName') < 0) usersSheet.getRange(1, 8).setValue('patientName');
    if (headers.indexOf('doctorName')  < 0) usersSheet.getRange(1, 9).setValue('doctorName');
    if (headers.indexOf('utcOffset')   < 0) usersSheet.getRange(1, 10).setValue('utcOffset');
  }

  // Prescriptions folder
  if (!DriveApp.getFoldersByName(FOLDER_NAME).hasNext()) {
    DriveApp.createFolder(FOLDER_NAME);
  }
}

// ==========================================================
// doGet - Maneja todas las peticiones GET / JSONP
// ==========================================================
function doGet(e) {
  var action   = e.parameter.action;
  var userId   = e.parameter.userId;
  var callback = e.parameter.callback;
  var ss       = SpreadsheetApp.getActiveSpreadsheet();

  var result;

  // ---------- LOGIN ----------
  if (action === 'login') {
    var identifier = e.parameter.identifier;
    var utcOffset  = parseInt(e.parameter.utcOffset) || 0;
    var sheet      = ss.getSheetByName(USERS_SHEET_NAME);
    var data       = sheet.getDataRange().getValues();
    var user       = null;
    for (var i = 1; i < data.length; i++) {
      if (data[i][1] == identifier) { user = data[i]; break; }
    }

    if (!user) {
      // New user - auto-register
      var newId = Utilities.getUuid();
      var role  = (identifier === ADMIN_EMAIL || identifier === ADMIN_PHONE) ? 'admin' : 'user';
      sheet.appendRow([newId, identifier, '', new Date(), role, '', '', '', '', utcOffset]);
      result = { id: newId, identifier: identifier, role: role, patientName: '', doctorName: '', utcOffset: utcOffset };
    } else {
      var rowIndex = data.indexOf(user) + 1;
      sheet.getRange(rowIndex, 4).setValue(new Date()); // lastLogin
      sheet.getRange(rowIndex, 10).setValue(utcOffset); // refresh utcOffset
      result = {
        id:          user[0],
        identifier:  user[1],
        name:        user[2],
        role:        user[4],
        phone:       user[5]       || '',
        waApiKey:    user[6]       || '',
        patientName: user[7]       || '',
        doctorName:  user[8]       || '',
        utcOffset:   utcOffset
      };
    }
  }

  // ---------- UPDATE PROFILE ----------
  else if (action === 'updateProfile' && userId) {
    var sheet2  = ss.getSheetByName(USERS_SHEET_NAME);
    var data2   = sheet2.getDataRange().getValues();
    var profile = JSON.parse(e.parameter.data);
    for (var j = 1; j < data2.length; j++) {
      if (data2[j][0] == userId) {
        if (profile.name        !== undefined) sheet2.getRange(j + 1, 3).setValue(profile.name);
        if (profile.phone       !== undefined) sheet2.getRange(j + 1, 6).setValue(profile.phone);
        if (profile.waApiKey    !== undefined) sheet2.getRange(j + 1, 7).setValue(profile.waApiKey);
        if (profile.patientName !== undefined) sheet2.getRange(j + 1, 8).setValue(profile.patientName);
        if (profile.doctorName  !== undefined) sheet2.getRange(j + 1, 9).setValue(profile.doctorName);
        if (profile.utcOffset   !== undefined) sheet2.getRange(j + 1, 10).setValue(profile.utcOffset);
        break;
      }
    }
    result = { success: true };
  }

  // ---------- SAVE MED (via GET to avoid CORS) ----------
  else if (action === 'saveMed' && userId) {
    var sheet3   = ss.getSheetByName(MEDS_SHEET_NAME);
    var med      = JSON.parse(e.parameter.data);
    var data3    = sheet3.getDataRange().getValues();
    var headers3 = data3[0];
    var rowIndex3 = -1;
    if (med.id) {
      for (var k = 1; k < data3.length; k++) {
        if (data3[k][0] == med.id && data3[k][1] == userId) { rowIndex3 = k + 1; break; }
      }
    }
    var intFields = ['dosesTaken','takenTodayCount','durationDays','timesPerDay'];
    var row = headers3.map(function(h) {
      if (h === 'userId')    return userId;
      if (h === 'times')     return JSON.stringify(med[h]);
      if (h === 'updatedAt') return new Date();
      if (intFields.indexOf(h) >= 0) return parseInt(med[h]) || 0;
      return med[h] || '';
    });
    if (rowIndex3 > -1) {
      sheet3.getRange(rowIndex3, 1, 1, row.length).setValues([row]);
    } else {
      med.id = Utilities.getUuid();
      row[0] = med.id;
      sheet3.appendRow(row);
    }
    result = { success: true, id: med.id };
  }

  // ---------- DELETE MED ----------
  else if (action === 'deleteMed' && userId) {
    var sheet4 = ss.getSheetByName(MEDS_SHEET_NAME);
    var data4  = sheet4.getDataRange().getValues();
    for (var m4 = data4.length - 1; m4 >= 1; m4--) {
      if (data4[m4][0] == e.parameter.id && data4[m4][1] == userId) {
        sheet4.deleteRow(m4 + 1);
      }
    }
    result = { success: true };
  }

  // ---------- LOG HISTORY ----------
  else if (action === 'logHistory' && userId) {
    var sheet5   = ss.getSheetByName(HISTORY_SHEET_NAME);
    var log      = JSON.parse(e.parameter.data);
    log.id       = Utilities.getUuid();
    log.userId   = userId;
    var headers5 = sheet5.getDataRange().getValues()[0];
    var row5     = headers5.map(function(h) { return log[h] || ''; });
    sheet5.appendRow(row5);
    result = { success: true };
  }

  // ---------- ADD MANUAL HISTORY LOG ----------
  else if (action === 'addManualHistoryLog' && userId) {
    var historySheet = ss.getSheetByName(HISTORY_SHEET_NAME);
    var log      = JSON.parse(e.parameter.data);
    log.id       = Utilities.getUuid();
    log.userId   = userId;
    var headers5 = historySheet.getDataRange().getValues()[0];
    var row5     = headers5.map(function(h) { return log[h] || ''; });
    historySheet.appendRow(row5);
    
    // Increment dosesTaken and takenTodayCount in medications sheet!
    var medId = log.medId;
    var logDate = log.date;
    if (medId) {
      var medsSheet = ss.getSheetByName(MEDS_SHEET_NAME);
      var medsData = medsSheet.getDataRange().getValues();
      for (var mIdx = 1; mIdx < medsData.length; mIdx++) {
        if (medsData[mIdx][0] == medId && medsData[mIdx][1] == userId) {
          var dosesTaken = parseInt(medsData[mIdx][9]) || 0;
          var takenTodayCount = parseInt(medsData[mIdx][10]) || 0;
          var lastResetDate = medsData[mIdx][11];
          
          dosesTaken = dosesTaken + 1;
          medsSheet.getRange(mIdx + 1, 10).setValue(dosesTaken);
          
          var lastResetDateStr = lastResetDate instanceof Date ? Utilities.formatDate(lastResetDate, 'UTC', 'yyyy-MM-dd') : String(lastResetDate).split('T')[0];
          var logDateStr = logDate instanceof Date ? logDate.toISOString().split('T')[0] : String(logDate).split('T')[0];
          
          if (logDateStr === lastResetDateStr) {
            takenTodayCount = takenTodayCount + 1;
            medsSheet.getRange(mIdx + 1, 11).setValue(takenTodayCount);
          }
          break;
        }
      }
    }
    result = { success: true };
  }

  // ---------- EDIT HISTORY LOG ----------
  else if (action === 'editHistoryLog' && userId) {
    var historySheet = ss.getSheetByName(HISTORY_SHEET_NAME);
    var historyData  = historySheet.getDataRange().getValues();
    var logId = e.parameter.logId;
    var newTimestamp = e.parameter.timestamp;
    var newDate = e.parameter.date;
    
    var medId = null;
    var oldDate = null;
    
    for (var hIdx = 1; hIdx < historyData.length; hIdx++) {
      if (historyData[hIdx][0] == logId && historyData[hIdx][1] == userId) {
        medId = historyData[hIdx][2];
        oldDate = historyData[hIdx][6];
        
        historySheet.getRange(hIdx + 1, 6).setValue(new Date(newTimestamp)); // timestamp
        historySheet.getRange(hIdx + 1, 7).setValue(newDate); // date
        break;
      }
    }
    
    // Adjust takenTodayCount if moving to/from today
    if (medId && oldDate && oldDate !== newDate) {
      var medsSheet = ss.getSheetByName(MEDS_SHEET_NAME);
      var medsData = medsSheet.getDataRange().getValues();
      for (var mIdx = 1; mIdx < medsData.length; mIdx++) {
        if (medsData[mIdx][0] == medId && medsData[mIdx][1] == userId) {
          var takenTodayCount = parseInt(medsData[mIdx][10]) || 0;
          var lastResetDate = medsData[mIdx][11];
          
          var lastResetDateStr = lastResetDate instanceof Date ? Utilities.formatDate(lastResetDate, 'UTC', 'yyyy-MM-dd') : String(lastResetDate).split('T')[0];
          var oldDateStr = oldDate instanceof Date ? Utilities.formatDate(oldDate, 'UTC', 'yyyy-MM-dd') : String(oldDate).split('T')[0];
          var newDateStr = String(newDate).split('T')[0];
          
          if (oldDateStr === lastResetDateStr && newDateStr !== lastResetDateStr) {
            takenTodayCount = Math.max(0, takenTodayCount - 1);
            medsSheet.getRange(mIdx + 1, 11).setValue(takenTodayCount);
          } else if (oldDateStr !== lastResetDateStr && newDateStr === lastResetDateStr) {
            takenTodayCount = takenTodayCount + 1;
            medsSheet.getRange(mIdx + 1, 11).setValue(takenTodayCount);
          }
          break;
        }
      }
    }
    result = { success: true };
  }

  // ---------- DELETE HISTORY LOG ----------
  else if (action === 'deleteHistoryLog' && userId) {
    var historySheet = ss.getSheetByName(HISTORY_SHEET_NAME);
    var historyData  = historySheet.getDataRange().getValues();
    var logId = e.parameter.logId;
    var medId = null;
    var logDate = null;
    
    for (var hIdx = historyData.length - 1; hIdx >= 1; hIdx--) {
      if (historyData[hIdx][0] == logId && historyData[hIdx][1] == userId) {
        medId = historyData[hIdx][2];
        logDate = historyData[hIdx][6];
        historySheet.deleteRow(hIdx + 1);
        break;
      }
    }
    
    // Decrement dosesTaken and takenTodayCount
    if (medId) {
      var medsSheet = ss.getSheetByName(MEDS_SHEET_NAME);
      var medsData = medsSheet.getDataRange().getValues();
      for (var mIdx = 1; mIdx < medsData.length; mIdx++) {
        if (medsData[mIdx][0] == medId && medsData[mIdx][1] == userId) {
          var dosesTaken = parseInt(medsData[mIdx][9]) || 0;
          var takenTodayCount = parseInt(medsData[mIdx][10]) || 0;
          var lastResetDate = medsData[mIdx][11];
          
          dosesTaken = Math.max(0, dosesTaken - 1);
          medsSheet.getRange(mIdx + 1, 10).setValue(dosesTaken);
          
          var lastResetDateStr = lastResetDate instanceof Date ? Utilities.formatDate(lastResetDate, 'UTC', 'yyyy-MM-dd') : String(lastResetDate).split('T')[0];
          var logDateStr = logDate instanceof Date ? Utilities.formatDate(logDate, 'UTC', 'yyyy-MM-dd') : String(logDate).split('T')[0];
          
          if (logDateStr === lastResetDateStr) {
            takenTodayCount = Math.max(0, takenTodayCount - 1);
            medsSheet.getRange(mIdx + 1, 11).setValue(takenTodayCount);
          }
          break;
        }
      }
    }
    result = { success: true };
  }

  // ---------- GET MEDS ----------
  else if (action === 'getMeds' && userId) {
    var sheet6      = ss.getSheetByName(MEDS_SHEET_NAME);
    var data6       = sheet6.getDataRange().getValues();
    var headers6    = data6[0];
    var dateFields6 = ['lastResetDate','startDate'];
    var intFields6  = ['dosesTaken','takenTodayCount','durationDays','timesPerDay'];

    function toYMD(d) {
      return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
    }

    var rows6 = [];
    for (var r6 = 1; r6 < data6.length; r6++) {
      if (data6[r6][1] != userId) continue;
      var obj6 = {};
      for (var c6 = 0; c6 < headers6.length; c6++) {
        var h6  = headers6[c6];
        var val = data6[r6][c6];
        if (dateFields6.indexOf(h6) >= 0 && val instanceof Date) {
          obj6[h6] = toYMD(val);
        } else if (intFields6.indexOf(h6) >= 0) {
          obj6[h6] = parseInt(val) || 0;
        } else {
          obj6[h6] = val;
        }
      }
      if (obj6.times) {
        try { obj6.times = JSON.parse(obj6.times); } catch(e6) { obj6.times = []; }
      }
      rows6.push(obj6);
    }

    // Deduplicate by id
    var byId = {};
    rows6.forEach(function(m6) {
      var k = String(m6.id);
      if (!byId[k] || (m6.dosesTaken || 0) >= (byId[k].dosesTaken || 0)) byId[k] = m6;
    });
    // Deduplicate by name+dosage
    var byName = {};
    Object.keys(byId).forEach(function(k6) {
      var m6 = byId[k6];
      var nk = String(m6.name).trim().toLowerCase() + '|' + String(m6.dosage).trim().toLowerCase();
      if (!byName[nk] || (m6.dosesTaken || 0) >= (byName[nk].dosesTaken || 0)) byName[nk] = m6;
    });
    result = Object.keys(byName).map(function(k) { return byName[k]; });
  }

  // ---------- GET HISTORY ----------
  else if (action === 'getHistory' && userId) {
    var sheet7   = ss.getSheetByName(HISTORY_SHEET_NAME);
    var data7    = sheet7.getDataRange().getValues();
    var headers7 = data7[0];
    var rows7    = [];
    for (var r7 = 1; r7 < data7.length; r7++) {
      if (data7[r7][1] != userId) continue;
      var obj7 = {};
      for (var c7 = 0; c7 < headers7.length; c7++) { obj7[headers7[c7]] = data7[r7][c7]; }
      rows7.push(obj7);
    }
    result = rows7.reverse();
  }

  else {
    result = { error: 'Unauthorized or invalid action' };
  }

  return jsonResponse(result, callback);
}

// ==========================================================
// doPost - Solo para subida de imagenes en base64
// ==========================================================
function doPost(e) {
  var postData;
  try { postData = JSON.parse(e.postData.contents); } catch(err) { postData = e.parameter || {}; }
  if (postData.action === 'upload') {
    var folder = DriveApp.getFoldersByName(FOLDER_NAME).next();
    var blob   = Utilities.newBlob(Utilities.base64Decode(postData.base64), postData.mimeType, postData.fileName);
    var file   = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return jsonResponse({ url: file.getUrl() }, null);
  }
  return jsonResponse({ error: 'only upload supported in doPost' }, null);
}

// ==========================================================
// checkAndSendAlerts - Ejecutar cada minuto con un trigger
//
// CORRECCION DE TIMEZONE Y TRATAMIENTOS CULMINADOS:
//   - Omite el envío de notificaciones para tratamientos culminados.
//   - Almacena una caché global de deduplicación con marcas de tiempo absolutas
//     ('sent_alerts_cache') inmune a desfases de cambio de día UTC / local.
// ==========================================================
function checkAndSendAlerts() {
  var ss          = SpreadsheetApp.getActiveSpreadsheet();
  var usersSheet  = ss.getSheetByName(USERS_SHEET_NAME);
  var medsSheet   = ss.getSheetByName(MEDS_SHEET_NAME);
  var usersData   = usersSheet.getDataRange().getValues();
  var medsData    = medsSheet.getDataRange().getValues();

  var nowUtcMs = Date.now();

  // Caché de deduplicación absoluta (inmune a fronteras de zona horaria)
  var props      = PropertiesService.getScriptProperties();
  var cacheKey   = 'sent_alerts_cache';
  var sentAlerts = {};
  try { sentAlerts = JSON.parse(props.getProperty(cacheKey) || '{}'); } catch(e) {}

  // Pruning: remover registros más viejos de 30 horas para evitar el desbordamiento de ScriptProperties
  var prunedAlerts = {};
  for (var k in sentAlerts) {
    if (nowUtcMs - sentAlerts[k] < 30 * 60 * 60 * 1000) {
      prunedAlerts[k] = sentAlerts[k];
    }
  }
  sentAlerts = prunedAlerts;

  function addMinutes(timeStr, mins) {
    var parts = timeStr.split(':');
    var h = parseInt(parts[0]);
    var m = parseInt(parts[1]);
    var d = new Date(2000, 0, 1, h, m + mins);
    return Utilities.formatDate(d, 'UTC', 'HH:mm');
  }

  for (var u = 1; u < usersData.length; u++) {
    var userRow     = usersData[u];
    var userId      = String(userRow[0]);
    var userEmail   = String(userRow[1]);
    var phone       = String(userRow[5] || '');
    var apiKey      = String(userRow[6] || '');
    var patientName = String(userRow[7] || '');
    var utcOffset   = parseInt(userRow[9]) || 0;

    // Calcular hora local del usuario usando su offset almacenado
    var localMs   = nowUtcMs + utcOffset * 60000;
    var localDate = new Date(localMs);
    var nowHHMM   = Utilities.formatDate(localDate, 'UTC', 'HH:mm');

    var processedMeds = {}; // Deduplicate meds in memory

    for (var med = 1; med < medsData.length; med++) {
      if (String(medsData[med][1]) !== userId) continue;

      var medId   = String(medsData[med][0]);
      var medName = String(medsData[med][2]);
      var dosage  = String(medsData[med][3]);
      
      var medKey = medName.trim().toLowerCase() + '|' + dosage.trim().toLowerCase();
      if (processedMeds[medKey]) continue; // Skip duplicates
      processedMeds[medKey] = true;

      // Omitir medicamentos con el plan ya culminado
      var timesPerDay  = parseInt(medsData[med][5]) || 0;
      var durationDays = parseInt(medsData[med][6]) || 0;
      var dosesTaken   = parseInt(medsData[med][9]) || 0;
      var totalNeeded  = timesPerDay * durationDays;
      if (totalNeeded > 0 && dosesTaken >= totalNeeded) {
        continue; // Tratamiento culminado, no alertar
      }

      var times   = [];
      try { times = JSON.parse(medsData[med][4] || '[]'); } catch(e) {}

      for (var t = 0; t < times.length; t++) {
        var scheduledTime = times[t];
        var alerts = [
          { offset: -10, triggerTime: addMinutes(scheduledTime, -10), label: '10 min' },
          { offset: -5,  triggerTime: addMinutes(scheduledTime, -5),  label: '5 min'  },
          { offset:  0,  triggerTime: scheduledTime,                  label: 'AHORA'  }
        ];

        for (var a = 0; a < alerts.length; a++) {
          var alert = alerts[a];
          if (alert.triggerTime !== nowHHMM) continue;

          var dedupeKey = userId + '_' + medKey + '_' + scheduledTime + '_' + alert.offset;
          if (sentAlerts[dedupeKey]) continue;

          var greeting = patientName ? ('Hola ' + patientName + ',') : 'Hola,';
          var subject = '', body = '', waMsg = '';

          if (alert.offset === -10) {
            subject = '[10 min] ' + medName;
            body    = greeting + '\n\nEn 10 minutos es hora de tomar:\n\n' +
                      '- Medicamento: ' + medName + '\n' +
                      '- Dosis: ' + dosage + '\n' +
                      '- Hora: ' + scheduledTime + '\n\n' +
                      'Prepara tu medicación con anticipación.\n\n-- ERGOMEDI-TRACKER';
            waMsg   = '(10 min) ' + greeting + ' En 10 minutos debes tomar *' + medName + '* (' + dosage + ') a las ' + scheduledTime + '. ¡Prepárala!';
          } else if (alert.offset === -5) {
            subject = '[5 min] ' + medName;
            body    = greeting + '\n\nEn 5 minutos es hora de tomar:\n\n' +
                      '- Medicamento: ' + medName + '\n' +
                      '- Dosis: ' + dosage + '\n' +
                      '- Hora: ' + scheduledTime + '\n\n' +
                      '¡No lo olvides!\n\n-- ERGOMEDI-TRACKER';
            waMsg   = '(5 min) Faltan 5 minutos para tomar *' + medName + '* (' + dosage + ').';
          } else {
            subject = '[AHORA] ' + medName;
            body    = greeting + '\n\n¡Es el momento de tu medicamento!\n\n' +
                      '- Medicamento: ' + medName + '\n' +
                      '- Dosis: ' + dosage + '\n' +
                      '- Hora: ' + scheduledTime + '\n\n' +
                      'Abre ERGOMEDI-TRACKER y confirma la toma.\n\n-- ERGOMEDI-TRACKER';
            waMsg   = '(¡ES HORA! ERGOMEDI): ' + greeting + ' Toma tu dosis de *' + medName + '* (' + dosage + ') ahora mismo.';
          }

          // Email (canal principal)
          if (userEmail && userEmail.indexOf('@') >= 0) {
            try { MailApp.sendEmail({ to: userEmail, subject: subject, body: body }); } catch(err) {}
          }

          // WhatsApp via CallMeBot (canal secundario)
          if (phone && apiKey) sendWhatsAppMessage(phone, waMsg, apiKey);

          // Almacenar el timestamp de envío en la caché
          sentAlerts[dedupeKey] = nowUtcMs;
        }
      }
    }
  }

  // Guardar cache
  props.setProperty(cacheKey, JSON.stringify(sentAlerts));
}

function sendWhatsAppMessage(phone, text, apiKey) {
  var cleanPhone = phone.replace('+', '').replace(/\s/g, '');
  var url = 'https://api.callmebot.com/whatsapp.php?phone=' + cleanPhone +
            '&text=' + encodeURIComponent(text) + '&apikey=' + apiKey;
  try { UrlFetchApp.fetch(url, { muteHttpExceptions: true }); } catch(e) {}
}

function jsonResponse(data, callback) {
  var json = JSON.stringify(data);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// ==========================================================
// cleanupDuplicates - Ejecutar UNA vez para limpiar duplicados
// ==========================================================
function cleanupDuplicates() {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var sheet   = ss.getSheetByName('medications');
  if (!sheet) { Logger.log('Sheet not found'); return; }
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var nameIdx   = headers.indexOf('name');
  var dosageIdx = headers.indexOf('dosage');
  var userIdx   = headers.indexOf('userId');
  var doseIdx   = headers.indexOf('dosesTaken');
  var best = {};
  var rowsToDelete = [];
  for (var i = 1; i < data.length; i++) {
    var row      = data[i];
    var nameKey  = String(row[userIdx]) + '|' + String(row[nameIdx]).trim().toLowerCase() + '|' + String(row[dosageIdx]).trim().toLowerCase();
    var doses    = parseInt(row[doseIdx]) || 0;
    var sheetRow = i + 1;
    if (!best[nameKey]) {
      best[nameKey] = { sheetRow: sheetRow, doses: doses };
    } else if (doses >= best[nameKey].doses) {
      rowsToDelete.push(best[nameKey].sheetRow);
      best[nameKey] = { sheetRow: sheetRow, doses: doses };
    } else {
      rowsToDelete.push(sheetRow);
    }
  }
  rowsToDelete.sort(function(a, b) { return b - a; }).forEach(function(r) { sheet.deleteRow(r); });
  Logger.log('Deleted ' + rowsToDelete.length + ' duplicate rows.');
}
