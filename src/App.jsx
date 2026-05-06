import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, Bell, CheckCircle2, Trash2, Clock, Pill, 
  Calendar, AlertCircle, Settings, X, Save, FileText, 
  Pencil, RotateCcw, History, Activity, Download, RefreshCw,
  ChevronRight, Volume2, VolumeX, LogOut, User, Image as ImageIcon,
  Send, Share2, Phone, Mail, ArrowRight, UserPlus, Shield
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { api } from './api';
import { setupNotifications, shareToWhatsApp } from './notifications';

const getDriveImageUrl = (url) => {
  if (!url) return null;
  if (!url.includes('drive.google.com')) return url;
  
  let fileId = '';
  if (url.includes('/d/')) {
    fileId = url.split('/d/')[1].split('/')[0];
  } else if (url.includes('id=')) {
    fileId = url.split('id=')[1].split('&')[0];
  }
  
  return fileId ? `https://drive.google.com/uc?export=view&id=${fileId}` : url;
};

export default function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('ergomedi_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [meds, setMeds] = useState([]);
  const [historyLogs, setHistoryLogs] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [activeTab, setActiveTab] = useState('dashboard');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [authMode, setAuthMode] = useState('login');
  // PWA Install prompt
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  const audioRef = useRef(null);

  const initialFormState = {
    name: '',
    dosage: '',
    times: ['08:00'],
    timesPerDay: 1,
    durationDays: 7,
    startDate: new Date().toISOString().split('T')[0],
    notes: '',
    dosesTaken: 0,
    takenTodayCount: 0,
    prescriptionUrl: ''
  };
  const [formData, setFormData] = useState(initialFormState);

  useEffect(() => {
    if (user?.id) fetchData(user.id, true);
    else setLoading(false);
  }, [user?.id]);

  // Local-timezone date helper — avoids UTC offset bugs (e.g. UTC-4 users after 8pm)
  const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // Auto-reset at local midnight (Venezuela UTC-4 and any timezone)
  // Calculates exact ms until 00:00:00 local time, then refreshes data
  useEffect(() => {
    if (!user) return;
    const scheduleReset = () => {
      const now = new Date();
      const msUntilMidnight =
        new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0).getTime() - now.getTime();
      return setTimeout(() => {
        fetchData(user.id); // Re-fetch: takenTodayCount won't match new date, so UI resets
        scheduleReset();    // Reschedule for next midnight
      }, msUntilMidnight);
    };
    const t = scheduleReset();
    return () => clearTimeout(t);
  }, [user?.id]);

  // PWA Install prompt capture
  useEffect(() => {
    // Don't show if already installed as standalone app
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (window.navigator.standalone === true) return; // iOS Safari

    const handler = (e) => {
      e.preventDefault(); // Prevent default mini-infobar
      setInstallPromptEvent(e);
      setShowInstallBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Hide banner if user installs from outside
    window.addEventListener('appinstalled', () => {
      setShowInstallBanner(false);
      setInstallPromptEvent(null);
    });

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallPWA = async () => {
    if (!installPromptEvent) return;
    await installPromptEvent.prompt();
    const { outcome } = await installPromptEvent.userChoice;
    if (outcome === 'accepted') {
      setShowInstallBanner(false);
      setInstallPromptEvent(null);
    }
  };

  const fetchData = async (uid, showLoading = false) => {
    if (showLoading) setLoading(true);
    else setBackgroundSyncing(true);
    
    try {
      const [medsList, historyList] = await Promise.all([
        api.getMeds(uid),
        api.getHistory(uid)
      ]);

      // Deduplicate by id — keep the last occurrence (highest dosesTaken wins)
      // Layer 1: deduplicate by id
      const byId = (medsList || []).reduce((acc, m) => {
        const key = String(m.id);
        if (!acc[key] || (m.dosesTaken || 0) >= (acc[key].dosesTaken || 0)) acc[key] = m;
        return acc;
      }, {});

      // Layer 2: deduplicate by name+dosage — catches rows with DIFFERENT ids that are the same plan
      const byName = Object.values(byId).reduce((acc, m) => {
        const key = `${String(m.name).trim().toLowerCase()}|${String(m.dosage).trim().toLowerCase()}`;
        if (!acc[key] || (m.dosesTaken || 0) >= (acc[key].dosesTaken || 0)) acc[key] = m;
        return acc;
      }, {});

      const deduped = Object.values(byName);

      setMeds(deduped);
      setHistoryLogs(historyList || []);
      if (deduped.length) setupNotifications(deduped);
    } catch (err) {
      console.error("Sync error:", err);
    } finally {
      setLoading(false);
      setBackgroundSyncing(false);
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    const trimmed = loginIdentifier.trim();
    if (!trimmed) return;
    setLoading(true);
    setErrorMessage("");
    try {
      const userData = await api.login(trimmed);
      if (!userData || userData.error) {
        setErrorMessage(userData?.error || "No se pudo conectar con el servidor. Verifica tu conexión a internet.");
      } else {
        setUser(userData);
        localStorage.setItem('ergomedi_user', JSON.stringify(userData));
      }
    } catch (err) {
      console.error("Auth error:", err);
      setErrorMessage("Error de conexión. Verifica tu acceso a internet e inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('ergomedi_user');
  };

  const handleFrequencyChange = (newFreq) => {
    const freq = parseInt(newFreq);
    setFormData(prev => {
      let newTimes = [...prev.times];
      while (newTimes.length < freq) newTimes.push("08:00");
      return { ...prev, timesPerDay: freq, times: newTimes.slice(0, freq) };
    });
  };

  const handleSaveMed = async (e) => {
    e.preventDefault();
    if (!formData.name || !user) return;
    
    const dataToSave = { ...formData };
    if (editingId) dataToSave.id = editingId;
    
    // Optimistic Update
    const oldMeds = [...meds];
    if (editingId) {
      setMeds(meds.map(m => m.id === editingId ? dataToSave : m));
    } else {
      const tempId = 'temp-' + Date.now();
      setMeds([...meds, { ...dataToSave, id: tempId }]);
    }
    
    closeModal();

    try {
      await api.saveMed(dataToSave, user.id);
      fetchData(user.id); // Sync in background
    } catch (err) {
      setMeds(oldMeds);
      setErrorMessage("Error al sincronizar con la nube.");
    }
  };

  const deleteMed = async (id) => {
    if (!window.confirm("¿Eliminar este plan permanentemente? Esta acción no se puede deshacer.")) return;
    const oldMeds = [...meds];
    setMeds(meds.filter(m => m.id !== id)); // Optimistic remove
    try {
      await api.deleteMed(id, user.id);
      fetchData(user.id); // Confirm real backend state
    } catch (err) {
      setMeds(oldMeds); // Rollback on error
      setErrorMessage("Error al eliminar el plan. Intenta nuevamente.");
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !user) return;
    try {
      setBackgroundSyncing(true);
      const url = await api.uploadPrescription(file, user.id);
      setFormData({ ...formData, prescriptionUrl: url });
    } catch (err) {
      setErrorMessage("Error al subir imagen.");
    } finally {
      setBackgroundSyncing(false);
    }
  };

  const markAsTaken = async (med) => {
    if (!user) return;
    const today = localToday(); // local date, not UTC
    const timestamp = new Date().toISOString();
    
    // Optimistic Update
    const updatedMed = { 
      ...med, 
      dosesTaken: (med.dosesTaken || 0) + 1, 
      takenTodayCount: (med.lastResetDate === today ? (med.takenTodayCount || 0) : 0) + 1, 
      lastResetDate: today, 
      lastTakenDate: timestamp 
    };
    
    setMeds(meds.map(m => m.id === med.id ? updatedMed : m));
    if (soundEnabled && audioRef.current) audioRef.current.play();

    try {
      await api.logHistory({ 
        medId: med.id, 
        medName: med.name, 
        dosage: med.dosage, 
        timestamp, 
        date: today 
      }, user.id);
      await api.saveMed(updatedMed, user.id);
      fetchData(user.id); // Refresh history in background
    } catch (err) {
      console.error("Error logging:", err);
    }
  };

  const undoLastDose = async (med) => {
    if (!user) return;
    const today = localToday();
    const currentTakenToday = med.lastResetDate === today ? (med.takenTodayCount || 0) : 0;
    if (currentTakenToday <= 0) return; // Nothing to undo

    const updatedMed = {
      ...med,
      dosesTaken: Math.max(0, (med.dosesTaken || 0) - 1),
      takenTodayCount: currentTakenToday - 1,
      lastResetDate: today,
    };

    // Optimistic update
    setMeds(meds.map(m => m.id === med.id ? updatedMed : m));

    try {
      await api.saveMed(updatedMed, user.id);
      fetchData(user.id); // Refresh to remove last history entry
    } catch (err) {
      console.error('Error undoing dose:', err);
    }
  };

  const updateProfile = async (profileData) => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await api.updateProfile(user.id, profileData);
      if (res.success) {
        const updatedUser = { ...user, ...profileData };
        setUser(updatedUser);
        localStorage.setItem('ergomedi_user', JSON.stringify(updatedUser));
      }
    } catch (err) {
      setErrorMessage("Error al actualizar perfil.");
    } finally {
      setLoading(false);
    }
  };

  // PDF Export
  // Builds the PDF and returns a Blob (used by both download and share)
  // Layout mirrors the reference design:
  //   LEFT  column: logo image + "ERGOMEDI-TRACKER" label
  //   RIGHT column: company name (teal, bold), RIF/address, phone/email,
  //                 gap, Paciente + Médico
  //   DARK BAND: report title + date
  //   TABLE: medications
  const buildPDFBlob = async (specificMed = null) => {
    const docPdf = new jsPDF();
    const pageW  = docPdf.internal.pageSize.getWidth();
    const pageH  = docPdf.internal.pageSize.getHeight();

    // ── Load logo via canvas (handles large PNGs safely) ──────────
    const logoDataUrl = await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        // The original image contains text at the bottom.
        // We want to crop out the bottom ~18% and keep a square from the top.
        const cropH = img.naturalHeight * 0.82;
        const cropW = cropH; // Keep it square
        const sx = (img.naturalWidth - cropW) / 2;
        const sy = 0; // Align to top
        
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        // drawImage(img, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
        canvas.getContext('2d').drawImage(img, sx, sy, cropW, cropH, 0, 0, 128, 128);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = '/logo.png?v=' + Date.now();
    });

    // ── COLORS ────────────────────────────────────────────────────
    const TEAL       = [13, 115, 119]; // Main header bg and table headers
    const DARK_TEAL  = [9, 80, 84];    // Sub-header band
    const WHITE      = [255, 255, 255];
    
    const HEADER_H   = 55; // main header height
    const LOGO_X     = 10;
    const LOGO_Y     = 8;
    const LOGO_SZ    = 34; // logo size

    // ── MAIN HEADER BAND ──────────────────────────────────────────
    docPdf.setFillColor(...TEAL);
    docPdf.rect(0, 0, pageW, HEADER_H, 'F');

    // Logo image
    if (logoDataUrl) {
      docPdf.addImage(logoDataUrl, 'PNG', LOGO_X, LOGO_Y, LOGO_SZ, LOGO_SZ);
    }

    // "ERGOMEDI-TRACKER" label below logo
    docPdf.setFontSize(14);
    docPdf.setTextColor(...WHITE);
    docPdf.setFont(undefined, 'bold');
    docPdf.text('ERGOMEDI-TRACKER', LOGO_X, LOGO_Y + LOGO_SZ + 8);

    // ── RIGHT COLUMN: company info ────────────────────────────────
    // Company name
    docPdf.setFontSize(11);
    docPdf.setFont(undefined, 'bold');
    docPdf.text('ERGOEXPRESS, C.A.', pageW - 12, 14, { align: 'right' });

    // RIF / address / contact
    docPdf.setFontSize(7.5);
    docPdf.setFont(undefined, 'normal');
    docPdf.text('RIF: J-502512462  |  San Joaquín, Carabobo, Venezuela', pageW - 12, 19, { align: 'right' });
    docPdf.text('Teléfono: +58 424-4736489  |  Correo: ergoexpressinfo@gmail.com', pageW - 12, 24, { align: 'right' });

    // Patient & Doctor
    const patientName = user?.patientName || '(Configurar en Ajustes)';
    const doctorName  = user?.doctorName  || '(Configurar en Ajustes)';
    
    docPdf.setFontSize(8);
    
    // 1. Paciente
    docPdf.setFont(undefined, 'bold');
    const patientWidth = docPdf.getTextWidth(patientName);
    docPdf.text(patientName, pageW - 12, 34, { align: 'right' });
    
    docPdf.setFont(undefined, 'normal');
    docPdf.text('Paciente: ', pageW - 12 - patientWidth, 34, { align: 'right' });
    
    // 2. Médico Tratante
    docPdf.setFont(undefined, 'bold');
    const doctorWidth = docPdf.getTextWidth(doctorName);
    docPdf.text(doctorName, pageW - 12, 40, { align: 'right' });
    
    docPdf.setFont(undefined, 'normal');
    docPdf.text('Médico Tratante: ', pageW - 12 - doctorWidth, 40, { align: 'right' });

    // ── SUB-HEADER BAND: report title + date ──────────────────────
    const BAND_Y = HEADER_H;
    const BAND_H = 10;
    docPdf.setFillColor(...DARK_TEAL);
    docPdf.rect(0, BAND_Y, pageW, BAND_H, 'F');
    
    docPdf.setFontSize(8);
    docPdf.setTextColor(...WHITE);
    docPdf.setFont(undefined, 'normal');

    docPdf.text(
      specificMed ? `PLAN DETALLADO: ${specificMed.name.toUpperCase()}` : 'REPORTE CONSOLIDADO DE PLANES',
      pageW / 2, BAND_Y + 6.5, { align: 'center' }
    );
    docPdf.text(
      `FECHA: ${new Date().toLocaleDateString('es-VE')}`,
      pageW - 12, BAND_Y + 6.5, { align: 'right' }
    );

    // ── TABLE ─────────────────────────────────────────────────────
    const targetMeds = specificMed ? [specificMed] : meds;
    const body = targetMeds.map(m => [
      m.name.toUpperCase(),
      m.dosage || 'N/A',
      Array.isArray(m.times) ? m.times.join(', ') : (m.times || 'N/A'),
      `${m.dosesTaken || 0} / ${(m.durationDays || 0) * (m.timesPerDay || 1)}`,
      `${Math.round(((m.dosesTaken || 0) / ((m.durationDays || 1) * (m.timesPerDay || 1))) * 100)}%`
    ]);
    docPdf.autoTable({
      startY: BAND_Y + 14,
      head: [['MEDICAMENTO', 'DOSIS', 'HORARIOS', 'TOMAS ACUM.', 'PROGRESO']],
      body,
      headStyles: { fillColor: TEAL, fontStyle: 'bold', textColor: 255, fontSize: 8 },
      styles: { fontSize: 8.5, cellPadding: 5 },
      alternateRowStyles: { fillColor: [240, 250, 250] },
      columnStyles: { 4: { halign: 'center', fontStyle: 'bold' } },
      didDrawCell: (data) => {
        if (data.section === 'body' && data.column.index === 4) {
          const textContent = data.cell.text[0] || '0%';
          const percent = Math.min(100, Math.max(0, parseInt(textContent.replace('%', ''), 10) || 0));
          
          const { x, y, width, height } = data.cell;
          
          // Configuracion de la barra
          const barWidth = width - 12; // Dejar margen a los lados
          const barHeight = 3; 
          const barX = x + 6;
          const barY = y + height - 6; // Colocar en la parte inferior de la celda
          
          // Dibujar fondo de la barra (Gris claro)
          docPdf.setFillColor(220, 225, 225);
          docPdf.rect(barX, barY, barWidth, barHeight, 'F');
          
          // Dibujar el progreso de la barra (Teal oscuro)
          if (percent > 0) {
            docPdf.setFillColor(9, 130, 135); // Un teal un poco más vibrante para la barra
            docPdf.rect(barX, barY, barWidth * (percent / 100), barHeight, 'F');
          }
        }
      }
    });

    // ── FOOTER ────────────────────────────────────────────────────
    docPdf.setFontSize(7);
    docPdf.setTextColor(140);
    docPdf.setFont(undefined, 'italic');
    docPdf.setDrawColor(210);
    docPdf.line(15, pageH - 12, pageW - 15, pageH - 12);
    docPdf.text(
      'Desarrollado por ERGOEXPRESS, C.A.  —  Todos los Derechos Reservados',
      pageW / 2, pageH - 7, { align: 'center' }
    );

    return docPdf.output('blob');
  };

  // Download PDF directly
  const exportPDF = async (specificMed = null) => {
    const blob = await buildPDFBlob(specificMed);
    const fileName = `ERGOMEDI_Reporte_${specificMed ? specificMed.name : 'Total'}_${Date.now()}.pdf`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  // Share PDF via WhatsApp using Web Share API (native) or deep link fallback
  const shareReportWhatsApp = async (specificMed = null) => {
    const fileName = `ERGOMEDI_Reporte_${specificMed ? specificMed.name : 'Total'}.pdf`;
    const blob = await buildPDFBlob(specificMed);
    const file = new File([blob], fileName, { type: 'application/pdf' });

    // Try Web Share API first (Android / iOS native share sheet → WhatsApp)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: 'Reporte ERGOMEDI-TRACKER',
          text: `📋 Reporte de medicamentos - ${new Date().toLocaleDateString()}`,
          files: [file],
        });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // user cancelled
      }
    }

    // Fallback: download PDF + open WhatsApp with text summary
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = fileName; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    const lines = (specificMed ? [specificMed] : meds).map(m => {
      const total = (m.durationDays || 1) * (m.timesPerDay || 1);
      const pct   = Math.round(((m.dosesTaken || 0) / total) * 100);
      return `• ${m.name} — ${m.dosesTaken}/${total} tomas (${pct}%)`;
    });
    const msg = encodeURIComponent(
      `📋 *ERGOMEDI-TRACKER — Reporte ${new Date().toLocaleDateString()}*\n\n` +
      lines.join('\n') +
      `\n\n_(El PDF ya fue descargado en tu dispositivo)_`
    );
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  };

  const openEditModal = (med) => {
    setEditingId(med.id);
    const today = new Date().toISOString().split('T')[0];
    setFormData({ ...med, takenTodayCount: med.lastResetDate === today ? (med.takenTodayCount || 0) : 0 });
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); setEditingId(null); setFormData(initialFormState); setErrorMessage(""); };

  if (loading) return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-main)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', marginBottom: '24px' }}>
         <img src="/logo.png" alt="ERGOMEDI-TRACKER" style={{ width: '96px', height: '96px', objectFit: 'contain', animation: 'pulse 1.5s ease-in-out infinite', filter: 'drop-shadow(0 0 20px rgba(15,224,224,0.7))' }} />
         <h1 style={{ fontSize: '2.5rem', fontWeight: 900, letterSpacing: '-1px' }}>
           <span style={{ color: 'var(--primary-light)' }}>ERGO</span>MEDI
           <span style={{ fontSize: '1rem', opacity: 0.5, marginLeft: '6px' }}>TRACKER</span>
         </h1>
      </div>
      <p style={{ color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', fontSize: '0.7rem' }}>Cargando Panel...</p>
    </div>
  );

  if (!user) return (
    <div style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', padding: '20px' }}>
      <div className="card" style={{ maxWidth: '420px', width: '100%', textAlign: 'center', padding: '36px 28px' }}>
        <div className="logo" style={{ justifyContent: 'center', marginBottom: '28px', flexDirection: 'column', gap: '12px' }}>
          <img src="/logo.png" alt="ERGOMEDI-TRACKER" style={{ width: '90px', height: '90px', objectFit: 'contain', filter: 'drop-shadow(0 0 16px rgba(15,224,224,0.6))' }} />
          <span style={{ fontWeight: 900, letterSpacing: '-1px', fontSize: '1.5rem' }}>
            <span style={{ color: 'var(--primary-light)' }}>ERGO</span>MEDI
            <span style={{ fontSize: '0.9rem', opacity: 0.6, marginLeft: '4px' }}>TRACKER</span>
          </span>
        </div>
        <h2 style={{ marginBottom: '8px', fontWeight: 800, fontSize: '1.5rem' }}>
          {authMode === 'login' ? 'Acceder al Sistema' : 'Crear Nueva Cuenta'}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '8px' }}>
          {authMode === 'login'
            ? 'Ingresa tu email o teléfono registrado'
            : 'Regístrate con tu email o número de teléfono'}
        </p>
        {/* Informational note for new users */}
        <div style={{ background: 'var(--primary-dim)', border: '1px solid var(--primary-light)', borderRadius: '12px', padding: '10px 14px', marginBottom: '24px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
          <Shield size={16} style={{ color: 'var(--primary-light)', flexShrink: 0, marginTop: '2px' }} />
          <p style={{ fontSize: '0.75rem', color: 'var(--primary-light)', textAlign: 'left', margin: 0 }}>
            {authMode === 'login'
              ? 'No necesitas contraseña. Solo ingresa el email o teléfono con el que te registraste.'
              : 'No necesitas cuenta de terceros. Solo tu email o número de WhatsApp. ¡Es gratis!'}
          </p>
        </div>

        <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ position: 'relative' }}>
             <input 
               id="auth-identifier"
               type="text" 
               placeholder={authMode === 'login' ? 'Email o Teléfono' : 'Ej: maria@gmail.com o +58424...'}
               className="input-field" 
               value={loginIdentifier} 
               onChange={e => setLoginIdentifier(e.target.value)} 
               required 
               autoComplete="username"
               style={{ paddingLeft: '45px', background: 'var(--bg-main)' }}
             />
             {loginIdentifier.includes('@') ? 
               <Mail size={18} style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)', color: 'var(--primary-light)' }} /> :
               <Phone size={18} style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)', color: 'var(--primary-light)' }} />
             }
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={!loginIdentifier.trim()}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', height: '54px', fontSize: '1rem', opacity: !loginIdentifier.trim() ? 0.6 : 1 }}
          >
            {authMode === 'login' ? 'ENTRAR AL SISTEMA' : 'CREAR MI CUENTA'} <ArrowRight size={20} />
          </button>
        </form>

        <div style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid var(--border)' }}>
           <button 
             onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setErrorMessage(''); setLoginIdentifier(''); }}
             style={{ background: 'none', border: 'none', color: 'var(--primary-light)', fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', margin: '0 auto' }}
           >
             {authMode === 'login' ? <><UserPlus size={18} /> ¿NUEVO USUARIO? REGISTRARME</> : <><User size={18} /> ¿YA TIENES CUENTA? LOGUEARME</>}
           </button>
        </div>
        {errorMessage && (
          <div style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '16px', borderRadius: '16px', fontSize: '0.85rem', marginTop: '24px', border: '1px solid rgba(239, 68, 68, 0.2)', fontWeight: 700 }}>
            <AlertCircle size={16} style={{ display: 'inline', marginRight: '8px' }} /> {errorMessage}
          </div>
        )}
      </div>
    </div>
  );


  return (
    <div className="animate-fade" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <audio ref={audioRef} src="https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3" />

      <header className="header">
        <div className="logo" style={{ fontSize: '1.4rem', gap: '10px' }}>
          <img src="/logo.png" alt="ERGOMEDI-TRACKER" style={{ height: '38px', width: '38px', objectFit: 'contain', filter: 'drop-shadow(0 0 8px rgba(15,224,224,0.5))' }} />
          <span style={{ fontWeight: 900, letterSpacing: '-0.5px' }}>
            <span style={{ color: 'var(--primary-light)' }}>ERGO</span>MEDI
            <span style={{ fontSize: '0.7rem', opacity: 0.6, marginLeft: '4px' }}>TRACKER</span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {backgroundSyncing && <RefreshCw size={14} className="animate-spin" style={{ color: 'var(--primary-light)' }} />}
          <div onClick={() => setActiveTab('profile')} style={{ cursor: 'pointer', background: 'var(--primary-dim)', padding: '6px 12px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid var(--primary-light)' }}>
             <User size={16} style={{ color: 'var(--primary-light)' }} />
             <span style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--primary-light)', textTransform: 'uppercase' }}>
               {user.role === 'admin' ? 'SUPER USUARIO' : user.identifier.split('@')[0]}
             </span>
          </div>
        </div>
      </header>

      <main className="main-container">
        {activeTab === 'dashboard' ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
               <h2 style={{ fontSize: '1.6rem', fontWeight: 900, letterSpacing: '-0.5px' }}>DASHBOARD</h2>
               <div style={{ background: 'var(--primary-dim)', color: 'var(--primary-light)', padding: '6px 14px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 900, border: '1px solid var(--primary-light)' }}>
                 {meds.length} PLANES
               </div>
            </div>

            <div className="summary-grid">
               <div className="card" style={{ margin: 0, padding: '24px', textAlign: 'center', background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--primary-dim) 100%)' }}>
                  <Activity size={20} style={{ color: 'var(--primary-light)', margin: '0 auto 8px' }} />
                  <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '1px' }}>Progreso Plan</p>
                  <p style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--primary-light)' }}>
                    {meds.length ? Math.round(meds.reduce((acc, m) => acc + (m.dosesTaken || 0), 0) / meds.reduce((acc, m) => acc + ((m.durationDays || 1) * (m.timesPerDay || 1)), 0) * 100) : 0}%
                  </p>
               </div>
               <div className="card" style={{ margin: 0, padding: '24px', textAlign: 'center' }}>
                  <Clock size={20} style={{ color: 'var(--primary-light)', margin: '0 auto 8px' }} />
                  <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '1px' }}>Tomas Hoy</p>
                  <p style={{ fontSize: '2rem', fontWeight: 900 }}>
                    {meds.reduce((acc, m) => acc + (m.lastResetDate === localToday() ? (m.takenTodayCount || 0) : 0), 0)}
                  </p>
               </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '32px', flexWrap: 'wrap' }}>
              <button onClick={() => exportPDF()} className="btn-primary" style={{ flex: 1, minWidth: '200px', height: '56px', fontSize: '0.85rem' }}>
                <FileText size={18} /> DESCARGAR REPORTE
              </button>
              <button onClick={() => shareReportWhatsApp()} className="btn-primary" style={{ flex: 1, minWidth: '200px', height: '56px', fontSize: '0.85rem', background: 'linear-gradient(135deg, #25D366 0%, #128C7E 100%)', border: 'none' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.119.554 4.122 1.523 5.867L.057 23.17a.75.75 0 0 0 .92.92l5.33-1.466A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.896 0-3.67-.52-5.187-1.425l-.372-.218-3.861 1.063 1.063-3.848-.235-.385A9.945 9.945 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
                ENVIAR POR WHATSAPP
              </button>
            </div>

            <div className="meds-grid">
              {meds.map(med => {
              const totalNeeded = (med.durationDays || 0) * (med.timesPerDay || 1);
              const progress = Math.min(100, Math.round(((med.dosesTaken || 0) / (totalNeeded || 1)) * 100));
              
              const today = localToday(); // local date, not UTC
              const takenToday = med.lastResetDate === today ? (med.takenTodayCount || 0) : 0;
              const isDoneToday = takenToday >= (med.timesPerDay || 1);

              return (
                <div key={med.id} className="card animate-fade" style={{ padding: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                         <Pill size={16} style={{ color: 'var(--primary-light)' }} />
                         <h3 style={{ fontWeight: 900, fontSize: '1.1rem' }}>{med.name.toUpperCase()}</h3>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700 }}>{med.dosage} • {med.timesPerDay} veces al día</p>
                    </div>
                    <div style={{ display: 'flex', gap: '14px' }}>
                       <Share2 size={18} onClick={() => shareReportWhatsApp(med)} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} title="Compartir por WhatsApp" />
                       <Download size={18} onClick={() => exportPDF(med)} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} title="Descargar PDF" />
                       <Pencil size={18} onClick={() => openEditModal(med)} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} />
                       <Trash2 size={18} onClick={() => deleteMed(med.id)} style={{ cursor: 'pointer', color: '#ef4444' }} />
                    </div>
                  </div>
                  
                  {med.prescriptionUrl && (
                    <div style={{ marginBottom: '20px', borderRadius: '16px', overflow: 'hidden', height: '120px', border: '1px solid var(--border)', background: 'var(--bg-main)', position: 'relative' }}>
                       <img 
                         src={getDriveImageUrl(med.prescriptionUrl)} 
                         alt="Receta" 
                         style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                         onClick={() => window.open(med.prescriptionUrl, '_blank')}
                       />
                       <div style={{ position: 'absolute', bottom: '8px', right: '8px', background: 'rgba(0,0,0,0.6)', padding: '4px 8px', borderRadius: '8px', fontSize: '0.6rem', color: 'white', fontWeight: 700 }}>
                          VER RECETA
                       </div>
                    </div>
                  )}

                  {/* Indicador visual de tomas diarias */}
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    {Array.from({ length: med.timesPerDay || 1 }).map((_, i) => (
                      <div 
                        key={i} 
                        style={{ 
                          width: '12px', 
                          height: '12px', 
                          borderRadius: '50%', 
                          background: i < takenToday ? 'var(--primary-light)' : 'var(--bg-main)',
                          border: i < takenToday ? 'none' : '2px solid var(--border)',
                          boxShadow: i < takenToday ? '0 0 10px var(--primary-light)' : 'none'
                        }} 
                      />
                    ))}
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 800, marginLeft: '8px', textTransform: 'uppercase' }}>
                      {takenToday} de {med.timesPerDay} hoy
                    </span>
                  </div>

                  {/* Horarios de tomas */}
                  {Array.isArray(med.times) && med.times.length > 0 && (() => {
                    const nowTime = new Date();
                    const nowMins = nowTime.getHours() * 60 + nowTime.getMinutes();
                    // Find index of next upcoming dose
                    const nextIdx = med.times.findIndex(t => {
                      const [h, m] = t.split(':').map(Number);
                      return (h * 60 + m) > nowMins;
                    });
                    return (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
                        {med.times.map((t, i) => {
                          const [h, m] = t.split(':').map(Number);
                          const chipMins = h * 60 + m;
                          const isPast   = chipMins < nowMins;
                          const isNext   = i === nextIdx;
                          const isTaken  = i < takenToday;
                          // Format to 12h
                          const label = new Date(2000, 0, 1, h, m)
                            .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                          return (
                            <div key={i} style={{
                              display: 'flex', alignItems: 'center', gap: '4px',
                              padding: '4px 10px',
                              borderRadius: '20px',
                              fontSize: '0.68rem',
                              fontWeight: 800,
                              border: isNext
                                ? '1.5px solid var(--primary-light)'
                                : isTaken
                                  ? '1.5px solid var(--primary)'
                                  : '1.5px solid var(--border)',
                              background: isNext
                                ? 'var(--primary-dim)'
                                : isTaken
                                  ? 'rgba(13,115,119,0.15)'
                                  : 'var(--bg-main)',
                              color: isNext
                                ? 'var(--primary-light)'
                                : isTaken
                                  ? 'var(--primary-light)'
                                  : 'var(--text-muted)',
                              opacity: isPast && !isTaken ? 0.5 : 1,
                            }}>
                              {isTaken && <CheckCircle2 size={10} />}
                              {isNext && !isTaken && <Clock size={10} />}
                              {label}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  <div className="progress-container" style={{ height: '10px', background: 'var(--bg-main)', marginBottom: '12px' }}>
                    <div className="progress-bar" style={{ width: `${progress}%`, background: 'linear-gradient(90deg, var(--primary) 0%, var(--primary-light) 100%)' }}></div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', fontWeight: 900, color: 'var(--text-muted)' }}>
                    <span style={{ color: 'var(--primary-light)' }}>{progress}% COMPLETADO</span>
                    <span>{med.dosesTaken} / {totalNeeded} TOMAS TOTALES</span>
                  </div>
                  {/* Action buttons row */}
                  <div style={{ display: 'flex', gap: '10px', marginTop: '20px', alignItems: 'stretch' }}>
                    <button 
                      disabled={isDoneToday} 
                      onClick={() => markAsTaken(med)} 
                      className="btn-primary" 
                      style={{ 
                        flex: 1,
                        height: '52px', 
                        background: isDoneToday
                          ? 'linear-gradient(135deg, rgba(13,115,119,0.15), rgba(13,115,119,0.25))'
                          : 'var(--primary)', 
                        color: isDoneToday ? 'var(--primary-light)' : 'white', 
                        border: isDoneToday ? '1.5px solid var(--primary)' : 'none',
                        opacity: isDoneToday ? 0.9 : 1,
                        cursor: isDoneToday ? 'default' : 'pointer',
                      }}
                    >
                      {isDoneToday ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 900 }}>
                          <CheckCircle2 size={18} /> DOSIS COMPLETADAS
                        </div>
                      ) : (
                        `CONFIRMAR TOMA ${takenToday + 1} de ${med.timesPerDay}`
                      )}
                    </button>

                    {/* Undo button — only visible when at least 1 dose was logged today */}
                    {takenToday > 0 && (
                      <button
                        onClick={() => undoLastDose(med)}
                        title="Deshacer última toma registrada"
                        style={{
                          height: '52px',
                          width: '52px',
                          flexShrink: 0,
                          background: 'transparent',
                          border: '1.5px solid var(--border)',
                          borderRadius: '14px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          color: 'var(--text-muted)',
                          transition: 'border-color 0.2s, color 0.2s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.color = '#ef4444'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                      >
                        <RotateCcw size={18} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            </div>
          </>
        ) : activeTab === 'historial' ? (
          <div className="animate-fade">
            <h2 style={{ fontSize: '1.6rem', fontWeight: 900, marginBottom: '24px' }}>HISTORIAL</h2>
            {historyLogs.map(log => (
              <div key={log.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', padding: '20px', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  <CheckCircle2 size={22} style={{ color: 'var(--primary-light)' }} />
                  <div>
                    <h4 style={{ fontWeight: 900, fontSize: '0.95rem' }}>{log.medName.toUpperCase()}</h4>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{log.dosage}</p>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontWeight: 900, fontSize: '0.85rem', color: 'var(--primary-light)' }}>{new Date(log.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                  <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{new Date(log.timestamp).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="animate-fade">
            <h2 style={{ fontSize: '1.6rem', fontWeight: 900, marginBottom: '24px' }}>AJUSTES</h2>
            <div className="card" style={{ padding: '32px' }}>
               <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px' }}>
                  <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--primary-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                     <User size={32} style={{ color: 'var(--primary-light)' }} />
                  </div>
                  <div style={{ textAlign: 'left' }}>
                     <h3 style={{ fontWeight: 900, fontSize: '1.2rem' }}>{user.identifier}</h3>
                     <p style={{ fontSize: '0.7rem', color: 'var(--primary-light)', fontWeight: 900, textTransform: 'uppercase' }}>{user.role === 'admin' ? 'ADMINISTRADOR' : 'PACIENTE'}</p>
                  </div>
               </div>

               <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '20px' }}>

                  {/* ── DATOS DEL PACIENTE ── */}
                  <div style={{ paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
                    <p style={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '14px' }}>Datos para Reportes PDF</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      <div className="input-group">
                        <label style={{ fontWeight: 900, fontSize: '0.7rem', color: 'var(--primary-light)' }}>
                          <User size={14} style={{ display: 'inline', marginRight: '5px' }} /> NOMBRE DEL PACIENTE
                        </label>
                        <input
                          type="text"
                          className="input-field"
                          placeholder="Ej: María López"
                          value={user.patientName || ''}
                          onChange={e => setUser({...user, patientName: e.target.value})}
                          onBlur={() => updateProfile({ patientName: user.patientName })}
                          style={{ background: 'var(--bg-main)' }}
                        />
                      </div>
                      <div className="input-group">
                        <label style={{ fontWeight: 900, fontSize: '0.7rem', color: 'var(--primary-light)' }}>
                          <Shield size={14} style={{ display: 'inline', marginRight: '5px' }} /> MÉDICO TRATANTE
                        </label>
                        <input
                          type="text"
                          className="input-field"
                          placeholder="Ej: Dr. Roberto Leyva"
                          value={user.doctorName || ''}
                          onChange={e => setUser({...user, doctorName: e.target.value})}
                          onBlur={() => updateProfile({ doctorName: user.doctorName })}
                          style={{ background: 'var(--bg-main)' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* ── NOTIFICACIONES WHATSAPP ── */}
                  <div style={{ paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
                    <p style={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '14px' }}>Notificaciones WhatsApp</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      <div className="input-group">
                        <label style={{ fontWeight: 900, fontSize: '0.7rem', color: 'var(--primary-light)' }}>
                           <Phone size={14} style={{ display: 'inline', marginRight: '5px' }} /> TELÉFONO (PARA WHATSAPP)
                        </label>
                        <input
                          type="text"
                          className="input-field"
                          placeholder="Ej: +58424..."
                          value={user.phone || ''}
                          onChange={e => setUser({...user, phone: e.target.value})}
                          onBlur={() => updateProfile({ phone: user.phone })}
                          style={{ background: 'var(--bg-main)' }}
                        />
                      </div>
                      <div className="input-group">
                        <label style={{ fontWeight: 900, fontSize: '0.7rem', color: 'var(--primary-light)' }}>
                           <Bell size={14} style={{ display: 'inline', marginRight: '5px' }} /> CALLMEBOT API KEY
                        </label>
                        <input
                          type="text"
                          className="input-field"
                          placeholder="Obtenlo en callmebot.com"
                          value={user.waApiKey || ''}
                          onChange={e => setUser({...user, waApiKey: e.target.value})}
                          onBlur={() => updateProfile({ waApiKey: user.waApiKey })}
                          style={{ background: 'var(--bg-main)' }}
                        />
                        <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                          * Las alertas se enviarán a las horas configuradas en la hora local de tu dispositivo (10 min antes, 5 min antes y en el momento exacto).
                        </p>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button onClick={handleLogout} className="btn-primary" style={{ background: '#ef4444', flex: 1 }}>
                      <LogOut size={20} /> SALIR
                    </button>
                    <button onClick={() => window.open('https://www.callmebot.com/blog/free-api-whatsapp-messages/', '_blank')} className="btn-primary" style={{ background: 'var(--bg-main)', border: '1px solid var(--primary-light)', color: 'var(--primary-light)', flex: 1.5 }}>
                      <Activity size={18} /> OBTENER API KEY
                    </button>
                  </div>
               </div>
            </div>
          </div>
        )}
      </main>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box animate-fade">
            <div className="modal-header">
              <h3 style={{ fontWeight: 900, fontSize: '1rem' }}>{editingId ? 'EDITAR PLAN' : 'NUEVO PLAN'}</h3>
              <X onClick={closeModal} size={22} style={{ cursor: 'pointer' }} />
            </div>
            <div className="modal-body">
              <form onSubmit={handleSaveMed} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--primary-light)' }}>MEDICAMENTO</label>
                  <input type="text" className="input-field" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={{ background: 'var(--bg-main)', padding: '9px 14px' }} />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--primary-light)' }}>RECETA MÉDICA (DRIVE)</label>
                  <div style={{ position: 'relative', height: '70px', background: 'var(--bg-main)', borderRadius: '12px', border: '2px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', gap: '8px' }}>
                    {formData.prescriptionUrl 
                      ? <img src={getDriveImageUrl(formData.prescriptionUrl)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <><ImageIcon size={18} style={{ color: 'var(--text-muted)' }} /><span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Toca para subir foto</span></>
                    }
                    <input type="file" accept="image/*" onChange={handleFileUpload} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
                  </div>
                </div>
                <div className="form-grid">
                  <div className="input-group" style={{ marginBottom: 0 }}><label style={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--primary-light)' }}>DOSIS</label><input type="text" className="input-field" value={formData.dosage} onChange={e => setFormData({...formData, dosage: e.target.value})} style={{ background: 'var(--bg-main)', padding: '9px 14px' }} /></div>
                  <div className="input-group" style={{ marginBottom: 0 }}><label style={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--primary-light)' }}>DURACIÓN (DÍAS)</label><input type="number" className="input-field" value={formData.durationDays} onChange={e => setFormData({...formData, durationDays: parseInt(e.target.value) || 1})} style={{ background: 'var(--bg-main)', padding: '9px 14px' }} /></div>
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--primary-light)' }}>FRECUENCIA DIARIA: {formData.timesPerDay}</label>
                  <input type="range" min="1" max="8" style={{ width: '100%' }} value={formData.timesPerDay} onChange={e => handleFrequencyChange(e.target.value)} />
                </div>
                <div className="form-grid" style={{ gridTemplateColumns: formData.timesPerDay > 2 ? 'repeat(auto-fit, minmax(90px, 1fr))' : '1fr 1fr' }}>
                  {formData.times.map((t, i) => (
                    <input key={i} type="time" className="input-field" value={t} onChange={e => {
                      const nt = [...formData.times]; nt[i] = e.target.value; setFormData({...formData, times: nt});
                    }} style={{ background: 'var(--bg-main)', padding: '9px 14px' }} />
                  ))}
                </div>
                <button type="submit" className="btn-primary" style={{ height: '48px', fontWeight: 900, marginTop: '4px', fontSize: '0.85rem' }}>GUARDAR EN GOOGLE SHEETS</button>
              </form>
            </div>
          </div>
        </div>
      )}

      <div className="fab" onClick={() => setShowModal(true)} style={{ width: '64px', height: '64px' }}><Plus size={32} /></div>

      {/* ── PWA Install Banner ── */}
      {showInstallBanner && (
        <div className="pwa-install-banner">
          <div className="pwa-install-content">
            <div className="pwa-install-icon">
              <Pill size={28} style={{ color: 'var(--primary-light)' }} />
            </div>
            <div className="pwa-install-text">
              <strong>Instalar ERGOMEDI</strong>
              <span>Acceso rápido desde tu pantalla de inicio</span>
            </div>
          </div>
          <div className="pwa-install-actions">
            <button className="pwa-btn-install" onClick={handleInstallPWA}>
              Instalar
            </button>
            <button className="pwa-btn-dismiss" onClick={() => setShowInstallBanner(false)}>
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      <nav className="nav-bottom">
        <div className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}><Activity size={24} /><span>Dashboard</span></div>
        <div className={`nav-item ${activeTab === 'historial' ? 'active' : ''}`} onClick={() => setActiveTab('historial')}><History size={24} /><span>Historial</span></div>
        <div className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveTab('profile')}><Settings size={24} /><span>Ajustes</span></div>
      </nav>
    </div>
  );
}
