const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxpmkzeyLvd4t2MtxEHDds1IOsbJ-F0yuKPR7aJ7OFPfLBAhXgF0Ryl8P1RFICH6-I7zw/exec';

export const api = {
  async login(identifier) {
    // Send the device's UTC offset (in minutes) so GAS can fire alerts
    // at the correct local time for each user.
    // -new Date().getTimezoneOffset() gives: UTC-4 → -240, UTC+2 → +120
    const utcOffset = -new Date().getTimezoneOffset();
    return this.jsonp('login', { identifier, utcOffset });
  },

  async updateProfile(userId, profileData, targetUserId = null) {
    // Always refresh utcOffset in case user travelled / DST changed
    const utcOffset = -new Date().getTimezoneOffset();
    const fullProfile = { ...profileData, utcOffset };
    const params = { userId, data: JSON.stringify(fullProfile) };
    if (targetUserId && targetUserId !== userId) params.targetUserId = targetUserId;
    return this.jsonp('updateProfile', params);
  },

  /** Admin only: get list of all registered patients */
  async getUsers(adminUserId) {
    return this.jsonp('getUsers', { userId: adminUserId });
  },

  /** Admin only: create a new patient account */
  async createPatient(adminUserId, identifier, patientName, role = 'user') {
    const utcOffset = -new Date().getTimezoneOffset();
    return this.jsonp('createUser', { userId: adminUserId, identifier, patientName, role, utcOffset });
  },

  async getMeds(userId, targetUserId = null) {
    try {
      const params = { userId };
      if (targetUserId && targetUserId !== userId) params.targetUserId = targetUserId;
      const data = await this.jsonp('getMeds', params);
      const normalized = (data || []).map(this.normalizeMed);
      if (!targetUserId || targetUserId === userId) this.syncLocalMeds(normalized);
      return normalized;
    } catch (error) {
      return this.getLocalMeds();
    }
  },

  async saveMed(med, userId, targetUserId = null) {
    try {
      const params = { data: JSON.stringify(med), userId };
      if (targetUserId && targetUserId !== userId) params.targetUserId = targetUserId;
      return await this.jsonp('saveMed', params);
    } catch (error) {
      this.saveLocalMed(med);
      return { success: true, offline: true };
    }
  },

  async deleteMed(id, userId, targetUserId = null) {
    try {
      const params = { id, userId };
      if (targetUserId && targetUserId !== userId) params.targetUserId = targetUserId;
      return await this.jsonp('deleteMed', params);
    } catch (error) {
      this.deleteLocalMed(id);
      return { success: true, offline: true };
    }
  },

  async getHistory(userId, targetUserId = null) {
    try {
      const params = { userId };
      if (targetUserId && targetUserId !== userId) params.targetUserId = targetUserId;
      const data = await this.jsonp('getHistory', params);
      if (!targetUserId || targetUserId === userId) this.syncLocalHistory(data);
      return data;
    } catch (error) {
      return this.getLocalHistory();
    }
  },

  async logHistory(log, userId, targetUserId = null) {
    try {
      const params = { data: JSON.stringify(log), userId };
      if (targetUserId && targetUserId !== userId) params.targetUserId = targetUserId;
      return await this.jsonp('logHistory', params);
    } catch (error) {
      this.saveLocalHistory(log);
      return { success: true, offline: true };
    }
  },

  async deleteHistoryLog(logId, userId, targetUserId = null) {
    try {
      const params = { logId, userId };
      if (targetUserId && targetUserId !== userId) params.targetUserId = targetUserId;
      return await this.jsonp('deleteHistoryLog', params);
    } catch (error) {
      this.deleteLocalHistoryLog(logId);
      return { success: true, offline: true };
    }
  },

  async editHistoryLog(logId, timestamp, date, userId, targetUserId = null) {
    try {
      const params = { logId, timestamp, date, userId };
      if (targetUserId && targetUserId !== userId) params.targetUserId = targetUserId;
      return await this.jsonp('editHistoryLog', params);
    } catch (error) {
      this.editLocalHistoryLog(logId, timestamp, date);
      return { success: true, offline: true };
    }
  },

  async addManualHistoryLog(log, userId, targetUserId = null) {
    try {
      const params = { data: JSON.stringify(log), userId };
      if (targetUserId && targetUserId !== userId) params.targetUserId = targetUserId;
      return await this.jsonp('addManualHistoryLog', params);
    } catch (error) {
      this.addLocalManualHistoryLog(log);
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
  saveLocalMed(med) {
    const meds = this.getLocalMeds();
    const index = meds.findIndex(m => m.id === med.id);
    if (index > -1) {
      meds[index] = { ...meds[index], ...med, updatedAt: new Date().toISOString() };
    } else {
      med.id = med.id || 'local_' + Math.random().toString(36).substring(2, 9);
      meds.push({ ...med, updatedAt: new Date().toISOString() });
    }
    this.syncLocalMeds(meds);
  },
  deleteLocalMed(id) {
    const meds = this.getLocalMeds();
    const filtered = meds.filter(m => m.id !== id);
    this.syncLocalMeds(filtered);
  },
  saveLocalHistory(log) {
    const history = this.getLocalHistory();
    log.id = log.id || 'local_' + Math.random().toString(36).substring(2, 9);
    history.unshift(log);
    this.syncLocalHistory(history);
  },
  deleteLocalHistoryLog(logId) {
    const history = this.getLocalHistory();
    const filtered = history.filter(h => h.id !== logId);
    this.syncLocalHistory(filtered);
  },
  editLocalHistoryLog(logId, timestamp, date) {
    const history = this.getLocalHistory();
    const index = history.findIndex(h => h.id === logId);
    if (index > -1) {
      history[index] = { ...history[index], timestamp, date };
      this.syncLocalHistory(history);
    }
  },
  addLocalManualHistoryLog(log) {
    const history = this.getLocalHistory();
    log.id = log.id || 'local_' + Math.random().toString(36).substring(2, 9);
    history.unshift(log);
    this.syncLocalHistory(history);

    // Also increment dosesTaken and takenTodayCount in local meds
    if (log.medId) {
      const meds = this.getLocalMeds();
      const medIndex = meds.findIndex(m => m.id === log.medId);
      if (medIndex > -1) {
        meds[medIndex].dosesTaken = (meds[medIndex].dosesTaken || 0) + 1;
        const lastReset = meds[medIndex].lastResetDate || '';
        const logDateStr = log.date;
        if (logDateStr === lastReset) {
          meds[medIndex].takenTodayCount = (meds[medIndex].takenTodayCount || 0) + 1;
        } else if (logDateStr > lastReset) {
          meds[medIndex].takenTodayCount = 1;
          meds[medIndex].lastResetDate = logDateStr;
        }
        this.syncLocalMeds(meds);
      }
    }
  },

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
