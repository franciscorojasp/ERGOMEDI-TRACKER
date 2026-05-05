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
  // DELETE MED
  else if (action === 'deleteMed' && userId) {
    const sheet = ss.getSheetByName(MEDS_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == e.parameter.id && data[i][1] == userId) {
        sheet.deleteRow(i + 1);
        break;
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
      result = data.slice(1)
        .filter(row => row[1] == userId)
        .map(row => {
          let obj = {};
          headers.forEach((header, i) => obj[header] = row[i]);
          if (obj.times) {
            try { obj.times = JSON.parse(obj.times); } catch(e) { obj.times = []; }
          }
          return obj;
        });
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
 * Función que debe ejecutarse cada minuto mediante un activador (trigger)
 */
function checkAndSendAlerts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const usersSheet = ss.getSheetByName(USERS_SHEET_NAME);
  const medsSheet = ss.getSheetByName(MEDS_SHEET_NAME);
  
  const users = usersSheet.getDataRange().getValues();
  const meds = medsSheet.getDataRange().getValues();
  
  const now = new Date();
  const currentHours = now.getHours();
  const currentMinutes = now.getMinutes();
  
  // Mapear cabeceras
  const userHeaders = users[0];
  const medHeaders = meds[0];
  
  users.slice(1).forEach(userRow => {
    const userId = userRow[0];
    const phone = userRow[5];
    const apiKey = userRow[6];
    
    if (!phone || !apiKey) return; // No tiene configurado WhatsApp
    
    meds.slice(1).forEach(medRow => {
      if (medRow[1] != userId) return;
      
      const medName = medRow[2];
      const dosage = medRow[3];
      const times = JSON.parse(medRow[4] || '[]');
      
      times.forEach(timeStr => {
        const [h, m] = timeStr.split(':').map(Number);
        
        // Calcular diferencia
        const alertTime = new Date();
        alertTime.setHours(h, m, 0, 0);
        
        const diffMs = alertTime.getTime() - now.getTime();
        const diffMin = Math.round(diffMs / 60000);
        
        let message = "";
        if (diffMin === 10) {
          message = `⏰ *Recordatorio ERGOMEDI* (10 min): Es casi hora de tu dosis de *${medName}* (${dosage}). Prepárala.`;
        } else if (diffMin === 5) {
          message = `⚠️ *Recordatorio ERGOMEDI* (5 min): En 5 minutos debes tomar *${medName}* (${dosage}).`;
        } else if (diffMin === 0) {
          message = `✅ *¡ES HORA! ERGOMEDI*: Toma tu dosis de *${medName}* (${dosage}) ahora mismo. ¡No lo olvides!`;
        }
        
        if (message) {
          sendWhatsAppMessage(phone, message, apiKey);
        }
      });
    });
  });
}

function sendWhatsAppMessage(phone, text, apiKey) {
  // Usando CallMeBot API (Gratis/Simple para prototipos)
  // Nota: El número debe estar en formato internacional sin el + (ej: 58424...)
  const cleanPhone = phone.replace('+', '').replace(/\s/g, '');
  const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(text)}&apikey=${apiKey}`;
  
  try {
    UrlFetchApp.fetch(url);
    console.log(`Mensaje enviado a ${phone}: ${text}`);
  } catch (e) {
    console.error(`Error enviando WhatsApp a ${phone}: ${e.message}`);
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
