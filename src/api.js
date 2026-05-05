const API_URL = 'https://script.google.com/macros/s/AKfycbxpmkzeyLvd4t2MtxEHDds1IOsbJ-F0yuKPR7aJ7OFPfLBAhXgF0Ryl8P1RFICH6-I7zw/exec';

export const api = {
  async login(identifier) {
    return this.googleFetch(`${API_URL}?action=login&identifier=${identifier}`);
  },

  async getMeds(userId) {
    if (!API_URL || API_URL.includes('YOUR_')) return this.getLocalMeds();
    try {
      const data = await this.googleFetch(`${API_URL}?action=getMeds&userId=${userId}`);
      this.syncLocalMeds(data);
      return data;
    } catch (error) {
      return this.getLocalMeds();
    }
  },

  async saveMed(med, userId) {
    if (!API_URL || API_URL.includes('YOUR_')) return this.saveLocalMed(med);
    try {
      return await this.googleFetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'saveMed', data: med, userId }),
      });
    } catch (error) {
      this.saveLocalMed(med);
      return { success: true, offline: true };
    }
  },

  async deleteMed(id, userId) {
    if (!API_URL || API_URL.includes('YOUR_')) return this.deleteLocalMed(id);
    try {
      return await this.googleFetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'deleteMed', id, userId }),
      });
    } catch (error) {
      this.deleteLocalMed(id);
      return { success: true, offline: true };
    }
  },

  async getHistory(userId) {
    if (!API_URL || API_URL.includes('YOUR_')) return this.getLocalHistory();
    try {
      const data = await this.googleFetch(`${API_URL}?action=getHistory&userId=${userId}`);
      this.syncLocalHistory(data);
      return data;
    } catch (error) {
      return this.getLocalHistory();
    }
  },

  async logHistory(log, userId) {
    if (!API_URL || API_URL.includes('YOUR_')) return this.saveLocalHistory(log);
    try {
      return await this.googleFetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'logHistory', data: log, userId }),
      });
    } catch (error) {
      this.saveLocalHistory(log);
      return { success: true, offline: true };
    }
  },

  async uploadPrescription(file, userId) {
    if (!API_URL || API_URL.includes('YOUR_')) return '';
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        try {
          const res = await this.googleFetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
              action: 'upload',
              userId: userId,
              base64: base64,
              mimeType: file.type,
              fileName: file.name
            })
          });
          resolve(res.url);
        } catch (e) { reject(e); }
      };
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
    });
  },

  /**
   * Helper to handle Google Apps Script redirects and CORS
   */
  async googleFetch(url, options = {}) {
    // Default fetch for GAS needs mode: 'cors' and redirect: 'follow'
    const finalOptions = {
      ...options,
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow'
    };

    const response = await fetch(url, finalOptions);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
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
