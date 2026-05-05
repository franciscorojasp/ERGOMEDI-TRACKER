const SCRIPT_ID = 'AKfycbxpmkzeyLvd4t2MtxEHDds1IOsbJ-F0yuKPR7aJ7OFPfLBAhXgF0Ryl8P1RFICH6-I7zw';
const API_URL = `https://script.google.com/macros/s/${SCRIPT_ID}/exec`;

export const api = {
  async login(identifier) {
    return this.googleFetch(`${API_URL}?action=login&identifier=${encodeURIComponent(identifier)}`);
  },

  async getMeds(userId) {
    try {
      const data = await this.googleFetch(`${API_URL}?action=getMeds&userId=${userId}`);
      this.syncLocalMeds(data);
      return data;
    } catch (error) {
      return this.getLocalMeds();
    }
  },

  async saveMed(med, userId) {
    try {
      return await this.googlePost({ action: 'saveMed', data: med, userId });
    } catch (error) {
      this.saveLocalMed(med);
      return { success: true, offline: true };
    }
  },

  async deleteMed(id, userId) {
    try {
      return await this.googlePost({ action: 'deleteMed', id, userId });
    } catch (error) {
      this.deleteLocalMed(id);
      return { success: true, offline: true };
    }
  },

  async getHistory(userId) {
    try {
      const data = await this.googleFetch(`${API_URL}?action=getHistory&userId=${userId}`);
      this.syncLocalHistory(data);
      return data;
    } catch (error) {
      return this.getLocalHistory();
    }
  },

  async logHistory(log, userId) {
    try {
      return await this.googlePost({ action: 'logHistory', data: log, userId });
    } catch (error) {
      this.saveLocalHistory(log);
      return { success: true, offline: true };
    }
  },

  async uploadPrescription(file, userId) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        try {
          const res = await this.googlePost({
            action: 'upload',
            userId: userId,
            base64: base64,
            mimeType: file.type,
            fileName: file.name
          });
          resolve(res.url);
        } catch (e) { reject(e); }
      };
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
    });
  },

  /**
   * GET helper using text/plain to avoid CORS preflight
   */
  async googleFetch(url) {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow'
    });
    return await response.json();
  },

  /**
   * POST helper using text/plain to avoid CORS preflight
   * Google Apps Script handles this perfectly as a POST body.
   */
  async googlePost(data) {
    const response = await fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors', // This is the trick for some GAS issues
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      }
    });
    
    // With no-cors, we can't read the response body in some browsers.
    // So we'll try a fallback or assume success if it's a silent POST.
    // BUT for Google Apps Script, the best way is usually 'cors' with text/plain.
    
    const corsResponse = await fetch(API_URL, {
      method: 'POST',
      mode: 'cors',
      body: JSON.stringify(data),
      redirect: 'follow'
    });
    return await corsResponse.json();
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
