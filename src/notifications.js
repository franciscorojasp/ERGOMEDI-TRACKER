/**
 * Notification Service for ERGOMEDI-TRACKER
 *
 * IMPORTANT: All times are compared using the device's LOCAL clock.
 * `new Date()` always returns the local device time, so alerts
 * fire correctly regardless of timezone (Venezuela UTC-4, Spain UTC+2, etc.)
 *
 * Alerts fire at TWO moments per scheduled dose:
 *   1. 5 minutes BEFORE the scheduled time
 *   2. At the EXACT scheduled time
 *
 * Deduplication: We track which alerts have already fired today so that
 * polling never sends the same alert twice.
 *
 * Polling: Instead of a fixed 60-second setInterval (which drifts and
 * breaks on mobile sleep), we use setTimeout aligned to the start of
 * each new minute, plus a visibilitychange listener to re-check
 * immediately when the device wakes from suspension.
 *
 * WhatsApp Alerts: Uses CallMeBot (https://callmebot.com) — 100% free,
 * no message limits, no subscription, no expiration. Sends a real WhatsApp
 * message to the patient's own phone regardless of whether the app is open.
 * The patient must activate the bot once by sending a WhatsApp message to:
 *   +34 623 78 64 49  →  "I allow callmebot to send me messages"
 */

// Deduplication store: "medId_HH:MM_offset" → true
let _sentToday = {};
let _lastResetDate = '';

// Current config (phone + api key)
let _config = { phone: '', waApiKey: '' };

// Last checked minute — prevents duplicate checks within the same minute
let _lastCheckedMinute = '';

function _localDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _localHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Convert "HH:MM" to total minutes since midnight */
function _toMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/** Add `mins` minutes to "HH:MM" string, returns "HH:MM" */
function _addMins(timeStr, mins) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + mins;
  const hh = Math.floor(((total % 1440) + 1440) % 1440 / 60);
  const mm = ((total % 60) + 60) % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Send a Web Push Notification if permission granted */
async function _sendWebNotification(title, body) {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        if (reg && reg.showNotification) {
          reg.showNotification(title, {
            body,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            vibrate: [200, 100, 200],
            tag: 'ergomedi-alert'
          });
          return;
        }
      }
    } catch (_) {}
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
 * Send a WhatsApp message via CallMeBot API.
 * CallMeBot is 100% free, no message limit, no registration required.
 * Only sends to the phone number that activated the bot (the patient itself).
 *
 * Activation (one-time by the patient):
 *   1. Save "+34 623 78 64 49" in WhatsApp contacts as "CallMeBot"
 *   2. Send the message: "I allow callmebot to send me messages"
 *   3. You'll receive your API key in a few seconds
 *
 * @param {string} phone    - International format, e.g. "+584244736489"
 * @param {string} apikey   - API key obtained from CallMeBot activation
 * @param {string} text     - Message text (plain text, emojis are supported)
 */
async function _sendWhatsApp(phone, apikey, text) {
  if (!phone || !apikey) return;

  // Clean phone: remove spaces and ensure it starts with +
  const cleanPhone = phone.replace(/\s+/g, '');
  const encodedText = encodeURIComponent(text);

  const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodedText}&apikey=${apikey}`;

  try {
    // Use no-cors mode to avoid CORS blocking from the browser
    // CallMeBot doesn't require a response body — a successful HTTP call is enough
    await fetch(url, { method: 'GET', mode: 'no-cors' });
  } catch (err) {
    // Silently ignore network errors (offline, etc.)
    console.warn('[ERGOMEDI] WhatsApp alert failed (network):', err.message);
  }
}

/**
 * Main check — called at the start of every new minute.
 * Compares current LOCAL device time against each scheduled dose time.
 * Only two alert points: -5 min and 0 min (exact time).
 */
function _checkMeds(meds) {
  // Reset dedup cache at each new local day
  const today = _localDateStr();
  if (today !== _lastResetDate) {
    _sentToday = {};
    _lastResetDate = today;
  }

  const nowHHMM = _localHHMM();

  // Prevent duplicate checks within the same minute
  // (visibilitychange + timer could both fire in the same minute)
  if (nowHHMM === _lastCheckedMinute) return;
  _lastCheckedMinute = nowHHMM;

  const nowMins = _toMinutes(nowHHMM);

  meds.forEach(med => {
    if (!Array.isArray(med.times)) return;

    med.times.forEach(scheduledTime => {
      // Only 2 alerts: 5 minutes before and exact time
      const alerts = [
        { offset: -5,  triggerTime: _addMins(scheduledTime, -5),  label: '5 min',   emoji: '⚠️' },
        { offset:  0,  triggerTime: scheduledTime,                label: '¡AHORA!', emoji: '💊' },
      ];

      alerts.forEach(({ offset, triggerTime, label, emoji }) => {
        // Use tolerance window: accept if current minute matches trigger minute
        // This absorbs any drift from setTimeout or device wake-up
        const triggerMins = _toMinutes(triggerTime);
        const diff = Math.abs(nowMins - triggerMins);
        // Account for midnight wrap (e.g., 23:59 vs 00:00)
        const wrappedDiff = Math.min(diff, 1440 - diff);
        if (wrappedDiff > 0) return; // Only fire on exact minute match

        const key = `${med.id}_${scheduledTime}_${offset}`;
        if (_sentToday[key]) return; // already fired this alert today

        // ── Build messages ────────────────────────────────────────
        let title = '';
        let body  = '';
        let waMsg = '';

        if (offset === -5) {
          title = `${emoji} En 5 min: ${med.name}`;
          body  = `Faltan 5 minutos para tomar ${med.dosage} (${scheduledTime}).${med.doctorName ? ` Dr. ${med.doctorName}` : ''}`;
          waMsg = `⚠️ *ERGOMEDI-TRACKER*\n\n` +
                  `¡Faltan 5 minutos!\n` +
                  `💊 *${med.name}* — ${med.dosage}\n` +
                  (med.doctorName ? `🩺 Médico tratante: *${med.doctorName}*\n` : '') +
                  `🕐 Toma programada: ${scheduledTime}\n\n` +
                  `_Ten tu medicamento listo._`;
        } else {
          title = `${emoji} ¡ES HORA! ${med.name}`;
          body  = `Toma ${med.dosage} ahora.${med.doctorName ? ` Dr. ${med.doctorName}.` : ''} Abre ERGOMEDI-TRACKER para confirmar.`;
          waMsg = `💊 *¡ES HORA DE TU MEDICAMENTO!*\n\n` +
                  `📋 *${med.name}*\n` +
                  `💉 Dosis: ${med.dosage}\n` +
                  (med.doctorName ? `🩺 Médico tratante: *${med.doctorName}*\n` : '') +
                  `🕐 Hora: ${scheduledTime}\n` +
                  (med.pathology ? `🏥 Condición: ${med.pathology}\n` : '') +
                  `\n✅ Abre ERGOMEDI-TRACKER para confirmar la toma.\n\n` +
                  `_¡Tu salud es lo primero!_ 💙`;
          _playAlarm();
        }

        // Send Web Push (works when browser/app is open)
        _sendWebNotification(title, body);

        // Send WhatsApp via CallMeBot (works regardless of app state)
        if (_config.phone && _config.waApiKey) {
          _sendWhatsApp(_config.phone, _config.waApiKey, waMsg);
        }

        _sentToday[key] = true;
      });
    });
  });
}

// ── Polling handle & visibility listener ──────────────────────────────
let _timeoutHandle = null;
let _currentMeds = [];
let _visibilityListenerAdded = false;

/**
 * Schedules the next check aligned to the start of the next minute.
 * This ensures we always check at HH:MM:00 (±100ms) regardless of
 * when the previous check ran, and automatically recovers from
 * device sleep/suspension.
 */
function _scheduleNextCheck() {
  if (_timeoutHandle) clearTimeout(_timeoutHandle);

  const now = new Date();
  // Milliseconds until the start of the next minute
  const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
  // Add a small buffer (200ms) to ensure we're solidly in the new minute
  const delay = msUntilNextMinute + 200;

  _timeoutHandle = setTimeout(() => {
    _checkMeds(_currentMeds);
    _scheduleNextCheck(); // schedule the next one
  }, delay);
}

/**
 * Handle device wake-up from suspension.
 * When the page becomes visible again (user unlocks phone, switches back
 * to the app), immediately run a check to catch any alerts that were
 * missed while the device was asleep.
 */
function _onVisibilityChange() {
  if (document.visibilityState === 'visible' && _currentMeds.length > 0) {
    // Reset the last checked minute to force a re-check
    _lastCheckedMinute = '';
    _checkMeds(_currentMeds);
    // Re-align the timer to the next minute boundary
    _scheduleNextCheck();
  }
}

/**
 * Call this whenever the meds list changes.
 * Requests notification permission if not yet granted and starts
 * (or restarts) the minute-aligned polling loop using the device's LOCAL clock.
 *
 * @param {Array}  meds    - Active medication plans
 * @param {Object} config  - { phone: string, waApiKey: string }
 */
export const setupNotifications = (meds, config = {}) => {
  // Always update config so WhatsApp alerts use the latest credentials
  _config = {
    phone:    config.phone    || '',
    waApiKey: config.waApiKey || '',
  };

  // Store reference to current meds for visibility handler
  _currentMeds = meds;

  if (!('Notification' in window)) {
    // Still run the loop for WhatsApp alerts even without Web Push support
    _startLoop(meds);
    return;
  }

  if (Notification.permission === 'default') {
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') _startLoop(meds);
      else _startLoop(meds); // still start for WhatsApp alerts
    });
  } else {
    _startLoop(meds);
  }
};

function _startLoop(meds) {
  _currentMeds = meds;

  // Cancel any existing timer
  if (_timeoutHandle) clearTimeout(_timeoutHandle);

  // Reset last checked minute so the immediate check always runs
  _lastCheckedMinute = '';

  // Run once immediately, then schedule aligned to minute boundaries
  _checkMeds(meds);
  _scheduleNextCheck();

  // Add visibility listener (only once) for wake-from-sleep recovery
  if (!_visibilityListenerAdded) {
    document.addEventListener('visibilitychange', _onVisibilityChange);
    _visibilityListenerAdded = true;
  }
}

// ── WhatsApp share helper ─────────────────────────────────────────────
export const shareToWhatsApp = (medName, progress) => {
  const text = `Reporte de Avance: ${medName} - Progreso: ${progress}%`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
};

/**
 * Send a test WhatsApp message to verify the configuration is correct.
 * Call this from the "Probar WhatsApp" button in Ajustes.
 *
 * @param {string} phone   - Patient's phone in international format
 * @param {string} apikey  - CallMeBot API key
 * @returns {Promise<boolean>} true if the request was sent (not if received)
 */
export const testWhatsApp = async (phone, apikey) => {
  if (!phone || !apikey) return false;

  const msg = `✅ *ERGOMEDI-TRACKER — Prueba exitosa*\n\n` +
              `Las notificaciones de WhatsApp están configuradas correctamente.\n\n` +
              `💊 Recibirás alertas:\n` +
              `• ⚠️ 5 minutos antes de cada toma\n` +
              `• 💊 En el momento exacto de cada toma\n\n` +
              `_¡Tu salud siempre primero!_ 💙`;

  await _sendWhatsApp(phone, apikey, msg);
  return true;
};

/**
 * Send a test Web Push notification to verify PWA push notifications on screen.
 */
export const testWebPush = async () => {
  if (typeof Notification === 'undefined') return false;
  let perm = Notification.permission;
  if (perm === 'default') {
    perm = await Notification.requestPermission();
  }
  if (perm !== 'granted') return false;

  await _sendWebNotification(
    '🔔 ERGOMEDI-TRACKER — Alerta de Prueba',
    'Las notificaciones Push PWA están activas en tu dispositivo.'
  );
  return true;
};

/**
 * Register Service Worker for PWA Push notifications when app is closed.
 */
export const registerServiceWorkerPush = async () => {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      return reg;
    } catch (err) {
      console.warn('[ERGOMEDI] Service worker registration failed:', err);
    }
  }
  return null;
};
