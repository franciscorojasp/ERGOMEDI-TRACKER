/**
 * Notification Service for ERGOMEDI-TRACKER
 *
 * IMPORTANT: All times are compared using the device's LOCAL clock.
 * `new Date()` always returns the local device time, so alerts
 * fire correctly regardless of timezone (Venezuela UTC-4, Spain UTC+2, etc.)
 *
 * Deduplication: We track which alerts have already fired today so that
 * a 1-minute polling loop never sends the same alert twice.
 */

// Deduplication store: "medId_HH:MM_offset" → true
let _sentToday = {};
let _lastResetDate = '';

function _localDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _localHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Add `mins` minutes to "HH:MM" string, returns "HH:MM" */
function _addMins(timeStr, mins) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + mins;
  const hh = Math.floor(((total % 1440) + 1440) % 1440 / 60);
  const mm = ((total % 60) + 60) % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Send a Web Notification if permission granted */
function _sendNotification(title, body) {
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/icon-192.png', badge: '/icon-192.png' });
  }
}

/** Play the alarm sound */
function _playAlarm() {
  try {
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    audio.play().catch(() => {}); // ignore autoplay policy errors
  } catch (_) {}
}

/**
 * Main check — called every minute by the interval.
 * Compares current LOCAL device time against each scheduled dose time (±0, -5, -10 min).
 */
function _checkMeds(meds) {
  // Reset dedup cache at each new local day
  const today = _localDateStr();
  if (today !== _lastResetDate) {
    _sentToday = {};
    _lastResetDate = today;
  }

  const nowHHMM = _localHHMM();

  meds.forEach(med => {
    if (!Array.isArray(med.times)) return;

    med.times.forEach(scheduledTime => {
      const alerts = [
        { offset: -10, triggerTime: _addMins(scheduledTime, -10), label: '10 min',  emoji: '⏰' },
        { offset: -5,  triggerTime: _addMins(scheduledTime, -5),  label: '5 min',   emoji: '⚠️' },
        { offset:  0,  triggerTime: scheduledTime,                label: '¡AHORA!', emoji: '✅' },
      ];

      alerts.forEach(({ offset, triggerTime, label, emoji }) => {
        if (triggerTime !== nowHHMM) return;

        const key = `${med.id}_${scheduledTime}_${offset}`;
        if (_sentToday[key]) return; // already fired this alert today

        // ── Build messages ────────────────────────────────────────
        let title = '';
        let body  = '';
        if (offset === -10) {
          title = `${emoji} En 10 min: ${med.name}`;
          body  = `Prepara tu dosis de ${med.dosage} (${scheduledTime}).`;
        } else if (offset === -5) {
          title = `${emoji} En 5 min: ${med.name}`;
          body  = `Faltan 5 minutos para tomar ${med.dosage}.`;
        } else {
          title = `${emoji} ¡ES HORA! ${med.name}`;
          body  = `Toma ${med.dosage} ahora. Abre ERGOMEDI-TRACKER.`;
          _playAlarm();
        }

        _sendNotification(title, body);
        _sentToday[key] = true;
      });
    });
  });
}

// ── Interval handle (so we can restart when meds change) ──────────────
let _intervalHandle = null;

/**
 * Call this whenever the meds list changes.
 * Requests notification permission if not yet granted and starts
 * (or restarts) the 1-minute polling loop using the device's LOCAL clock.
 */
export const setupNotifications = (meds) => {
  if (!('Notification' in window)) return;

  if (Notification.permission === 'default') {
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') _startLoop(meds);
    });
  } else if (Notification.permission === 'granted') {
    _startLoop(meds);
  }
};

function _startLoop(meds) {
  if (_intervalHandle) clearInterval(_intervalHandle);
  // Run once immediately, then every 60 s
  _checkMeds(meds);
  _intervalHandle = setInterval(() => _checkMeds(meds), 60_000);
}

// ── WhatsApp share helper ─────────────────────────────────────────────
export const shareToWhatsApp = (medName, progress) => {
  const text = `Reporte de Avance: ${medName} - Progreso: ${progress}%`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
};
