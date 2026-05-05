/**
 * Notification Service for ERGOMEDI-TRACKER
 */

export const setupNotifications = (meds) => {
  if (!("Notification" in window)) return;

  // Request permission
  if (Notification.permission !== "granted") {
    Notification.requestPermission();
  }

  // Clear existing timers (simplified for prototype)
  // In a real app, you'd use a Background Service Worker
  
  const checkMeds = () => {
    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    
    meds.forEach(med => {
      med.times?.forEach(time => {
        const [h, m] = time.split(':').map(Number);
        const doseTime = new Date();
        doseTime.setHours(h, m, 0);

        const diffMinutes = Math.round((doseTime - now) / 60000);

        if (diffMinutes === 10) {
          sendNotification(`Dosis en 10 min: ${med.name}`, `Es casi hora de tu dosis de ${med.dosage}`);
        } else if (diffMinutes === 5) {
          sendNotification(`Dosis en 5 min: ${med.name}`, `Prepárate para tu dosis de ${med.dosage}`);
        } else if (diffMinutes === 0) {
          sendNotification(`¡HOLA! Es hora de tu dosis: ${med.name}`, `Toma ${med.dosage} ahora.`);
          playAlarm();
        }
      });
    });
  };

  setInterval(checkMeds, 60000); // Check every minute
};

const sendNotification = (title, body) => {
  if (Notification.permission === "granted") {
    new Notification(title, { body, icon: '/icon-192.png' });
  }
};

const playAlarm = () => {
  const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
  audio.play();
};

export const shareToWhatsApp = (medName, progress) => {
  const text = `Reporte de Avance: ${medName} - Progreso: ${progress}%`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
};
