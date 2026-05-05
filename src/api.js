// Professional API Service using Vercel Serverless Proxy
const PROXY_URL = '/api/proxy';

export const api = {
  async login(identifier) {
    return this.request('GET', { action: 'login', identifier });
  },

  async getMeds(userId) {
    try {
      const data = await this.request('GET', { action: 'getMeds', userId });
      this.syncLocalMeds(data);
      return data;
    } catch (error) {
      return this.getLocalMeds();
    }
  },

  async saveMed(med, userId) {
    try {
      return await this.request('POST', { action: 'saveMed', data: med, userId });
    } catch (error) {
      this.saveLocalMed(med);
      return { success: true, offline: true };
    }
  },

  async deleteMed(id, userId) {
    try {
      return await this.request('POST', { action: 'deleteMed', id, userId });
    } catch (error) {
      this.deleteLocalMed(id);
      return { success: true, offline: true };
    }
  },

  async getHistory(userId) {
    try {
      const data = await this.request('GET', { action: 'getHistory', userId });
      this.syncLocalHistory(data);
      return data;
    } catch (error) {
      return this.getLocalHistory();
    }
  },

  async logHistory(log, userId) {
    try {
      return await this.request('POST', { action: 'logHistory', data: log, userId });
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
          const res = await this.request('POST', {
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
   * Universal request handler through Vercel Proxy
   */
  async request(method, params = {}) {
    let url = PROXY_URL;
    const options = { method };

    if (method === 'GET') {
      const query = new URLSearchParams(params).toString();
      url += `?${query}`;
    } else {
      options.body = JSON.stringify(params);
      options.headers = { 'Content-Type': 'application/json' };
    }

    const response = await fetch(url, options);
    if (!response.ok) throw new Error('Proxy communication failed');
    return await response.json();
  },

  // LocalStorage Fallback (Remains for offline support)
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
