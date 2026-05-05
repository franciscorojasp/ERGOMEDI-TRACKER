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
    if (user) fetchData(user.id, true);
    else setLoading(false);
  }, [user]);

  const fetchData = async (uid, showLoading = false) => {
    if (showLoading) setLoading(true);
    else setBackgroundSyncing(true);
    
    try {
      const [medsList, historyList] = await Promise.all([
        api.getMeds(uid),
        api.getHistory(uid)
      ]);
      setMeds(medsList || []);
      setHistoryLogs(historyList || []);
      if (medsList) setupNotifications(medsList);
    } catch (err) {
      console.error("Sync error:", err);
    } finally {
      setLoading(false);
      setBackgroundSyncing(false);
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    if (!loginIdentifier) return;
    setLoading(true);
    setErrorMessage("");
    try {
      const userData = await api.login(loginIdentifier);
      if (userData.error) {
        setErrorMessage(userData.error);
      } else {
        setUser(userData);
        localStorage.setItem('ergomedi_user', JSON.stringify(userData));
      }
    } catch (err) {
      setErrorMessage("Error de servidor. Revisa tu conexión.");
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
    if (!window.confirm("¿Eliminar este plan?")) return;
    const oldMeds = [...meds];
    setMeds(meds.filter(m => m.id !== id));
    try {
      await api.deleteMed(id, user.id);
    } catch (err) {
      setMeds(oldMeds);
      setErrorMessage("Error al eliminar.");
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
    const today = new Date().toISOString().split('T')[0];
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

  // PDF Export remains same
  const exportPDF = async (specificMed = null) => {
    const docPdf = new jsPDF();
    docPdf.setFillColor(13, 115, 119);
    docPdf.rect(0, 0, 210, 40, 'F');
    docPdf.setFontSize(24);
    docPdf.setTextColor(255, 255, 255);
    docPdf.text("ERGOMEDI-TRACKER", 105, 25, { align: 'center' });
    docPdf.setFontSize(10);
    docPdf.text("SISTEMA PROFESIONAL DE CONTROL MÉDICO", 105, 33, { align: 'center' });
    docPdf.setTextColor(100);
    docPdf.setFontSize(12);
    docPdf.text(specificMed ? `PLAN DETALLADO: ${specificMed.name.toUpperCase()}` : "REPORTE CONSOLIDADO DEL PLAN", 15, 55);
    docPdf.text(`FECHA: ${new Date().toLocaleDateString()}`, 195, 55, { align: 'right' });
    const targetMeds = specificMed ? [specificMed] : meds;
    const body = targetMeds.map(m => [
      m.name.toUpperCase(),
      m.dosage || 'N/A',
      m.times?.join(', ') || 'N/A',
      `${m.dosesTaken} / ${(m.durationDays || 0) * (m.timesPerDay || 1)}`,
      `${Math.round(((m.dosesTaken || 0) / ((m.durationDays || 1) * (m.timesPerDay || 1))) * 100)}%`
    ]);
    docPdf.autoTable({
      startY: 65,
      head: [['MEDICAMENTO', 'DOSIS', 'HORARIOS', 'TOMAS ACUM.', 'PROGRESO']],
      body,
      headStyles: { fillColor: [13, 115, 119], fontWeight: 'bold' },
      styles: { fontSize: 9, cellPadding: 5 }
    });
    docPdf.save(`ERGOMEDI_Reporte_${specificMed ? specificMed.name : 'Total'}_${Date.now()}.pdf`);
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
         <Pill size={48} className="animate-spin" style={{ color: 'var(--primary-light)' }} />
         <h1 style={{ fontSize: '2.5rem', fontWeight: 900, letterSpacing: '-1px' }}>
           <span style={{ color: 'var(--primary-light)' }}>ERGO</span>MEDI
         </h1>
      </div>
      <p style={{ color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', fontSize: '0.7rem' }}>Cargando Panel...</p>
    </div>
  );

  if (!user) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', background: 'var(--bg-main)' }}>
      <div className="card" style={{ maxWidth: '440px', width: '100%', textAlign: 'center', padding: '48px 40px' }}>
        <div className="logo" style={{ justifyContent: 'center', marginBottom: '40px', fontSize: '2rem' }}>
          <Pill size={44} style={{ color: 'var(--primary-light)' }} /> 
          <span style={{ fontWeight: 900, letterSpacing: '-1px' }}>
            <span style={{ color: 'var(--primary-light)' }}>ERGO</span>MEDI
          </span>
        </div>
        <h2 style={{ marginBottom: '8px', fontWeight: 800, fontSize: '1.5rem' }}>
          {authMode === 'login' ? 'Iniciar Sesión' : 'Registro de Usuario'}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '32px' }}>
          {authMode === 'login' ? 'Accede a tu panel ERGOMEDI-TRACKER' : 'Crea tu perfil en ERGOMEDI-TRACKER'}
        </p>
        
        <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ position: 'relative' }}>
             <input 
               type="text" 
               placeholder="Email o Teléfono" 
               className="input-field" 
               value={loginIdentifier} 
               onChange={e => setLoginIdentifier(e.target.value)} 
               required 
               style={{ paddingLeft: '45px', background: 'var(--bg-main)' }}
             />
             {loginIdentifier.includes('@') ? 
               <Mail size={18} style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)', color: 'var(--primary-light)' }} /> :
               <Phone size={18} style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)', color: 'var(--primary-light)' }} />
             }
          </div>
          <button type="submit" className="btn-primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', height: '54px', fontSize: '1rem' }}>
            {authMode === 'login' ? 'ENTRAR AL SISTEMA' : 'CREAR MI CUENTA'} <ArrowRight size={20} />
          </button>
        </form>

        <div style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid var(--border)' }}>
           <button 
             onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
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
    <div className="animate-fade">
      <audio ref={audioRef} src="https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3" />

      <header className="header">
        <div className="logo" style={{ fontSize: '1.4rem' }}>
          <Pill className="w-6 h-6" style={{ color: 'var(--primary-light)' }} />
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '32px' }}>
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
                    {meds.reduce((acc, m) => acc + (m.lastResetDate === new Date().toISOString().split('T')[0] ? (m.takenTodayCount || 0) : 0), 0)}
                  </p>
               </div>
            </div>

            <button onClick={() => exportPDF()} className="btn-primary" style={{ marginBottom: '32px', height: '56px', fontSize: '0.9rem' }}>
              <FileText size={20} /> DESCARGAR REPORTE MAESTRO
            </button>

            {meds.map(med => {
              const totalNeeded = (med.durationDays || 0) * (med.timesPerDay || 1);
              const progress = Math.min(100, Math.round(((med.dosesTaken || 0) / (totalNeeded || 1)) * 100));
              const isDoneToday = (med.lastResetDate === new Date().toISOString().split('T')[0] ? (med.takenTodayCount || 0) : 0) >= (med.timesPerDay || 1);

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
                       <Share2 size={18} onClick={() => shareToWhatsApp(med.name, progress)} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} />
                       <Download size={18} onClick={() => exportPDF(med)} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} />
                       <Pencil size={18} onClick={() => openEditModal(med)} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} />
                       <Trash2 size={18} onClick={() => deleteMed(med.id)} style={{ cursor: 'pointer', color: '#ef4444' }} />
                    </div>
                  </div>
                  <div className="progress-container" style={{ height: '10px', background: 'var(--bg-main)', marginBottom: '12px' }}>
                    <div className="progress-bar" style={{ width: `${progress}%`, background: 'linear-gradient(90deg, var(--primary) 0%, var(--primary-light) 100%)' }}></div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', fontWeight: 900, color: 'var(--text-muted)' }}>
                    <span style={{ color: 'var(--primary-light)' }}>{progress}% COMPLETADO</span>
                    <span>{med.dosesTaken} / {totalNeeded} TOMAS</span>
                  </div>
                  <button 
                    disabled={isDoneToday} 
                    onClick={() => markAsTaken(med)} 
                    className="btn-primary" 
                    style={{ marginTop: '20px', height: '52px', background: isDoneToday ? 'var(--bg-main)' : 'var(--primary)', color: isDoneToday ? 'var(--text-muted)' : 'white', border: isDoneToday ? '1px solid var(--border)' : 'none' }}
                  >
                    {isDoneToday ? 'META DIARIA CUMPLIDA' : `CONFIRMAR TOMA (${(med.lastResetDate === new Date().toISOString().split('T')[0] ? (med.takenTodayCount || 0) : 0) + 1}/${med.timesPerDay})`}
                  </button>
                </div>
              );
            })}
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
          <div className="animate-fade" style={{ textAlign: 'center' }}>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 900, marginBottom: '24px', textAlign: 'left' }}>AJUSTES</h2>
            <div className="card" style={{ padding: '48px 32px' }}>
               <Shield size={60} style={{ color: 'var(--primary-light)', margin: '0 auto 24px' }} />
               <h3 style={{ fontWeight: 900 }}>{user.identifier}</h3>
               <p style={{ fontSize: '0.7rem', color: 'var(--primary-light)', fontWeight: 900, textTransform: 'uppercase', marginBottom: '32px' }}>{user.role === 'admin' ? 'ADMINISTRADOR' : 'USUARIO'}</p>
               <button onClick={handleLogout} className="btn-primary" style={{ background: '#ef4444' }}>
                 <LogOut size={20} /> CERRAR SESIÓN
               </button>
            </div>
          </div>
        )}
      </main>

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)', zIndex: 2000, display: 'flex', alignItems: 'flex-end' }}>
          <div className="animate-fade" style={{ background: 'var(--bg-modal)', width: '100%', borderTopLeftRadius: '40px', borderTopRightRadius: '40px', padding: '32px', maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '32px' }}>
              <h3 style={{ fontWeight: 900 }}>{editingId ? 'EDITAR PLAN' : 'NUEVO PLAN'}</h3>
              <X onClick={closeModal} size={24} />
            </div>
            <form onSubmit={handleSaveMed}>
              <div className="input-group">
                <label style={{ fontWeight: 900, fontSize: '0.7rem', color: 'var(--primary-light)' }}>MEDICAMENTO</label>
                <input type="text" className="input-field" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={{ background: 'var(--bg-main)' }} />
              </div>
              <div className="input-group">
                <label style={{ fontWeight: 900, fontSize: '0.7rem', color: 'var(--primary-light)' }}>RECETA MÉDICA (DRIVE)</label>
                <div style={{ position: 'relative', height: '140px', background: 'var(--bg-main)', borderRadius: '20px', border: '2px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                   {formData.prescriptionUrl ? <img src={formData.prescriptionUrl.replace('open?', 'uc?export=view&')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <ImageIcon size={32} style={{ color: 'var(--text-muted)' }} />}
                   <input type="file" accept="image/*" onChange={handleFileUpload} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div className="input-group"><label style={{ fontWeight: 900, fontSize: '0.7rem', color: 'var(--primary-light)' }}>DOSIS</label><input type="text" className="input-field" value={formData.dosage} onChange={e => setFormData({...formData, dosage: e.target.value})} style={{ background: 'var(--bg-main)' }} /></div>
                <div className="input-group"><label style={{ fontWeight: 900, fontSize: '0.7rem', color: 'var(--primary-light)' }}>DURACIÓN (DÍAS)</label><input type="number" className="input-field" value={formData.durationDays} onChange={e => setFormData({...formData, durationDays: parseInt(e.target.value) || 1})} style={{ background: 'var(--bg-main)' }} /></div>
              </div>
              <div className="input-group">
                <label style={{ fontWeight: 900, fontSize: '0.7rem', color: 'var(--primary-light)' }}>FRECUENCIA DIARIA: {formData.timesPerDay}</label>
                <input type="range" min="1" max="8" style={{ width: '100%' }} value={formData.timesPerDay} onChange={e => handleFrequencyChange(e.target.value)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '32px' }}>
                {formData.times.map((t, i) => (
                  <input key={i} type="time" className="input-field" value={t} onChange={e => {
                    const nt = [...formData.times]; nt[i] = e.target.value; setFormData({...formData, times: nt});
                  }} style={{ background: 'var(--bg-main)' }} />
                ))}
              </div>
              <button type="submit" className="btn-primary" style={{ height: '60px', fontWeight: 900 }}>GUARDAR EN GOOGLE SHEETS</button>
            </form>
          </div>
        </div>
      )}

      <div className="fab" onClick={() => setShowModal(true)} style={{ width: '64px', height: '64px' }}><Plus size={32} /></div>

      <nav className="nav-bottom">
        <div className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}><Activity size={24} /><span>Dashboard</span></div>
        <div className={`nav-item ${activeTab === 'historial' ? 'active' : ''}`} onClick={() => setActiveTab('historial')}><History size={24} /><span>Historial</span></div>
        <div className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveTab('profile')}><Settings size={24} /><span>Ajustes</span></div>
      </nav>
    </div>
  );
}
