/**
 * ERGOMEDI-TRACKER Backend - Google Only (No Firebase)
 */

const MEDS_SHEET_NAME = 'medications';
const HISTORY_SHEET_NAME = 'history';
const USERS_SHEET_NAME = 'users';
const FOLDER_NAME = 'ERGOMEDI_PRESCRIPTIONS';

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(MEDS_SHEET_NAME)) {
    ss.insertSheet(MEDS_SHEET_NAME).appendRow(['id', 'userId', 'name', 'dosage', 'times', 'timesPerDay', 'durationDays', 'startDate', 'notes', 'dosesTaken', 'takenTodayCount', 'lastResetDate', 'lastTakenDate', 'prescriptionUrl', 'updatedAt']);
  }
  if (!ss.getSheetByName(HISTORY_SHEET_NAME)) {
    ss.insertSheet(HISTORY_SHEET_NAME).appendRow(['id', 'userId', 'medId', 'medName', 'dosage', 'timestamp', 'date']);
  }
  if (!ss.getSheetByName(USERS_SHEET_NAME)) {
    ss.insertSheet(USERS_SHEET_NAME).appendRow(['id', 'identifier', 'name', 'lastLogin']);
  }
  
  // Ensure folder exists for prescriptions
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  if (!folders.hasNext()) {
    DriveApp.createFolder(FOLDER_NAME);
  }
}

function doGet(e) {
  const action = e.parameter.action;
  const userId = e.parameter.userId;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  if (action === 'login') {
    const identifier = e.parameter.identifier; // Email or Phone
    const sheet = ss.getSheetByName(USERS_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    let user = data.find(row => row[1] == identifier);
    
    if (!user) {
      const newId = Utilities.getUuid();
      sheet.appendRow([newId, identifier, '', new Date()]);
      return jsonResponse({ id: newId, identifier: identifier });
    }
    
    // Update last login
    const rowIndex = data.indexOf(user) + 1;
    sheet.getRange(rowIndex, 4).setValue(new Date());
    return jsonResponse({ id: user[0], identifier: user[1], name: user[2] });
  }

  if (!userId) return jsonResponse({ error: 'Unauthorized' });

  if (action === 'getMeds') {
    const sheet = ss.getSheetByName(MEDS_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const rows = data.slice(1)
      .filter(row => row[1] == userId)
      .map(row => {
        let obj = {};
        headers.forEach((header, i) => obj[header] = row[i]);
        if (obj.times) obj.times = JSON.parse(obj.times);
        return obj;
      });
    return jsonResponse(rows);
  }
  
  if (action === 'getHistory') {
    const sheet = ss.getSheetByName(HISTORY_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const rows = data.slice(1)
      .filter(row => row[1] == userId)
      .map(row => {
        let obj = {};
        headers.forEach((header, i) => obj[header] = row[i]);
        return obj;
      });
    return jsonResponse(rows.reverse());
  }
}

function doPost(e) {
  const postData = JSON.parse(e.postData.contents);
  const action = postData.action;
  const userId = postData.userId;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  if (action === 'upload') {
    const folder = DriveApp.getFoldersByName(FOLDER_NAME).next();
    const blob = Utilities.newBlob(Utilities.base64Decode(postData.base64), postData.mimeType, postData.fileName);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return jsonResponse({ url: file.getUrl() });
  }

  if (!userId) return jsonResponse({ error: 'Unauthorized' });

  if (action === 'saveMed') {
    const sheet = ss.getSheetByName(MEDS_SHEET_NAME);
    const med = postData.data;
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    let rowIndex = -1;
    if (med.id) {
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] == med.id && data[i][1] == userId) {
          rowIndex = i + 1;
          break;
        }
      }
    }
    
    const row = headers.map(h => {
      if (h === 'userId') return userId;
      if (h === 'times') return JSON.stringify(med[h]);
      if (h === 'updatedAt') return new Date();
      return med[h] || '';
    });
    
    if (rowIndex > -1) {
      sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    } else {
      med.id = Utilities.getUuid();
      row[0] = med.id;
      sheet.appendRow(row);
    }
    return jsonResponse({ success: true, id: med.id });
  }
  
  if (action === 'deleteMed') {
    const sheet = ss.getSheetByName(MEDS_SHEET_NAME);
    const id = postData.id;
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == id && data[i][1] == userId) {
        sheet.deleteRow(i + 1);
        break;
      }
    }
    return jsonResponse({ success: true });
  }
  
  if (action === 'logHistory') {
    const sheet = ss.getSheetByName(HISTORY_SHEET_NAME);
    const log = postData.data;
    log.id = Utilities.getUuid();
    log.userId = userId;
    const headers = sheet.getDataRange().getValues()[0];
    const row = headers.map(h => log[h] || '');
    sheet.appendRow(row);
    return jsonResponse({ success: true });
  }
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
