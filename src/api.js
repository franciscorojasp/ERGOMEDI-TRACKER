const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxpmkzeyLvd4t2MtxEHDds1IOsbJ-F0yuKPR7aJ7OFPfLBAhXgF0Ryl8P1RFICH6-I7zw/exec';

export const api = {
  async login(identifier) {
    // Send the device's UTC offset (in minutes) so GAS can fire alerts
    // at the correct local time for each user.
    // -new Date().getTimezoneOffset() gives: UTC-4 → -240, UTC+2 → +120
    const utcOffset = -new Date().getTimezoneOffset();
    return this.jsonp('login', { identifier, utcOffset });
  },

  async updateProfile(userId, profileData) {
    // Always refresh utcOffset in case user travelled / DST changed
    const utcOffset = -new Date().getTimezoneOffset();
    const fullProfile = { ...profileData, utcOffset };
    return this.jsonp('updateProfile', { userId, data: JSON.stringify(fullProfile) });
  },

  async getMeds(userId) {
    try {
      const data = await this.jsonp('getMeds', { userId });
      const normalized = (data || []).map(this.normalizeMed);
      this.syncLocalMeds(normalized);
      return normalized;
    } catch (error) {
      return this.getLocalMeds();
    }
  },

  async saveMed(med, userId) {
    try {
      // Usamos JSONP para guardar y así saltar el CORS de Google al redireccionar
      return await this.jsonp('saveMed', { data: JSON.stringify(med), userId });
    } catch (error) {
      this.saveLocalMed(med);
      return { success: true, offline: true };
    }
  },

  async deleteMed(id, userId) {
    try {
      return await this.jsonp('deleteMed', { id, userId });
    } catch (error) {
      this.deleteLocalMed(id);
      return { success: true, offline: true };
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

  async logHistory(log, userId) {
    try {
      return await this.jsonp('logHistory', { data: JSON.stringify(log), userId });
    } catch (error) {
      this.saveLocalHistory(log);
      return { success: true, offline: true };
    }
  },

  async uploadPrescription(file, userId) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result; // full data URL for fallback
        const base64 = dataUrl.split(',')[1];
        try {
          // Try the Vercel proxy first (only works when deployed on Vercel)
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          const res = await fetch('/api/proxy', {
            method: 'POST',
            body: JSON.stringify({ action: 'upload', userId, base64, mimeType: file.type, fileName: file.name }),
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal
          });
          clearTimeout(timeout);
          const data = await res.json();
          if (data.url) {
            resolve(data.url);
          } else {
            // Proxy returned but no URL — store as data URL locally
            resolve(dataUrl);
          }
        } catch (e) {
          // Proxy not available (local dev, non-Vercel hosting) — use base64 data URL as fallback
          console.warn('Proxy not available, using local data URL for prescription image.');
          resolve(dataUrl);
        }
      };
      reader.onerror = () => reject(new Error('Error al leer el archivo.'));
      reader.readAsDataURL(file);
    });
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

      script.onerror = (e) => {
        console.error('JSONP Error:', e);
        reject(new Error('JSONP Request failed'));
        cleanup();
      };

      const cleanup = () => {
        delete window[callbackName];
        if (script.parentNode) document.body.removeChild(script);
      };

      document.body.appendChild(script);
      
      // Timeout after 20s
      setTimeout(() => {
        if (window[callbackName]) {
          reject(new Error('JSONP Timeout'));
          cleanup();
        }
      }, 20000);
    });
  },

  getLocalMeds() { return (JSON.parse(localStorage.getItem('meds') || '[]')).map(this.normalizeMed); },
  syncLocalMeds(meds) { localStorage.setItem('meds', JSON.stringify(meds)); },
  getLocalHistory() { return JSON.parse(localStorage.getItem('history') || '[]'); },
  syncLocalHistory(history) { localStorage.setItem('history', JSON.stringify(history)); },
  saveLocalMed(med) { /* fallback simple */ },
  deleteLocalMed(id) { /* fallback simple */ },
  saveLocalHistory(log) { /* fallback simple */ },

  /**
   * Ensures `times` is always a proper string[] array, regardless of how
   * Google Sheets stored it (JSON string, empty string, null, already array).
   * If times is missing/empty, generates default times spread across the day.
   */
  normalizeMed(med) {
    let times = med.times;

    // Parse if it came as a JSON string from Sheets
    if (typeof times === 'string') {
      try { times = JSON.parse(times); } catch (e) { times = []; }
    }

    // Ensure it's a non-empty array of valid HH:MM strings
    if (!Array.isArray(times) || times.length === 0) {
      const count = parseInt(med.timesPerDay) || 1;
      // Generate evenly-spaced times starting at 08:00
      times = Array.from({ length: count }, (_, i) => {
        const totalMins = 8 * 60 + Math.round((12 * 60 / count) * i);
        const h = Math.floor(totalMins / 60) % 24;
        const m = totalMins % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      });
    }

    return { ...med, times, lastResetDate: normalizeDate(med.lastResetDate) };
  }
};

// Converts any date representation to local "YYYY-MM-DD" string.
// Guards against Sheets returning ISO UTC strings like "2026-05-05T04:00:00.000Z"
// which would never match localToday() = "2026-05-05".
function normalizeDate(val) {
  if (!val) return '';
  if (typeof val === 'string') {
    // Already plain date string "2026-05-05" — return as-is
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    // ISO string — parse and extract local date
    const d = new Date(val);
    if (!isNaN(d)) {
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
  }
  if (val instanceof Date) {
    return `${val.getFullYear()}-${String(val.getMonth()+1).padStart(2,'0')}-${String(val.getDate()).padStart(2,'0')}`;
  }
  return String(val).substring(0, 10);
}
