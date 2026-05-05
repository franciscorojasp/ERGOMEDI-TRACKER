import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, Bell, CheckCircle2, Trash2, Clock, Pill, 
  Calendar, AlertCircle, Settings, X, Save, FileText, 
  Pencil, RotateCcw, History, Activity, Download, RefreshCw,
  ChevronRight, Volume2, VolumeX, LogOut, User, Image as ImageIcon,
  Send, Share2, Phone, Mail, ArrowRight, UserPlus
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
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [activeTab, setActiveTab] = useState('dashboard');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'register'
  
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
    if (user) fetchData(user.id);
    else setLoading(false);
  }, [user]);

  const fetchData = async (uid) => {
    setLoading(true);
    try {
      const [medsList, historyList] = await Promise.all([
        api.getMeds(uid),
        api.getHistory(uid)
      ]);
      setMeds(medsList || []);
      setHistoryLogs(historyList || []);
      if (medsList) setupNotifications(medsList);
    } catch (err) {
      setErrorMessage("Error de conexión con el servidor.");
    } finally {
      setLoading(false);
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    if (!loginIdentifier) return;
    setLoading(true);
    setErrorMessage("");
    try {
      // In our current backend, login and register are handled by the same action
      // but we present it differently to the user for clarity.
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

  // ... (rest of logic remains same)
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
    if (!formData.name || saving || !user) return;
    setSaving(true);
    try {
      const dataToSave = { ...formData };
      if (editingId) dataToSave.id = editingId;
      await api.saveMed(dataToSave, user.id);
      await fetchData(user.id);
      closeModal();
    } catch (err) {
      setErrorMessage("Error al guardar.");
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !user) return;
    try {
      setSaving(true);
      const url = await api.uploadPrescription(file, user.id);
      setFormData({ ...formData, prescriptionUrl: url });
    } catch (err) {
      setErrorMessage("Error al subir imagen.");
    } finally {
      setSaving(false);
    }
  };

  const markAsTaken = async (med) => {
    if (!user) return;
    try {
      const today = new Date().toISOString().split('T')[0];
      const timestamp = new Date().toISOString();
      await api.logHistory({ medId: med.id, medName: med.name, dosage: med.dosage, timestamp, date: today }, user.id);
      const updatedMed = { ...med, dosesTaken: (med.dosesTaken || 0) + 1, takenTodayCount: (med.lastResetDate === today ? (med.takenTodayCount || 0) : 0) + 1, lastResetDate: today, lastTakenDate: timestamp };
      await api.saveMed(updatedMed, user.id);
      await fetchData(user.id);
      if (soundEnabled && audioRef.current) audioRef.current.play();
    } catch (err) {
      setErrorMessage("Error al registrar toma.");
    }
  };

  const exportPDF = async (specificMed = null) => {
    const docPdf = new jsPDF();
    docPdf.setFontSize(22);
    docPdf.setTextColor(13, 115, 119);
    docPdf.text("ERGOMEDI-TRACKER", 105, 20, { align: 'center' });
    docPdf.setFontSize(12);
    docPdf.setTextColor(100);
    docPdf.text(specificMed ? `REPORTE: ${specificMed.name}` : "REPORTE TOTAL DEL PLAN", 105, 28, { align: 'center' });

    const targetMeds = specificMed ? [specificMed] : meds;
    const body = targetMeds.map(m => [
      m.name.toUpperCase(),
      m.dosage,
      m.times?.join(', '),
      `${m.dosesTaken} / ${(m.durationDays || 0) * (m.timesPerDay || 1)}`,
      `${Math.round(((m.dosesTaken || 0) / ((m.durationDays || 1) * (m.timesPerDay || 1))) * 100)}%`
    ]);

    docPdf.autoTable({
      startY: 40,
      head: [['Medicamento', 'Dosis', 'Horarios', 'Tomas', 'Progreso']],
      body,
      headStyles: { fillColor: [13, 115, 119] }
    });

    docPdf.save(`Reporte_${specificMed ? specificMed.name : 'Total'}_${Date.now()}.pdf`);
  };

  const openEditModal = (med) => {
    setEditingId(med.id);
    const today = new Date().toISOString().split('T')[0];
    setFormData({ ...med, takenTodayCount: med.lastResetDate === today ? (med.takenTodayCount || 0) : 0 });
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); setEditingId(null); setFormData(initialFormState); setErrorMessage(""); };

  if (loading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <RefreshCw size={48} className="animate-spin" style={{ color: 'var(--primary)' }} />
    </div>
  );

  if (!user) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div className="card" style={{ maxWidth: '400px', width: '100%', textAlign: 'center', padding: '40px' }}>
        <div className="logo" style={{ justifyContent: 'center', marginBottom: '32px', fontSize: '1.8rem' }}>
          <Pill size={40} /> <span>ERGO</span>MEDI
        </div>
        <h2 style={{ marginBottom: '8px', fontWeight: 800 }}>
          {authMode === 'login' ? 'Bienvenido de nuevo' : 'Crea tu cuenta'}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '32px' }}>
          {authMode === 'login' ? 'Ingresa tus datos para acceder' : 'Regístrate para empezar tu control'}
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
               style={{ paddingLeft: '45px' }}
             />
             {loginIdentifier.includes('@') ? 
               <Mail size={18} style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} /> :
               <Phone size={18} style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
             }
          </div>
          <button type="submit" className="btn-primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            {authMode === 'login' ? 'Acceder' : 'Registrarme'} <ArrowRight size={18} />
          </button>
        </form>

        <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border)' }}>
           <button 
             onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
             style={{ background: 'none', border: 'none', color: 'var(--primary-light)', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', margin: '0 auto' }}
           >
             {authMode === 'login' ? <><UserPlus size={18} /> No tengo cuenta, registrarme</> : <><User size={18} /> Ya tengo cuenta, entrar</>}
           </button>
        </div>

        {errorMessage && (
          <div style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '12px', borderRadius: '12px', fontSize: '0.8rem', marginTop: '20px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
            {errorMessage}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="animate-fade">
      <audio ref={audioRef} src="https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3" />

      <header className="header">
        <div className="logo">
          <Pill className="w-6 h-6" />
          <span>ERGO</span>MEDI
        </div>
        <div onClick={() => setActiveTab('profile')} style={{ cursor: 'pointer', background: 'var(--bg-card)', padding: '8px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
           <User size={18} />
           <span style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase' }}>
             {user.identifier.includes('@') ? user.identifier.split('@')[0] : 'MI PERFIL'}
           </span>
        </div>
      </header>

      <main className="main-container">
        {activeTab === 'dashboard' ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
               <h2 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Dashboard</h2>
               <div style={{ background: 'var(--primary-dim)', color: 'var(--primary-light)', padding: '6px 12px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 800 }}>
                 {meds.length} PLANES
               </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '32px' }}>
               <div className="card" style={{ margin: 0, padding: '20px', textAlign: 'center' }}>
                  <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 800 }}>PROGRESO TOTAL</p>
                  <p style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--primary-light)' }}>
                    {meds.length ? Math.round(meds.reduce((acc, m) => acc + (m.dosesTaken || 0), 0) / meds.reduce((acc, m) => acc + ((m.durationDays || 1) * (m.timesPerDay || 1)), 0) * 100) : 0}%
                  </p>
               </div>
               <div className="card" style={{ margin: 0, padding: '20px', textAlign: 'center' }}>
                  <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 800 }}>TOMAS HOY</p>
                  <p style={{ fontSize: '1.8rem', fontWeight: 900 }}>
                    {meds.reduce((acc, m) => acc + (m.lastResetDate === new Date().toISOString().split('T')[0] ? (m.takenTodayCount || 0) : 0), 0)}
                  </p>
               </div>
            </div>

            <button onClick={() => exportPDF()} className="btn-primary" style={{ marginBottom: '24px' }}>
              <FileText size={18} /> Descargar Reporte Maestro (PDF)
            </button>

            {meds.length === 0 && !loading && (
              <div className="card" style={{ textAlign: 'center', padding: '40px', border: '2px dashed var(--border)', background: 'transparent' }}>
                <Pill size={40} style={{ color: 'var(--text-muted)', margin: '0 auto 16px', opacity: 0.5 }} />
                <p style={{ color: 'var(--text-muted)', fontWeight: 700 }}>No tienes planes activos.</p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Usa el botón + para agregar uno.</p>
              </div>
            )}

            {meds.map(med => {
              const totalNeeded = (med.durationDays || 0) * (med.timesPerDay || 1);
              const progress = Math.min(100, Math.round(((med.dosesTaken || 0) / (totalNeeded || 1)) * 100));
              const isDoneToday = (med.lastResetDate === new Date().toISOString().split('T')[0] ? (med.takenTodayCount || 0) : 0) >= (med.timesPerDay || 1);

              return (
                <div key={med.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <h3 style={{ fontWeight: 800 }}>{med.name}</h3>
                    <div style={{ display: 'flex', gap: '12px' }}>
                       <Share2 size={16} onClick={() => shareToWhatsApp(med.name, progress)} style={{ cursor: 'pointer' }} />
                       <Download size={16} onClick={() => exportPDF(med)} style={{ cursor: 'pointer' }} />
                       <Pencil size={16} onClick={() => openEditModal(med)} style={{ cursor: 'pointer' }} />
                    </div>
                  </div>
                  <div className="progress-container">
                    <div className="progress-bar" style={{ width: `${progress}%` }}></div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-muted)' }}>
                    <span>{progress}% COMPLETADO</span>
                    <span>{med.dosesTaken} / {totalNeeded}</span>
                  </div>
                  <button 
                    disabled={isDoneToday} 
                    onClick={() => markAsTaken(med)} 
                    className="btn-primary" 
                    style={{ marginTop: '16px', background: isDoneToday ? 'var(--bg-card)' : 'var(--primary)', color: isDoneToday ? 'var(--primary-light)' : 'white' }}
                  >
                    {isDoneToday ? 'META DIARIA CUMPLIDA' : `CONFIRMAR TOMA (${(med.lastResetDate === new Date().toISOString().split('T')[0] ? (med.takenTodayCount || 0) : 0) + 1}/${med.timesPerDay})`}
                  </button>
                </div>
              );
            })}
          </>
        ) : activeTab === 'historial' ? (
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '24px' }}>Historial</h2>
            {historyLogs.length === 0 && (
               <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '40px' }}>No hay registros aún.</p>
            )}
            {historyLogs.map(log => (
              <div key={log.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', padding: '16px' }}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <CheckCircle2 size={20} style={{ color: 'var(--primary-light)' }} />
                  <div>
                    <h4 style={{ fontWeight: 700, fontSize: '0.9rem' }}>{log.medName}</h4>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{log.dosage}</p>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontWeight: 700, fontSize: '0.8rem' }}>{new Date(log.timestamp).toLocaleTimeString()}</p>
                  <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{new Date(log.timestamp).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="animate-fade" style={{ textAlign: 'center' }}>
            <div className="card" style={{ padding: '40px' }}>
               <div style={{ width: '80px', height: '80px', background: 'var(--primary-dim)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                  <User size={40} style={{ color: 'var(--primary-light)' }} />
               </div>
               <h3 style={{ fontWeight: 800 }}>{user.identifier}</h3>
               <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '32px' }}>ID: {user.id}</p>
               
               <button onClick={handleLogout} className="btn-primary" style={{ background: '#ef4444', marginBottom: '12px' }}>
                 <LogOut size={18} /> Cerrar Sesión
               </button>
            </div>
          </div>
        )}
      </main>

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)', zIndex: 2000, display: 'flex', alignItems: 'flex-end' }}>
          <div className="animate-fade" style={{ background: 'var(--bg-modal)', width: '100%', borderTopLeftRadius: '40px', borderTopRightRadius: '40px', padding: '32px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
              <h3 style={{ fontWeight: 800 }}>{editingId ? 'EDITAR PLAN' : 'NUEVO PLAN'}</h3>
              <X onClick={closeModal} />
            </div>
            <form onSubmit={handleSaveMed}>
              <div className="input-group">
                <label>Medicamento</label>
                <input type="text" className="input-field" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>
              <div className="input-group">
                <label>Receta Médica (Subir a Drive)</label>
                <div style={{ position: 'relative', height: '120px', background: 'var(--bg-card)', borderRadius: '16px', border: '2px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                   {formData.prescriptionUrl ? <img src={formData.prescriptionUrl.replace('open?', 'uc?export=view&')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ textAlign: 'center' }}><ImageIcon size={24} style={{ color: 'var(--text-muted)', marginBottom: '4px' }} /><p style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>CLIC PARA SUBIR</p></div>}
                   <input type="file" accept="image/*" onChange={handleFileUpload} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="input-group"><label>Dosis</label><input type="text" className="input-field" value={formData.dosage} onChange={e => setFormData({...formData, dosage: e.target.value})} /></div>
                <div className="input-group"><label>Días</label><input type="number" className="input-field" value={formData.durationDays} onChange={e => setFormData({...formData, durationDays: parseInt(e.target.value) || 1})} /></div>
              </div>
              <div className="input-group">
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><label>Frecuencia Diaria</label><span style={{ color: 'var(--primary-light)', fontWeight: 800 }}>{formData.timesPerDay}</span></div>
                <input type="range" min="1" max="8" style={{ width: '100%' }} value={formData.timesPerDay} onChange={e => handleFrequencyChange(e.target.value)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
                {formData.times.map((t, i) => (
                  <input key={i} type="time" className="input-field" value={t} onChange={e => {
                    const nt = [...formData.times]; nt[i] = e.target.value; setFormData({...formData, times: nt});
                  }} />
                ))}
              </div>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? <RefreshCw className="animate-spin" /> : 'Sincronizar con Google Sheets'}
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="fab" onClick={() => setShowModal(true)}><Plus size={32} /></div>

      <nav className="nav-bottom">
        <div className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}><Activity size={24} /><span>Dashboard</span></div>
        <div className={`nav-item ${activeTab === 'historial' ? 'active' : ''}`} onClick={() => setActiveTab('historial')}><History size={24} /><span>Log</span></div>
        <div className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveTab('profile')}><Settings size={24} /><span>Ajustes</span></div>
      </nav>
    </div>
  );
}
