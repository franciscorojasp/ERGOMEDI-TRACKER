const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxpmkzeyLvd4t2MtxEHDds1IOsbJ-F0yuKPR7aJ7OFPfLBAhXgF0Ryl8P1RFICH6-I7zw/exec';

export const api = {
  async login(identifier) {
    return this.jsonp('login', { identifier });
  },

  async getMeds(userId) {
    try {
      const data = await this.jsonp('getMeds', { userId });
      this.syncLocalMeds(data);
      return data;
    } catch (error) {
      return this.getLocalMeds();
    }
  },

  async getHistory(userId) {
    try {
      const data = await this.jsonp('getHistory', { userId });
      this.syncLocalHistory(data);
      return data;
    } catch (error) {
      return this.getLocalHistory();
    }
  },

  /**
   * JSONP Implementation to BYPASS CORS COMPLETELY
   */
  jsonp(action, params = {}) {
    return new Promise((resolve, reject) => {
      const callbackName = 'jsonp_cb_' + Math.round(100000 * Math.random());
      const url = new URL(SCRIPT_URL);
      url.searchParams.append('action', action);
      url.searchParams.append('callback', callbackName);
      Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

      const script = document.createElement('script');
      script.src = url.toString();

      window[callbackName] = (data) => {
        resolve(data);
        cleanup();
      };

      script.onerror = () => {
        reject(new Error('JSONP Request failed'));
        cleanup();
      };

      const cleanup = () => {
        delete window[callbackName];
        document.body.removeChild(script);
      };

      document.body.appendChild(script);
      
      // Timeout after 15s
      setTimeout(() => {
        if (window[callbackName]) {
          reject(new Error('JSONP Timeout'));
          cleanup();
        }
      }, 15000);
    });
  },

  // POST remains through proxy as backup, but for now we focus on GET login
  async saveMed(med, userId) {
    const res = await fetch('/api/proxy', {
      method: 'POST',
      body: JSON.stringify({ action: 'saveMed', data: med, userId }),
      headers: { 'Content-Type': 'application/json' }
    });
    return await res.json();
  },

  async logHistory(log, userId) {
    const res = await fetch('/api/proxy', {
      method: 'POST',
      body: JSON.stringify({ action: 'logHistory', data: log, userId }),
      headers: { 'Content-Type': 'application/json' }
    });
    return await res.json();
  },

  async uploadPrescription(file, userId) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        try {
          const res = await fetch('/api/proxy', {
            method: 'POST',
            body: JSON.stringify({ action: 'upload', userId, base64, mimeType: file.type, fileName: file.name }),
            headers: { 'Content-Type': 'application/json' }
          });
          const data = await res.json();
          resolve(data.url);
        } catch (e) { reject(e); }
      };
      reader.readAsDataURL(file);
    });
  },

  getLocalMeds() { return JSON.parse(localStorage.getItem('meds') || '[]'); },
  syncLocalMeds(meds) { localStorage.setItem('meds', JSON.stringify(meds)); },
  getLocalHistory() { return JSON.parse(localStorage.getItem('history') || '[]'); },
  syncLocalHistory(history) { localStorage.setItem('history', JSON.stringify(history)); }
};
