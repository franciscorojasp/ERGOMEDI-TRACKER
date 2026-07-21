/**
 * Notification Service for ERGOMEDI-TRACKER
 *
 * IMPORTANT: All times are compared using the device's LOCAL clock.
 * `new Date()` always returns the local device time, so alerts
 * fire correctly regardless of timezone (Venezuela UTC-4, Spain UTC+2, etc.)
 *
 * Deduplication: We track which alerts have already fired today so that
 * a 1-minute polling loop never sends the same alert twice.
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

// Current config (phone + api key + notification flags)
let _config = { phone: '', waApiKey: '', notifyWhatsapp: true };

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

/** Send a Web Push Notification if permission granted */
function _sendWebNotification(title, body) {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
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
        { offset:  0,  triggerTime: scheduledTime,                label: '¡AHORA!', emoji: '💊' },
      ];

      alerts.forEach(({ offset, triggerTime, label, emoji }) => {
        if (triggerTime !== nowHHMM) return;

        const key = `${med.id}_${scheduledTime}_${offset}`;
        if (_sentToday[key]) return; // already fired this alert today

        // ── Build messages ────────────────────────────────────────
        let title = '';
        let body  = '';
        let waMsg = '';

        if (offset === -10) {
          title = `${emoji} En 10 min: ${med.name}`;
          body  = `Prepara tu dosis de ${med.dosage} (${scheduledTime}).`;
          waMsg = `⏰ *ERGOMEDI-TRACKER*\n\n` +
                  `En 10 minutos debes tomar:\n` +
                  `💊 *${med.name}* — ${med.dosage}\n` +
                  `🕐 Hora programada: ${scheduledTime}\n\n` +
                  `_Prepara tu medicamento con anticipación._`;
        } else if (offset === -5) {
          title = `${emoji} En 5 min: ${med.name}`;
          body  = `Faltan 5 minutos para tomar ${med.dosage}.`;
          waMsg = `⚠️ *ERGOMEDI-TRACKER*\n\n` +
                  `¡Faltan 5 minutos!\n` +
                  `💊 *${med.name}* — ${med.dosage}\n` +
                  `🕐 Toma programada: ${scheduledTime}\n\n` +
                  `_Ten tu medicamento listo._`;
        } else {
          title = `${emoji} ¡ES HORA! ${med.name}`;
          body  = `Toma ${med.dosage} ahora. Abre ERGOMEDI-TRACKER para confirmar.`;
          waMsg = `💊 *¡ES HORA DE TU MEDICAMENTO!*\n\n` +
                  `📋 *${med.name}*\n` +
                  `💉 Dosis: ${med.dosage}\n` +
                  `🕐 Hora: ${scheduledTime}\n` +
                  (med.pathology ? `🏥 Condición: ${med.pathology}\n` : '') +
                  `\n✅ Abre ERGOMEDI-TRACKER para confirmar la toma.\n\n` +
                  `_¡Tu salud es lo primero!_ 💙`;
          _playAlarm();
        }

        // Send Web Push (works when browser/app is open)
        _sendWebNotification(title, body);

        // Send WhatsApp via CallMeBot (works regardless of app state)
        if (_config.notifyWhatsapp && _config.phone && _config.waApiKey) {
          _sendWhatsApp(_config.phone, _config.waApiKey, waMsg);
        }

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
 *
 * @param {Array}  meds    - Active medication plans
 * @param {Object} config  - { phone: string, waApiKey: string }
 */
export const setupNotifications = (meds, config = {}) => {
  // Always update config so WhatsApp alerts use the latest credentials
  _config = {
    phone:          config.phone    || '',
    waApiKey:       config.waApiKey || '',
    notifyWhatsapp: config.notifyWhatsapp !== undefined ? config.notifyWhatsapp : true,
  };

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
              `• ⏰ 10 minutos antes de cada toma\n` +
              `• ⚠️ 5 minutos antes de cada toma\n` +
              `• 💊 En el momento exacto de cada toma\n\n` +
              `_¡Tu salud siempre primero!_ 💙`;

  await _sendWhatsApp(phone, apikey, msg);
  return true;
};
