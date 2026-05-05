const API_URL = 'https://script.google.com/macros/s/AKfycbxpmkzeyLvd4t2MtxEHDds1IOsbJ-F0yuKPR7aJ7OFPfLBAhXgF0Ryl8P1RFICH6-I7zw/exec';

export const api = {
  async login(identifier) {
    if (!API_URL || API_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL') {
      return { id: 'local-user', identifier: identifier };
    }
    const response = await fetch(`${API_URL}?action=login&identifier=${identifier}`);
    return await response.json();
  },

  async getMeds(userId) {
    if (!API_URL || API_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL') return this.getLocalMeds();
    try {
      const response = await fetch(`${API_URL}?action=getMeds&userId=${userId}`);
      const data = await response.json();
      this.syncLocalMeds(data);
      return data;
    } catch (error) {
      return this.getLocalMeds();
    }
  },

  async saveMed(med, userId) {
    if (!API_URL || API_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL') return this.saveLocalMed(med);
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'saveMed', data: med, userId }),
      });
      return await response.json();
    } catch (error) {
      this.saveLocalMed(med);
      return { success: true, offline: true };
    }
  },

  async deleteMed(id, userId) {
    if (!API_URL || API_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL') return this.deleteLocalMed(id);
    try {
      await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'deleteMed', id, userId }),
      });
      return { success: true };
    } catch (error) {
      this.deleteLocalMed(id);
      return { success: true, offline: true };
    }
  },

  async getHistory(userId) {
    if (!API_URL || API_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL') return this.getLocalHistory();
    try {
      const response = await fetch(`${API_URL}?action=getHistory&userId=${userId}`);
      const data = await response.json();
      this.syncLocalHistory(data);
      return data;
    } catch (error) {
      return this.getLocalHistory();
    }
  },

  async logHistory(log, userId) {
    if (!API_URL || API_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL') return this.saveLocalHistory(log);
    try {
      await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'logHistory', data: log, userId }),
      });
      return { success: true };
    } catch (error) {
      this.saveLocalHistory(log);
      return { success: true, offline: true };
    }
  },

  async uploadPrescription(file, userId) {
    if (!API_URL || API_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL') return '';
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        try {
          const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
              action: 'upload',
              userId: userId,
              base64: base64,
              mimeType: file.type,
              fileName: file.name
            })
          });
          const res = await response.json();
          resolve(res.url);
        } catch (e) { reject(e); }
      };
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
    });
  },

  // LocalStorage Fallback
  getLocalMeds() { return JSON.parse(localStorage.getItem('meds') || '[]'); },
  saveLocalMed(med) {
    let meds = this.getLocalMeds();
    if (med.id) meds = meds.map(m => m.id === med.id ? med : m);
    else { med.id = Math.random().toString(36).substr(2, 9); meds.push(med); }
    localStorage.setItem('meds', JSON.stringify(meds));
    return { success: true, id: med.id };
  },
  deleteLocalMed(id) {
    let meds = this.getLocalMeds();
    meds = meds.filter(m => m.id !== id);
    localStorage.setItem('meds', JSON.stringify(meds));
  },
  syncLocalMeds(meds) { localStorage.setItem('meds', JSON.stringify(meds)); },
  getLocalHistory() { return JSON.parse(localStorage.getItem('history') || '[]'); },
  saveLocalHistory(log) {
    const history = this.getLocalHistory();
    log.id = Math.random().toString(36).substr(2, 9);
    history.unshift(log);
    localStorage.setItem('history', JSON.stringify(history));
  },
  syncLocalHistory(history) { localStorage.setItem('history', JSON.stringify(history)); }
};
