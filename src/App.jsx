import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, Bell, CheckCircle2, Trash2, Clock, Pill, 
  Calendar, AlertCircle, Settings, X, Save, FileText, 
  Pencil, RotateCcw, History, Activity, Download, RefreshCw,
  ChevronRight, Volume2, VolumeX, LogOut, User, Image as ImageIcon,
  Send, Share2, Phone, Mail, ArrowRight, UserPlus, Shield,
  Globe, Check, Menu, ChevronLeft, Users, Filter, TrendingUp
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { api } from './api';
import { setupNotifications, shareToWhatsApp, testWhatsApp } from './notifications';

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

const getDoctorsList = (doctorNameField) => {
  if (!doctorNameField) return [];
  try {
    const parsed = JSON.parse(doctorNameField);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    // Fallback if not JSON
  }
  return [{ id: 'default', name: doctorNameField, phone: '', email: '' }];
};

const getDisplayDoctorName = (doctorNameField) => {
  const list = getDoctorsList(doctorNameField);
  if (list.length === 0) return '(Configurar en Ajustes)';
  return list.map(d => d.name).join(', ');
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
  const [selectedPathology, setSelectedPathology] = useState('All');
  const [selectedDoctor, setSelectedDoctor] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarExpanded, setSidebarExpanded] = useState(() => {
    const saved = localStorage.getItem('sidebar_expanded');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // ── Multi-Paciente: estados de admin ─────────────────────────────────
  // patientList: lista de todos los pacientes (solo visible para admin)
  // viewingUserId: ID del paciente cuya data se muestra ahora mismo
  // viewingProfile: perfil del paciente visto (null = propio perfil)
  const [patientList, setPatientList] = useState([]);
  const [viewingUserId, setViewingUserId] = useState(null); // null = propio
  const [viewingProfile, setViewingProfile] = useState(null);
  const [showCreatePatientModal, setShowCreatePatientModal] = useState(false);
  const [createPatientForm, setCreatePatientForm] = useState({ identifier: '', patientName: '', role: 'user' });
  const [createPatientLoading, setCreatePatientLoading] = useState(false);
  const [createPatientError, setCreatePatientError] = useState('');

  // Helper: userId efectivo para operaciones de datos
  const effectiveUserId = viewingUserId || user?.id;
  const isViewingOtherPatient = viewingUserId && user && viewingUserId !== user.id;
  // Perfil activo: propio o del paciente visto
  const activeProfile = isViewingOtherPatient ? (viewingProfile || {}) : (user || {});

  // States for Treating Doctors (Médicos Tratantes)
  const [showDoctorForm, setShowDoctorForm] = useState(false);
  const [doctorForm, setDoctorForm] = useState({ id: '', name: '', phone: '', email: '' });
  const [doctorEditId, setDoctorEditId] = useState(null);
  const [showCustomDoctorInput, setShowCustomDoctorInput] = useState(false);

  const toggleSidebar = () => {
    const nextVal = !sidebarExpanded;
    setSidebarExpanded(nextVal);
    localStorage.setItem('sidebar_expanded', JSON.stringify(nextVal));
  };

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
    prescriptionUrl: '',
    doctorName: '',
    pathology: ''
  };
  const [formData, setFormData] = useState(initialFormState);

  // Modals de historial
  const [showEditHistoryModal, setShowEditHistoryModal] = useState(false);
  const [editingHistoryLog, setEditingHistoryLog] = useState(null);
  const [editHistoryDate, setEditHistoryDate] = useState("");
  const [editHistoryTime, setEditHistoryTime] = useState("");

  const [showManualLogModal, setShowManualLogModal] = useState(false);
  const [manualLogMedId, setManualLogMedId] = useState("");
  const [manualLogDate, setManualLogDate] = useState(new Date().toISOString().split('T')[0]);
  const [manualLogTime, setManualLogTime] = useState("");

  useEffect(() => {
    if (user?.id) {
      // Inicializar viewingUserId al propio usuario si no está seteado
      if (!viewingUserId) setViewingUserId(user.id);
      fetchData(user.id, viewingUserId || user.id, true);
      // Cargar lista de pacientes si es admin
      if (user.role === 'admin') {
        api.getUsers(user.id).then(list => {
          if (Array.isArray(list)) setPatientList(list);
        }).catch(() => {});
      }
      // Auto-TimeZone Sync
      const currentOffset = -new Date().getTimezoneOffset();
      if (user.utcOffset !== currentOffset) {
        updateProfile({ utcOffset: currentOffset }, true);
      }
    }
    else setLoading(false);
  }, [user?.id]);

  // Local-timezone date helper — avoids UTC offset bugs (e.g. UTC-4 users after 8pm)
  const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const groupHistoryLogs = (logs) => {
    const todayStr = localToday();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    // Inline robust date normalizer to handle both ISO and standard Sheets formatting
    const normalizeHistoryDate = (dateVal, timestampVal) => {
      // 1. If dateVal or timestampVal is a full ISO timestamp string, parse it using Date
      const isoStr = (dateVal && typeof dateVal === 'string' && dateVal.includes('T')) ? dateVal :
                      (timestampVal && typeof timestampVal === 'string' && timestampVal.includes('T')) ? timestampVal : null;
      if (isoStr) {
        const d = new Date(isoStr);
        if (!isNaN(d)) {
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
      }

      // 2. Already plain date string "YYYY-MM-DD"
      if (dateVal && /^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
        return dateVal;
      }

      // 3. Parsable non-standard date string in dateVal
      if (dateVal && typeof dateVal === 'string') {
        const parts = dateVal.split(/[-/]/);
        if (parts.length === 3) {
          if (parts[0].length <= 2 && parts[2].length === 4) {
            return `${parts[2]}-${String(parts[1]).padStart(2, '0')}-${String(parts[0]).padStart(2, '0')}`;
          }
          if (parts[0].length === 4) {
            return `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2].split('T')[0]).padStart(2, '0')}`;
          }
        }
      }

      // 4. Fallback parser for timestampVal
      if (timestampVal) {
        const d = new Date(timestampVal);
        if (!isNaN(d)) {
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
        if (typeof timestampVal === 'string') {
          const parts = timestampVal.split(' ')[0].split(/[-/]/);
          if (parts.length === 3) {
            if (parts[0].length <= 2 && parts[2].length === 4) {
              return `${parts[2]}-${String(parts[1]).padStart(2, '0')}-${String(parts[0]).padStart(2, '0')}`;
            }
            if (parts[0].length === 4) {
              return `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
            }
          }
        }
      }
      return todayStr;
    };

    const groups = {};
    (logs || []).forEach(log => {
      let dateKey = normalizeHistoryDate(log.date, log.timestamp);
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(log);
    });

    return Object.keys(groups)
      .sort((a, b) => b.localeCompare(a))
      .map(dateKey => {
        let label = "";
        if (dateKey === todayStr) {
          label = "HOY";
        } else if (dateKey === yesterdayStr) {
          label = "AYER";
        } else {
          const [yr, mo, dy] = dateKey.split('-').map(Number);
          const d = new Date(yr, mo - 1, dy);
          label = isNaN(d) ? dateKey : d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
        }
        return {
          dateKey,
          label,
          logs: groups[dateKey].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        };
      });
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
        fetchData(user.id, viewingUserId || user.id);
        scheduleReset();
      }, msUntilMidnight);
    };
    const t = scheduleReset();
    return () => clearTimeout(t);
  }, [user?.id, viewingUserId]);

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

  // Auto-setup notifications when meds or settings change for the logged-in user
  useEffect(() => {
    if (user && (!viewingUserId || viewingUserId === user.id)) {
      const activePlansForNotifications = meds.filter(m => {
        const totalNeeded = (m.durationDays || 0) * (m.timesPerDay || 1);
        return (m.dosesTaken || 0) < totalNeeded;
      });
      setupNotifications(activePlansForNotifications, {
        phone:    user.phone    || '',
        waApiKey: user.waApiKey || '',
      });
    }
  }, [meds, user?.phone, user?.waApiKey, viewingUserId, user?.id]);

  const handleInstallPWA = async () => {
    if (!installPromptEvent) return;
    await installPromptEvent.prompt();
    const { outcome } = await installPromptEvent.userChoice;
    if (outcome === 'accepted') {
      setShowInstallBanner(false);
      setInstallPromptEvent(null);
    }
  };

  const fetchData = async (uid, targetUid = null, showLoading = false) => {
    const effectiveTarget = targetUid || uid;
    if (showLoading) setLoading(true);
    else setBackgroundSyncing(true);
    
    try {
      const passTarget = effectiveTarget !== uid ? effectiveTarget : null;
      const [medsList, historyList] = await Promise.all([
        api.getMeds(uid, passTarget),
        api.getHistory(uid, passTarget)
      ]);

      // Deduplicate by id — keep the last occurrence (highest dosesTaken wins)
      // Layer 1: deduplicate by id
      const byId = (medsList || []).reduce((acc, m) => {
        const key = String(m.id);
        if (!acc[key] || (m.dosesTaken || 0) >= (acc[key].dosesTaken || 0)) acc[key] = m;
        return acc;
      }, {});

      // Layer 2: deduplicate by name+dosage+doctorName+pathology — catches rows with DIFFERENT ids that are the same plan
      const byName = Object.values(byId).reduce((acc, m) => {
        const key = `${String(m.name).trim().toLowerCase()}|${String(m.dosage).trim().toLowerCase()}|${String(m.doctorName || '').trim().toLowerCase()}|${String(m.pathology || '').trim().toLowerCase()}`;
        if (!acc[key] || (m.dosesTaken || 0) >= (acc[key].dosesTaken || 0)) acc[key] = m;
        return acc;
      }, {});

      const deduped = Object.values(byName);

      setMeds(deduped);
      setHistoryLogs(historyList || []);
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

    const passTarget = isViewingOtherPatient ? effectiveUserId : null;
    try {
      await api.saveMed(dataToSave, user.id, passTarget);
      fetchData(user.id, effectiveUserId);
    } catch (err) {
      setMeds(oldMeds);
      setErrorMessage("Error al sincronizar con la nube.");
    }
  };

  const deleteMed = async (id) => {
    if (!window.confirm("¿Eliminar este plan permanentemente? Esta acción no se puede deshacer.")) return;
    const oldMeds = [...meds];
    setMeds(meds.filter(m => m.id !== id)); // Optimistic remove
    const passTarget = isViewingOtherPatient ? effectiveUserId : null;
    try {
      await api.deleteMed(id, user.id, passTarget);
      fetchData(user.id, effectiveUserId);
    } catch (err) {
      setMeds(oldMeds);
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

  const markAsTaken = async (med, customTimeStr = null) => {
    if (!user) return;
    const today = localToday(); // local date, not UTC
    let timestamp = new Date().toISOString();
    
    if (customTimeStr) {
      // Create a local timestamp today at that custom time
      const [h, m] = customTimeStr.split(':').map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      timestamp = d.toISOString();
    }
    
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

    const passTarget = isViewingOtherPatient ? effectiveUserId : null;
    try {
      await api.logHistory({ 
        medId: med.id, 
        medName: med.name, 
        dosage: med.dosage, 
        timestamp, 
        date: today 
      }, user.id, passTarget);
      await api.saveMed(updatedMed, user.id, passTarget);
      fetchData(user.id, effectiveUserId);
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

    const passTarget = isViewingOtherPatient ? effectiveUserId : null;
    try {
      await api.saveMed(updatedMed, user.id, passTarget);
      fetchData(user.id, effectiveUserId);
    } catch (err) {
      console.error('Error undoing dose:', err);
    }
  };

  const handleChipClick = (med, timeStr, index, isTaken, isCompleted) => {
    if (isCompleted) return;
    if (isTaken) {
      // If clicking a taken chip, we allow undoing the last dose!
      // In a premium UX, we trigger the undo function which behaves cleanly.
      undoLastDose(med);
    } else {
      // Mark it as taken, logging it at the specific schedule time for today
      markAsTaken(med, timeStr);
    }
  };

  const updateProfile = async (profileData, silent = false, targetOverride = null) => {
    if (!user) return;
    const targetId = targetOverride || (isViewingOtherPatient ? effectiveUserId : null);
    if (!silent) setLoading(true);
    try {
      const res = await api.updateProfile(user.id, profileData, targetId);
      if (res.success) {
        if (targetId && targetId !== user.id) {
          // Update the viewingProfile and patientList entry
          setViewingProfile(prev => ({ ...prev, ...profileData }));
          setPatientList(prev => prev.map(p =>
            p.id === targetId ? { ...p, ...profileData } : p
          ));
        } else {
          const updatedUser = { ...user, ...profileData };
          setUser(updatedUser);
          localStorage.setItem('ergomedi_user', JSON.stringify(updatedUser));
        }
      }
    } catch (err) {
      if (!silent) setErrorMessage("Error al actualizar perfil.");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleSaveDoctor = async (e) => {
    e.preventDefault();
    if (!doctorForm.name.trim()) return;

    const currentDoctors = getDoctorsList(activeProfile.doctorName);
    let updatedDoctors;

    if (doctorEditId) {
      // Editing existing doctor
      updatedDoctors = currentDoctors.map(d => d.id === doctorEditId ? { ...doctorForm, id: doctorEditId } : d);
    } else {
      // Adding new doctor
      const newDoctor = {
        ...doctorForm,
        id: 'doc_' + Date.now()
      };
      updatedDoctors = [...currentDoctors, newDoctor];
    }

    const serialized = JSON.stringify(updatedDoctors);
    await updateProfile({ doctorName: serialized });

    // Reset form
    setDoctorForm({ id: '', name: '', phone: '', email: '' });
    setDoctorEditId(null);
    setShowDoctorForm(false);
  };

  const handleEditDoctor = (doc) => {
    setDoctorForm(doc);
    setDoctorEditId(doc.id);
    setShowDoctorForm(true);
  };

  const handleDeleteDoctor = async (docId) => {
    if (!window.confirm("¿Estás seguro de eliminar este médico tratante?")) return;
    const currentDoctors = getDoctorsList(activeProfile.doctorName);
    const updatedDoctors = currentDoctors.filter(d => d.id !== docId);
    const serialized = JSON.stringify(updatedDoctors);
    await updateProfile({ doctorName: serialized });
  };

  const handleCancelDoctor = () => {
    setDoctorForm({ id: '', name: '', phone: '', email: '' });
    setDoctorEditId(null);
    setShowDoctorForm(false);
  };

  const deleteHistoryLog = async (logId) => {
    if (!window.confirm("¿Estás seguro de eliminar este registro de toma? Esto recalculará las dosis tomadas del plan.")) return;
    setLoading(true);
    const passTarget = isViewingOtherPatient ? effectiveUserId : null;
    try {
      await api.deleteHistoryLog(logId, user.id, passTarget);
      await fetchData(user.id, effectiveUserId);
    } catch (err) {
      console.error(err);
      setErrorMessage("Error al eliminar la toma del historial.");
    } finally {
      setLoading(false);
    }
  };

  const openEditHistoryModal = (log) => {
    setEditingHistoryLog(log);
    setEditHistoryDate(log.date || log.timestamp.split('T')[0]);
    const d = new Date(log.timestamp);
    const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    setEditHistoryTime(timeStr);
    setShowEditHistoryModal(true);
  };

  const saveEditHistory = async (e) => {
    e.preventDefault();
    if (!editingHistoryLog || !editHistoryDate || !editHistoryTime) return;
    setLoading(true);
    const passTarget = isViewingOtherPatient ? effectiveUserId : null;
    try {
      const [yr, mo, dy] = editHistoryDate.split('-').map(Number);
      const [h, m] = editHistoryTime.split(':').map(Number);
      const newDate = new Date(yr, mo - 1, dy, h, m);
      const newTimestamp = newDate.toISOString();

      await api.editHistoryLog(editingHistoryLog.id, newTimestamp, editHistoryDate, user.id, passTarget);
      setShowEditHistoryModal(false);
      setEditingHistoryLog(null);
      await fetchData(user.id, effectiveUserId);
    } catch (err) {
      console.error(err);
      setErrorMessage("Error al guardar los cambios en la toma.");
    } finally {
      setLoading(false);
    }
  };

  const saveManualHistoryLog = async (e) => {
    e.preventDefault();
    if (!manualLogMedId || !manualLogDate || !manualLogTime) return;
    const med = meds.find(m => m.id === manualLogMedId);
    if (!med) return;
    setLoading(true);
    const passTarget = isViewingOtherPatient ? effectiveUserId : null;
    try {
      const [yr, mo, dy] = manualLogDate.split('-').map(Number);
      const [h, m] = manualLogTime.split(':').map(Number);
      const newDate = new Date(yr, mo - 1, dy, h, m);
      const newTimestamp = newDate.toISOString();

      const log = {
        medId: med.id,
        medName: med.name,
        dosage: med.dosage,
        timestamp: newTimestamp,
        date: manualLogDate
      };

      // Optimistic Update
      let newTakenToday = med.takenTodayCount || 0;
      let newLastReset = med.lastResetDate || '';
      if (manualLogDate === newLastReset) {
        newTakenToday += 1;
      } else if (manualLogDate > newLastReset) {
        newTakenToday = 1;
        newLastReset = manualLogDate;
      }
      
      const updatedMed = {
        ...med,
        dosesTaken: (med.dosesTaken || 0) + 1,
        takenTodayCount: newTakenToday,
        lastResetDate: newLastReset,
        lastTakenDate: manualLogDate >= newLastReset ? newTimestamp : med.lastTakenDate
      };
      setMeds(meds.map(m => m.id === med.id ? updatedMed : m));

      await api.addManualHistoryLog(log, user.id, passTarget);
      setShowManualLogModal(false);
      setManualLogMedId("");
      setManualLogTime("");
      await fetchData(user.id, effectiveUserId);
    } catch (err) {
      console.error(err);
      setErrorMessage("Error al registrar la toma manual.");
    } finally {
      setLoading(false);
    }
  };

  // ── Gestión de Pacientes (Admin) ──────────────────────────────────────
  /** Admin selecciona un paciente para ver sus datos */
  const handleSelectPatient = async (patientId) => {
    if (!user || user.role !== 'admin') return;
    setViewingUserId(patientId);
    const patient = patientList.find(p => p.id === patientId);
    setViewingProfile(patient || null);
    setLoading(true);
    const passTarget = patientId !== user.id ? patientId : null;
    try {
      const [medsList, historyList] = await Promise.all([
        api.getMeds(user.id, passTarget),
        api.getHistory(user.id, passTarget)
      ]);
      const byId = (medsList || []).reduce((acc, m) => {
        const key = String(m.id);
        if (!acc[key] || (m.dosesTaken || 0) >= (acc[key].dosesTaken || 0)) acc[key] = m;
        return acc;
      }, {});
      const byName = Object.values(byId).reduce((acc, m) => {
        const key = `${String(m.name).trim().toLowerCase()}|${String(m.dosage).trim().toLowerCase()}`;
        if (!acc[key] || (m.dosesTaken || 0) >= (acc[key].dosesTaken || 0)) acc[key] = m;
        return acc;
      }, {});
      setMeds(Object.values(byName));
      setHistoryLogs(historyList || []);
    } catch (err) {
      setErrorMessage('Error al cargar datos del paciente.');
    } finally {
      setLoading(false);
    }
  };

  /** Admin crea una nueva cuenta de paciente */
  const handleCreatePatient = async (e) => {
    e.preventDefault();
    if (!createPatientForm.identifier.trim()) return;
    setCreatePatientLoading(true);
    setCreatePatientError('');
    try {
      const res = await api.createPatient(
        user.id,
        createPatientForm.identifier.trim(),
        createPatientForm.patientName.trim(),
        createPatientForm.role
      );
      if (res.error) {
        setCreatePatientError(res.error);
      } else {
        // Refresh patient list
        const list = await api.getUsers(user.id);
        if (Array.isArray(list)) setPatientList(list);
        setShowCreatePatientModal(false);
        setCreatePatientForm({ identifier: '', patientName: '', role: 'user' });
      }
    } catch (err) {
      setCreatePatientError('Error de conexión. Inténtalo de nuevo.');
    } finally {
      setCreatePatientLoading(false);
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
    
    const HEADER_H   = 38; // main header height
    const LOGO_X     = 10;
    const LOGO_Y     = 6;
    const LOGO_SZ    = 20; // logo size

    // ── MAIN HEADER BAND ──────────────────────────────────────────
    docPdf.setFillColor(...TEAL);
    docPdf.rect(0, 0, pageW, HEADER_H, 'F');

    // Logo image
    if (logoDataUrl) {
      docPdf.addImage(logoDataUrl, 'PNG', LOGO_X, LOGO_Y, LOGO_SZ, LOGO_SZ);
    }

    // "ERGOMEDI-TRACKER" label below logo
    docPdf.setFontSize(10);
    docPdf.setTextColor(...WHITE);
    docPdf.setFont(undefined, 'bold');
    docPdf.text('ERGOMEDI-TRACKER', LOGO_X, LOGO_Y + LOGO_SZ + 6);

    // ── RIGHT COLUMN: company info ────────────────────────────────
    // Company name
    docPdf.setFontSize(10);
    docPdf.setFont(undefined, 'bold');
    docPdf.text('ERGOEXPRESS, C.A.', pageW - 12, 11, { align: 'right' });

    // RIF / address / contact
    docPdf.setFontSize(7.5);
    docPdf.setFont(undefined, 'normal');
    docPdf.text('RIF: J-502512462  |  San Joaquín, Carabobo, Venezuela', pageW - 12, 16, { align: 'right' });
    docPdf.text('Teléfono: +58 424-4736489  |  Correo: ergoexpressinfo@gmail.com', pageW - 12, 21, { align: 'right' });

    // Patient
    const patientName = activeProfile?.patientName || user?.patientName || '(Configurar en Ajustes)';
    
    docPdf.setFontSize(8);
    
    // 1. Paciente
    docPdf.setFont(undefined, 'bold');
    const patientWidth = docPdf.getTextWidth(patientName);
    docPdf.text(patientName, pageW - 12, 29, { align: 'right' });
    
    docPdf.setFont(undefined, 'normal');
    docPdf.text('Paciente: ', pageW - 12 - patientWidth, 29, { align: 'right' });

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
    const targetMeds = specificMed ? [specificMed] : filteredMeds;
    const body = targetMeds.map(m => [
      m.name.toUpperCase(),
      m.pathology ? m.pathology.toUpperCase() : 'NO ESP.',
      m.doctorName ? m.doctorName.toUpperCase() : 'NO ESP.',
      m.dosage || 'N/A',
      `${m.timesPerDay} ${m.timesPerDay === 1 ? 'toma' : 'tomas'}/día • ${m.durationDays} ${m.durationDays === 1 ? 'día' : 'días'}`,
      Array.isArray(m.times) ? m.times.join(', ') : (m.times || 'N/A'),
      `${Math.round(((m.dosesTaken || 0) / ((m.durationDays || 1) * (m.timesPerDay || 1))) * 100)}%\n `
    ]);
    docPdf.autoTable({
      startY: BAND_Y + 14,
      margin: { left: 10, right: 10 },
      head: [['MEDICAMENTO', 'PATOLOGÍA', 'MÉDICO', 'DOSIS', 'FREC. / DÍAS', 'HORARIOS', 'PROGRESO']],
      body,
      headStyles: { fillColor: TEAL, fontStyle: 'bold', textColor: 255, fontSize: 6.2, valign: 'middle' },
      styles: { fontSize: 6.8, cellPadding: 1.8 },
      alternateRowStyles: { fillColor: [240, 250, 250] },
      columnStyles: {
        0: { cellWidth: 32 }, // MEDICAMENTO
        1: { cellWidth: 28 }, // PATOLOGÍA
        2: { cellWidth: 26 }, // MÉDICO
        3: { cellWidth: 15 }, // DOSIS
        4: { cellWidth: 32 }, // FREC. / DÍAS
        5: { cellWidth: 32 }, // HORARIOS
        6: { cellWidth: 25, halign: 'center', valign: 'top', fontStyle: 'bold' } // PROGRESO
      },
      didDrawCell: (data) => {
        if (data.section === 'body' && data.column.index === 6) {
          const rawText = data.cell.text[0] || '0%';
          const textContent = rawText.split('\n')[0] || '0%';
          const percent = Math.min(100, Math.max(0, parseInt(textContent.replace('%', ''), 10) || 0));
          
          const { x, y, width, height } = data.cell;
          
          // Configuracion de la barra
          const barWidth = width - 8; // Dejar margen a los lados
          const barHeight = 2.2; 
          const barX = x + 4;
          const barY = y + height - 3.8; // Colocar en la parte inferior de la celda
          
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
    
    const doctors = getDoctorsList(user?.doctorName);
    const isPreset = doctors.some(d => d.name === med.doctorName);
    setShowCustomDoctorInput(!isPreset && med.doctorName !== '');
    setShowModal(true);
  };

  const closeModal = () => { 
    setShowModal(false); 
    setEditingId(null); 
    setFormData(initialFormState); 
    setShowCustomDoctorInput(false);
    setErrorMessage(""); 
  };  const handleProfileFieldChange = (field, value) => {
    if (isViewingOtherPatient) {
      setViewingProfile(prev => ({ ...prev, [field]: value }));
    } else {
      setUser(prev => {
        const updated = { ...prev, [field]: value };
        localStorage.setItem('ergomedi_user', JSON.stringify(updated));
        return updated;
      });
    }
  };


  const openNewPlanModal = () => {
    setEditingId(null);
    const doctors = getDoctorsList(user?.doctorName);
    const defaultDoctorName = doctors.length > 0 ? doctors[0].name : '';
    setFormData({
      ...initialFormState,
      doctorName: defaultDoctorName
    });
    setShowCustomDoctorInput(doctors.length === 0);
    setShowModal(true);
  };

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


  const uniquePathologies = Array.from(new Set((meds || []).map(m => (m.pathology || '').trim()).filter(Boolean)));
  const uniqueDoctors = Array.from(new Set((meds || []).map(m => (m.doctorName || '').trim()).filter(Boolean)));

  const filteredMeds = (meds || []).filter(m => {
    const matchPathology = selectedPathology === 'All' || (m.pathology || '').trim().toLowerCase() === selectedPathology.trim().toLowerCase();
    const matchDoctor = selectedDoctor === 'All' || (m.doctorName || '').trim().toLowerCase() === selectedDoctor.trim().toLowerCase();
    const totalNeeded = (m.durationDays || 0) * (m.timesPerDay || 1);
    const isCompleted = (m.dosesTaken || 0) >= totalNeeded;
    const matchStatus = selectedStatus === 'All' || (selectedStatus === 'completed' && isCompleted) || (selectedStatus === 'active' && !isCompleted);
    return matchPathology && matchDoctor && matchStatus;
  });

  // Pre-compute global stats for dashboard
  const statsAll = (meds || []).reduce((acc, m) => {
    const total = (m.durationDays || 0) * (m.timesPerDay || 1);
    const done = m.dosesTaken || 0;
    const completed = done >= total;
    acc.total++;
    acc.active += completed ? 0 : 1;
    acc.completed += completed ? 1 : 0;
    acc.dosesDone += done;
    acc.dosesNeeded += total;
    acc.takenToday += (m.lastResetDate === localToday() ? (m.takenTodayCount || 0) : 0);
    return acc;
  }, { total: 0, active: 0, completed: 0, dosesDone: 0, dosesNeeded: 0, takenToday: 0 });

  return (
    <div className="animate-fade app-layout">
      <audio ref={audioRef} src="https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3" />

      {/* MOBILE SIDEBAR OVERLAY */}
      <div 
        className={`sidebar-overlay ${mobileSidebarOpen ? 'visible' : ''}`}
        onClick={() => setMobileSidebarOpen(false)}
      />

      {/* COLLAPSIBLE SIDEBAR */}
      <aside className={`sidebar ${sidebarExpanded ? 'expanded' : 'collapsed'} ${mobileSidebarOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-logo">
          <img src="/logo.png" alt="ERGOMEDI-TRACKER" style={{ height: '36px', width: '36px', objectFit: 'contain', filter: 'drop-shadow(0 0 8px rgba(15,224,224,0.5))' }} />
          {sidebarExpanded && (
            <span className="sidebar-logo-text">
              <span style={{ color: 'var(--primary-light)' }}>ERGO</span>MEDI
              <span style={{ fontSize: '0.7rem', opacity: 0.6, marginLeft: '4px' }}>TRACKER</span>
            </span>
          )}
        </div>

        <nav className="sidebar-menu">
          <div 
            className={`sidebar-menu-item ${activeTab === 'dashboard' ? 'active' : ''}`} 
            onClick={() => { setActiveTab('dashboard'); setMobileSidebarOpen(false); }}
            title="Dashboard"
          >
            <Activity size={20} />
            {sidebarExpanded && <span className="sidebar-menu-text">Dashboard</span>}
          </div>
          <div 
            className={`sidebar-menu-item ${activeTab === 'historial' ? 'active' : ''}`} 
            onClick={() => { setActiveTab('historial'); setMobileSidebarOpen(false); }}
            title="Historial"
          >
            <History size={20} />
            {sidebarExpanded && <span className="sidebar-menu-text">Historial</span>}
          </div>
          <div 
            className={`sidebar-menu-item ${activeTab === 'profile' ? 'active' : ''}`} 
            onClick={() => { setActiveTab('profile'); setMobileSidebarOpen(false); }}
            title="Ajustes"
          >
            <Settings size={20} />
            {sidebarExpanded && <span className="sidebar-menu-text">Ajustes</span>}
          </div>
        </nav>

        <div className="sidebar-footer">
          {/* Collapse/Expand toggle on desktop */}
          <button className="sidebar-toggle-btn" onClick={toggleSidebar}>
            {sidebarExpanded ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ChevronLeft size={18} />
                <span style={{ fontSize: '0.7rem', fontWeight: 900 }}>COLAPSAR</span>
              </div>
            ) : (
              <ChevronRight size={18} />
            )}
          </button>
          
          {/* Logout button in sidebar footer */}
          <div 
            className="sidebar-menu-item" 
            onClick={() => {
              if (window.confirm("¿Seguro que deseas salir del sistema?")) {
                localStorage.removeItem('ergomedi_user');
                setUser(null);
              }
            }}
            title="Cerrar Sesión"
            style={{ color: '#ef4444' }}
          >
            <LogOut size={20} />
            {sidebarExpanded && <span className="sidebar-menu-text" style={{ color: '#ef4444' }}>SALIR</span>}
          </div>
        </div>
      </aside>

      {/* MAIN CONTAINER */}
      <div className={`main-content ${sidebarExpanded ? 'sidebar-expanded' : 'sidebar-collapsed'}`}>
        <header className="header">
          {/* Hamburger Menu on Mobile */}
          <button className="hamburger-btn" onClick={() => setMobileSidebarOpen(true)}>
            <Menu size={24} />
          </button>

          <div className="logo" style={{ fontSize: '1.2rem', gap: '10px' }}>
            {/* Show logo only if mobile or if sidebar is collapsed on desktop */}
            {(!sidebarExpanded || mobileSidebarOpen) && (
              <>
                <img src="/logo.png" alt="ERGOMEDI-TRACKER" style={{ height: '32px', width: '32px', objectFit: 'contain', filter: 'drop-shadow(0 0 8px rgba(15,224,224,0.5))' }} />
                <span style={{ fontWeight: 900, letterSpacing: '-0.5px' }}>
                  <span style={{ color: 'var(--primary-light)' }}>ERGO</span>MEDI
                </span>
              </>
            )}
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {backgroundSyncing && <RefreshCw size={14} className="animate-spin" style={{ color: 'var(--primary-light)' }} />}
            
            {user.role === 'admin' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Users size={16} style={{ color: 'var(--primary-light)' }} />
                <select
                  value={viewingUserId || user.id}
                  onChange={(e) => {
                    if (e.target.value === 'create_patient_trigger') {
                      setShowCreatePatientModal(true);
                    } else {
                      handleSelectPatient(e.target.value);
                    }
                  }}
                  style={{
                    background: 'var(--primary-dim)',
                    color: 'var(--primary-light)',
                    border: '1px solid var(--primary-light)',
                    borderRadius: '12px',
                    padding: '6px 12px',
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    outline: 'none',
                    cursor: 'pointer',
                    maxWidth: '180px',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <option value={user.id}>🌟 MI REGISTRO (ADMIN)</option>
                  <optgroup label="Pacientes Registrados">
                    {patientList.map(p => (
                      p.id !== user.id && (
                        <option key={p.id} value={p.id}>
                          👤 {p.patientName || p.identifier.split('@')[0]} ({p.identifier})
                        </option>
                      )
                    ))}
                  </optgroup>
                  <option value="create_patient_trigger">➕ REGISTRAR PACIENTE...</option>
                </select>
              </div>
            )}

            <div onClick={() => setActiveTab('profile')} style={{ cursor: 'pointer', background: 'var(--primary-dim)', padding: '6px 12px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid var(--primary-light)' }}>
               <User size={16} style={{ color: 'var(--primary-light)' }} />
               <span style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--primary-light)', textTransform: 'uppercase' }}>
                 {user.role === 'admin' ? 'SUPER USUARIO' : user.identifier.split('@')[0]}
               </span>
            </div>
          </div>
        </header>

        <main className="main-content-scroll" style={{ width: '100%', flex: 1, padding: '20px', paddingBottom: '120px', maxWidth: '1200px', margin: '0 auto' }}>
          {isViewingOtherPatient && (
            <div style={{
              background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.15) 100%)',
              border: '1px solid rgba(245, 158, 11, 0.4)',
              borderRadius: '16px',
              padding: '12px 20px',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
              boxShadow: '0 4px 15px rgba(245, 158, 11, 0.1)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Users size={18} style={{ color: '#f59e0b', flexShrink: 0 }} />
                <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 800, color: '#f59e0b' }}>
                  VIENDO REGISTRO DE: <span style={{ textDecoration: 'underline', color: 'white', fontWeight: 900 }}>{activeProfile.patientName || activeProfile.identifier.split('@')[0]}</span> ({activeProfile.identifier})
                </p>
              </div>
              <button
                onClick={() => handleSelectPatient(user.id)}
                style={{
                  background: '#f59e0b',
                  color: 'black',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '6px 12px',
                  fontSize: '0.7rem',
                  fontWeight: 900,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: '0 2px 8px rgba(245, 158, 11, 0.3)'
                }}
              >
                VOLVER A MI REGISTRO
              </button>
            </div>
          )}

          {activeTab === 'dashboard' ? (
            <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
               <h2 style={{ fontSize: '1.6rem', fontWeight: 900, letterSpacing: '-0.5px' }}>DASHBOARD</h2>
               <div style={{ background: 'var(--primary-dim)', color: 'var(--primary-light)', padding: '6px 14px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 900, border: '1px solid var(--primary-light)' }}>
                 {filteredMeds.length} / {meds.length} PLANES
               </div>
            </div>

            {/* ── Filtros Premium + Status Chips ── */}
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column',
              gap: '14px', 
              marginBottom: '24px', 
              background: 'var(--bg-card)', 
              padding: '18px 20px', 
              borderRadius: '20px', 
              border: '1px solid var(--border)',
            }}>
              {/* Status filter chips */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <Filter size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <span style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginRight: '4px' }}>Estado:</span>
                {[
                  { key: 'All', label: 'Todos', count: statsAll.total, icon: <Activity size={13} />, color: 'var(--primary-light)' },
                  { key: 'active', label: 'En Progreso', count: statsAll.active, icon: <Clock size={13} />, color: '#f59e0b' },
                  { key: 'completed', label: 'Culminados', count: statsAll.completed, icon: <CheckCircle2 size={13} />, color: '#10b981' },
                ].map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => setSelectedStatus(opt.key)}
                    className={`status-chip ${selectedStatus === opt.key ? 'active' : ''}`}
                    style={selectedStatus === opt.key ? { '--chip-color': opt.color } : {}}
                  >
                    {opt.icon}
                    <span>{opt.label}</span>
                    <span className="status-chip-count">{opt.count}</span>
                  </button>
                ))}
              </div>

              {/* Pathology + Doctor dropdowns */}
              {(uniquePathologies.length > 0 || uniqueDoctors.length > 0) && (
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {uniquePathologies.length > 0 && (
                    <select 
                      value={selectedPathology} 
                      onChange={e => setSelectedPathology(e.target.value)}
                      style={{ 
                        background: 'var(--bg-dark)', 
                        color: 'white', 
                        border: '1px solid var(--border)', 
                        borderRadius: '10px', 
                        padding: '8px 12px', 
                        fontSize: '0.75rem', 
                        fontWeight: 700, 
                        outline: 'none',
                        cursor: 'pointer',
                        flex: 1,
                        minWidth: '160px'
                      }}
                    >
                      <option value="All">Todas las Patologías</option>
                      {uniquePathologies.map(p => (
                        <option key={p} value={p}>{p.toUpperCase()}</option>
                      ))}
                    </select>
                  )}
                  {uniqueDoctors.length > 0 && (
                    <select 
                      value={selectedDoctor} 
                      onChange={e => setSelectedDoctor(e.target.value)}
                      style={{ 
                        background: 'var(--bg-dark)', 
                        color: 'white', 
                        border: '1px solid var(--border)', 
                        borderRadius: '10px', 
                        padding: '8px 12px', 
                        fontSize: '0.75rem', 
                        fontWeight: 700, 
                        outline: 'none',
                        cursor: 'pointer',
                        flex: 1,
                        minWidth: '160px'
                      }}
                    >
                      <option value="All">Todos los Médicos</option>
                      {uniqueDoctors.map(d => (
                        <option key={d} value={d}>{d.toUpperCase()}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>

            {/* ── Dashboard Stats Grid — 4 tarjetas ── */}
            <div className="dashboard-stats-grid">
               <div className="card dashboard-stat-card" style={{ margin: 0, background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--primary-dim) 100%)' }}>
                  <div className="dashboard-stat-icon" style={{ background: 'var(--primary-dim)' }}>
                    <TrendingUp size={22} style={{ color: 'var(--primary-light)' }} />
                  </div>
                  <p className="dashboard-stat-label">Progreso General</p>
                  <p className="dashboard-stat-value" style={{ color: 'var(--primary-light)' }}>
                    {filteredMeds.length ? Math.round(filteredMeds.reduce((acc, m) => acc + (m.dosesTaken || 0), 0) / filteredMeds.reduce((acc, m) => acc + ((m.durationDays || 1) * (m.timesPerDay || 1)), 0) * 100) : 0}%
                  </p>
                  <div className="progress-container" style={{ height: '6px', margin: '8px 0 0', background: 'rgba(255,255,255,0.06)' }}>
                    <div className="progress-bar" style={{ width: `${filteredMeds.length ? Math.round(filteredMeds.reduce((acc, m) => acc + (m.dosesTaken || 0), 0) / filteredMeds.reduce((acc, m) => acc + ((m.durationDays || 1) * (m.timesPerDay || 1)), 0) * 100) : 0}%` }}></div>
                  </div>
               </div>
               <div className="card dashboard-stat-card" style={{ margin: 0 }}>
                  <div className="dashboard-stat-icon" style={{ background: 'rgba(59, 130, 246, 0.1)' }}>
                    <Clock size={22} style={{ color: '#60a5fa' }} />
                  </div>
                  <p className="dashboard-stat-label">Tomas Hoy</p>
                  <p className="dashboard-stat-value" style={{ color: '#60a5fa' }}>
                    {filteredMeds.reduce((acc, m) => acc + (m.lastResetDate === localToday() ? (m.takenTodayCount || 0) : 0), 0)}
                  </p>
                  <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 700, marginTop: '4px' }}>
                    de {filteredMeds.reduce((acc, m) => { const totalN = (m.durationDays || 0) * (m.timesPerDay || 1); return acc + ((m.dosesTaken || 0) < totalN ? (m.timesPerDay || 1) : 0); }, 0)} programadas
                  </p>
               </div>
               <div className="card dashboard-stat-card" style={{ margin: 0 }}>
                  <div className="dashboard-stat-icon" style={{ background: 'rgba(245, 158, 11, 0.1)' }}>
                    <Pill size={22} style={{ color: '#f59e0b' }} />
                  </div>
                  <p className="dashboard-stat-label">Planes Activos</p>
                  <p className="dashboard-stat-value" style={{ color: '#f59e0b' }}>
                    {statsAll.active}
                  </p>
                  <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 700, marginTop: '4px' }}>
                    en tratamiento
                  </p>
               </div>
               <div className="card dashboard-stat-card" style={{ margin: 0 }}>
                  <div className="dashboard-stat-icon" style={{ background: 'rgba(16, 185, 129, 0.1)' }}>
                    <CheckCircle2 size={22} style={{ color: '#10b981' }} />
                  </div>
                  <p className="dashboard-stat-label">Culminados</p>
                  <p className="dashboard-stat-value" style={{ color: '#10b981' }}>
                    {statsAll.completed}
                  </p>
                  <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 700, marginTop: '4px' }}>
                    completados ✓
                  </p>
               </div>
            </div>

            {/* ── Progress Overview Panel ── */}
            {filteredMeds.length > 0 && (
              <div className="progress-overview">
                <div className="progress-overview-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Activity size={18} style={{ color: 'var(--primary-light)' }} />
                    <h3 style={{ fontWeight: 900, fontSize: '0.85rem', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Avance de Planes</h3>
                  </div>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                    {filteredMeds.length} {filteredMeds.length === 1 ? 'plan' : 'planes'}
                  </span>
                </div>
                <div className="progress-overview-list">
                  {[...filteredMeds]
                    .sort((a, b) => {
                      const pctA = Math.round(((a.dosesTaken || 0) / (((a.durationDays || 1) * (a.timesPerDay || 1)) || 1)) * 100);
                      const pctB = Math.round(((b.dosesTaken || 0) / (((b.durationDays || 1) * (b.timesPerDay || 1)) || 1)) * 100);
                      return pctB - pctA;
                    })
                    .map(med => {
                      const totalNeeded = (med.durationDays || 0) * (med.timesPerDay || 1);
                      const progress = Math.min(100, Math.round(((med.dosesTaken || 0) / (totalNeeded || 1)) * 100));
                      const isCompleted = (med.dosesTaken || 0) >= totalNeeded;
                      return (
                        <div key={med.id} className="progress-overview-item animate-fade">
                          <div className="progress-overview-info">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                              <Pill size={14} style={{ color: isCompleted ? '#10b981' : 'var(--primary-light)', flexShrink: 0 }} />
                              <span className="progress-overview-name" style={{ textDecoration: isCompleted ? 'line-through' : 'none', opacity: isCompleted ? 0.7 : 1 }}>
                                {med.name.toUpperCase()}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                              <span className={`progress-overview-badge ${isCompleted ? 'completed' : 'active'}`}>
                                {isCompleted ? 'CULMINADO' : 'EN PROGRESO'}
                              </span>
                              <span className="progress-overview-pct" style={{ color: isCompleted ? '#10b981' : 'var(--primary-light)' }}>
                                {progress}%
                              </span>
                            </div>
                          </div>
                          <div className="progress-overview-bar-bg">
                            <div 
                              className="progress-overview-bar-fill" 
                              style={{ 
                                width: `${progress}%`,
                                background: isCompleted 
                                  ? 'linear-gradient(90deg, #10b981 0%, #059669 100%)' 
                                  : 'linear-gradient(90deg, var(--primary) 0%, var(--primary-light) 100%)'
                              }}
                            />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                            <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                              {med.dosesTaken || 0} / {totalNeeded} tomas
                            </span>
                            {med.pathology && (
                              <span style={{ fontSize: '0.55rem', color: '#a78bfa', fontWeight: 700, textTransform: 'uppercase' }}>
                                {med.pathology}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

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
              {(() => {
                const sortedMeds = [...filteredMeds].sort((a, b) => {
                  const totalA = (a.durationDays || 0) * (a.timesPerDay || 1);
                  const isCompletedA = (a.dosesTaken || 0) >= totalA;
                  const totalB = (b.durationDays || 0) * (b.timesPerDay || 1);
                  const isCompletedB = (b.dosesTaken || 0) >= totalB;
                  if (isCompletedA && !isCompletedB) return 1;
                  if (!isCompletedA && isCompletedB) return -1;
                  return 0;
                });
                return sortedMeds.map(med => {
                  const totalNeeded = (med.durationDays || 0) * (med.timesPerDay || 1);
                  const isCompleted = (med.dosesTaken || 0) >= totalNeeded;
                  const progress = Math.min(100, Math.round(((med.dosesTaken || 0) / (totalNeeded || 1)) * 100));
                  
                  const today = localToday(); // local date, not UTC
                  const takenToday = med.lastResetDate === today ? (med.takenTodayCount || 0) : 0;
                  const isDoneToday = takenToday >= (med.timesPerDay || 1);

                  return (
                    <div key={med.id} className="card animate-fade" style={{ padding: '24px', opacity: isCompleted ? 0.85 : 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                             <Pill size={16} style={{ color: isCompleted ? '#10b981' : 'var(--primary-light)' }} />
                             <h3 style={{ fontWeight: 900, fontSize: '1.1rem', textDecoration: isCompleted ? 'line-through' : 'none', opacity: isCompleted ? 0.6 : 1 }}>{med.name.toUpperCase()}</h3>
                             {isCompleted && (
                               <span style={{ 
                                 background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)', 
                                 color: 'white', 
                                 fontSize: '0.65rem', 
                                 padding: '2px 8px', 
                                 borderRadius: '12px', 
                                 fontWeight: 900,
                                 boxShadow: '0 0 10px rgba(16,185,129,0.3)',
                                 letterSpacing: '0.5px'
                               }}>
                                 CULMINADO
                               </span>
                             )}
                          </div>
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700 }}>{med.dosage} • {med.timesPerDay} veces al día</p>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                            {med.pathology && (
                              <span style={{ 
                                background: 'rgba(139, 92, 246, 0.1)', 
                                color: '#a78bfa', 
                                fontSize: '0.62rem', 
                                padding: '2px 8px', 
                                borderRadius: '8px', 
                                fontWeight: 800,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                textTransform: 'uppercase'
                              }}>
                                <Activity size={10} /> {med.pathology}
                              </span>
                            )}
                            {med.doctorName && (
                              <span style={{ 
                                background: 'rgba(45, 212, 191, 0.1)', 
                                color: '#2dd4bf', 
                                fontSize: '0.62rem', 
                                padding: '2px 8px', 
                                borderRadius: '8px', 
                                fontWeight: 800,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                textTransform: 'uppercase'
                              }}>
                                <Shield size={10} /> {med.doctorName}
                              </span>
                            )}
                          </div>
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
                                <div 
                                  key={i} 
                                  className={`schedule-chip ${isTaken ? 'taken' : 'pending'} ${isPast && !isTaken ? 'past' : ''} ${isNext ? 'next' : ''} ${isCompleted ? 'completed' : ''}`}
                                  onClick={() => handleChipClick(med, t, i, isTaken, isCompleted)}
                                  title={
                                    isCompleted 
                                      ? "Plan de tratamiento culminado" 
                                      : isTaken 
                                        ? "Click para deshacer esta toma" 
                                        : `Click para registrar toma de las ${label}`
                                  }
                                >
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
                        <div className="progress-bar" style={{ width: `${progress}%`, background: isCompleted ? 'linear-gradient(90deg, #10b981 0%, #059669 100%)' : 'linear-gradient(90deg, var(--primary) 0%, var(--primary-light) 100%)' }}></div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', fontWeight: 900, color: 'var(--text-muted)' }}>
                        <span style={{ color: isCompleted ? '#10b981' : 'var(--primary-light)' }}>{progress}% COMPLETADO</span>
                        <span>{med.dosesTaken} / {totalNeeded} TOMAS TOTALES</span>
                      </div>
                      {/* Action buttons row */}
                      <div style={{ display: 'flex', gap: '10px', marginTop: '20px', alignItems: 'stretch' }}>
                        <button 
                          disabled={isCompleted || isDoneToday} 
                          onClick={() => markAsTaken(med)} 
                          className="btn-primary" 
                          style={{ 
                            flex: 1,
                            height: '52px', 
                            background: isCompleted
                              ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(16, 185, 129, 0.25))'
                              : isDoneToday
                                ? 'linear-gradient(135deg, rgba(13,115,119,0.15), rgba(13,115,119,0.25))'
                                : 'var(--primary)', 
                            color: isCompleted ? '#10b981' : isDoneToday ? 'var(--primary-light)' : 'white', 
                            border: isCompleted 
                              ? '1.5px solid #10b981' 
                              : isDoneToday 
                                ? '1.5px solid var(--primary)' 
                                : 'none',
                            opacity: (isCompleted || isDoneToday) ? 0.9 : 1,
                            cursor: (isCompleted || isDoneToday) ? 'default' : 'pointer',
                          }}
                        >
                          {isCompleted ? (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 900 }}>
                              <CheckCircle2 size={18} style={{ color: '#10b981' }} /> TRATAMIENTO CULMINADO
                            </div>
                          ) : isDoneToday ? (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 900 }}>
                              <CheckCircle2 size={18} /> DOSIS COMPLETADAS
                            </div>
                          ) : (
                            `CONFIRMAR TOMA ${takenToday + 1} de ${med.timesPerDay}`
                          )}
                        </button>

                        {/* Undo button — only visible when at least 1 dose was logged today and not completed */}
                        {takenToday > 0 && !isCompleted && (
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
                });
              })()}
            </div>
          </>
        ) : activeTab === 'historial' ? (
          <div className="animate-fade">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
              <h2 style={{ fontSize: '1.6rem', fontWeight: 900 }}>HISTORIAL</h2>
              <button 
                onClick={() => {
                  if (meds.length === 0) {
                    setErrorMessage("Primero debes agregar al menos un plan de medicamento.");
                    return;
                  }
                  setManualLogMedId(meds[0].id);
                  setManualLogDate(localToday());
                  const now = new Date();
                  setManualLogTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
                  setShowManualLogModal(true);
                }} 
                className="btn-primary" 
                style={{ height: '40px', fontSize: '0.75rem', padding: '0 16px', display: 'flex', alignItems: 'center', gap: '8px', width: 'auto' }}
              >
                <Plus size={16} /> TOMA MANUAL
              </button>
            </div>

            {historyLogs.length === 0 ? (
              <div className="card" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <Clock size={40} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                <p style={{ fontWeight: 700, fontSize: '0.9rem' }}>No hay tomas registradas en el historial.</p>
              </div>
            ) : (
              groupHistoryLogs(historyLogs).map(group => (
                <div key={group.dateKey} style={{ marginBottom: '24px' }}>
                  <div style={{ 
                    fontSize: '0.7rem', 
                    fontWeight: 900, 
                    color: 'var(--primary-light)', 
                    letterSpacing: '1.5px', 
                    marginBottom: '12px', 
                    borderBottom: '1px solid var(--border)', 
                    paddingBottom: '6px'
                  }}>
                    {group.label}
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {group.logs.map(log => (
                      <div key={log.id} className="card animate-fade" style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 20px', alignItems: 'center', margin: 0 }}>
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                          <CheckCircle2 size={20} style={{ color: 'var(--primary-light)' }} />
                          <div>
                            <h4 style={{ fontWeight: 900, fontSize: '0.9rem', color: 'var(--text)' }}>{log.medName.toUpperCase()}</h4>
                            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700 }}>{log.dosage}</p>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                          <div style={{ textAlign: 'right' }}>
                            <p style={{ fontWeight: 900, fontSize: '0.8rem', color: 'var(--primary-light)' }}>
                              {new Date(log.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', hour12: true})}
                            </p>
                          </div>
                          <div style={{ display: 'flex', gap: '12px', borderLeft: '1px solid var(--border)', paddingLeft: '16px' }}>
                            <Pencil 
                              size={16} 
                              onClick={() => openEditHistoryModal(log)} 
                              style={{ cursor: 'pointer', color: 'var(--text-muted)' }} 
                              title="Editar fecha/hora"
                            />
                            <Trash2 
                              size={16} 
                              onClick={() => deleteHistoryLog(log.id)} 
                              style={{ cursor: 'pointer', color: '#ef4444' }} 
                              title="Eliminar toma"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
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
                     <h3 style={{ fontWeight: 900, fontSize: '1.2rem' }}>{activeProfile.identifier || user.identifier}</h3>
                     <p style={{ fontSize: '0.7rem', color: 'var(--primary-light)', fontWeight: 900, textTransform: 'uppercase' }}>
                       {isViewingOtherPatient ? 'PACIENTE (ADMINISTRADO)' : (user.role === 'admin' ? 'ADMINISTRADOR' : 'PACIENTE')}
                     </p>
                  </div>
               </div>

               <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '20px' }}>

                  {/* ── ZONA HORARIA Y CONFIGURACIÓN PREMIUM ── */}
                  <div style={{ paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
                    <p style={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '14px' }}>Zona Horaria del Dispositivo</p>
                    <div style={{ background: 'var(--primary-dim)', border: '1px solid var(--primary-light)', borderRadius: '16px', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <Globe size={16} style={{ color: 'var(--primary-light)' }} />
                          <h4 style={{ fontWeight: 900, fontSize: '0.85rem', color: 'var(--primary-light)', textTransform: 'uppercase' }}>
                            {Intl.DateTimeFormat().resolvedOptions().timeZone || 'Detectando...'}
                          </h4>
                        </div>
                        <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                          Desfase UTC actual: {(() => {
                            const offsetMinutes = -new Date().getTimezoneOffset();
                            const hrs = Math.floor(Math.abs(offsetMinutes) / 60);
                            const mins = Math.abs(offsetMinutes) % 60;
                            const sign = offsetMinutes >= 0 ? '+' : '-';
                            return `GMT ${sign}${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
                          })()} (Offset: {user.utcOffset || 0} min)
                        </p>
                      </div>
                      <span style={{ 
                        background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%)', 
                        color: 'white', 
                        fontSize: '0.6rem', 
                        padding: '4px 10px', 
                        borderRadius: '12px', 
                        fontWeight: 900,
                        boxShadow: '0 0 10px var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}>
                        <Check size={10} strokeWidth={3} /> AUTOSINCRONIZADO
                      </span>
                    </div>
                  </div>

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
                          value={activeProfile.patientName || ''}
                          onChange={e => handleProfileFieldChange('patientName', e.target.value)}
                          onBlur={() => updateProfile({ patientName: activeProfile.patientName })}
                          style={{ background: 'var(--bg-main)' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* ── MÉDICOS TRATANTES ── */}
                  <div style={{ paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                      <p style={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', margin: 0 }}>Médicos Tratantes</p>
                      {!showDoctorForm && (
                        <button 
                          type="button"
                          onClick={() => { setShowDoctorForm(true); setDoctorEditId(null); setDoctorForm({ id: '', name: '', phone: '', email: '' }); }}
                          className="btn-primary"
                          style={{ padding: '6px 12px', fontSize: '0.65rem', height: 'auto', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          <Plus size={12} /> AGREGAR MÉDICO
                        </button>
                      )}
                    </div>

                    {showDoctorForm && (
                      <form onSubmit={handleSaveDoctor} style={{ background: 'var(--bg-main)', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
                        <p style={{ fontWeight: 800, fontSize: '0.75rem', color: 'var(--primary-light)', margin: 0 }}>
                          {doctorEditId ? 'EDITAR MÉDICO' : 'NUEVO MÉDICO TRATANTE'}
                        </p>
                        <div className="input-group" style={{ marginBottom: 0 }}>
                          <label style={{ fontWeight: 900, fontSize: '0.6rem', color: 'var(--text-muted)' }}>NOMBRE Y APELLIDO *</label>
                          <input 
                            type="text" 
                            className="input-field" 
                            required 
                            placeholder="Ej: Dr. Roberto Leyva" 
                            value={doctorForm.name} 
                            onChange={e => setDoctorForm({...doctorForm, name: e.target.value})} 
                            style={{ background: 'var(--bg-base)', padding: '8px 12px', fontSize: '0.8rem' }}
                          />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                          <div className="input-group" style={{ marginBottom: 0 }}>
                            <label style={{ fontWeight: 900, fontSize: '0.6rem', color: 'var(--text-muted)' }}>TELÉFONO</label>
                            <input 
                              type="text" 
                              className="input-field" 
                              placeholder="Ej: +58424..." 
                              value={doctorForm.phone} 
                              onChange={e => setDoctorForm({...doctorForm, phone: e.target.value})} 
                              style={{ background: 'var(--bg-base)', padding: '8px 12px', fontSize: '0.8rem' }}
                            />
                          </div>
                          <div className="input-group" style={{ marginBottom: 0 }}>
                            <label style={{ fontWeight: 900, fontSize: '0.6rem', color: 'var(--text-muted)' }}>CORREO</label>
                            <input 
                              type="email" 
                              className="input-field" 
                              placeholder="Ej: dr.leyva@mail.com" 
                              value={doctorForm.email} 
                              onChange={e => setDoctorForm({...doctorForm, email: e.target.value})} 
                              style={{ background: 'var(--bg-base)', padding: '8px 12px', fontSize: '0.8rem' }}
                            />
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                          <button type="submit" className="btn-primary" style={{ padding: '8px 12px', fontSize: '0.7rem', height: 'auto', borderRadius: '8px', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', background: 'var(--primary)' }}>
                            <Save size={12} /> GUARDAR
                          </button>
                          <button type="button" onClick={handleCancelDoctor} className="btn-primary" style={{ padding: '8px 12px', fontSize: '0.7rem', height: 'auto', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', flex: 1 }}>
                            CANCELAR
                          </button>
                        </div>
                      </form>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {getDoctorsList(user.doctorName).length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '16px', background: 'var(--bg-main)', border: '1px dashed var(--border)', borderRadius: '12px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                          No hay médicos registrados. Agrega uno arriba para asociarlo a tus planes de medicación.
                        </div>
                      ) : (
                        getDoctorsList(user.doctorName).map((doc) => (
                          <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-main)', border: '1px solid var(--border)', borderRadius: '12px', padding: '10px 14px', gap: '10px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Shield size={12} style={{ color: 'var(--primary-light)', flexShrink: 0 }} />
                                <span style={{ fontWeight: 800, fontSize: '0.8rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</span>
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '2px' }}>
                                {doc.phone && (
                                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                    <Phone size={10} /> {doc.phone}
                                  </span>
                                )}
                                {doc.email && (
                                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                    <Mail size={10} /> {doc.email}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                              <button 
                                type="button" 
                                onClick={() => handleEditDoctor(doc)} 
                                style={{ background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: '8px', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0 }}
                                title="Editar"
                              >
                                <Pencil size={12} />
                              </button>
                              <button 
                                type="button" 
                                onClick={() => handleDeleteDoctor(doc.id)} 
                                style={{ background: 'rgba(239,68,68,0.1)', border: 'none', borderRadius: '8px', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444', cursor: 'pointer', padding: 0 }}
                                title="Eliminar"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* ── NOTIFICACIONES WHATSAPP ── */}
                  <div style={{ paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                      <p style={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', margin: 0 }}>
                        Alertas WhatsApp <span style={{ color: '#25D366', fontWeight: 700 }}>✓ Gratis</span>
                      </p>
                      {/* Status badge */}
                      <span style={{
                        fontSize: '0.55rem', fontWeight: 800, padding: '3px 8px', borderRadius: '20px',
                        textTransform: 'uppercase', letterSpacing: '0.5px',
                        background: (activeProfile.phone && activeProfile.waApiKey) ? 'rgba(37,211,102,0.15)' : 'rgba(239,68,68,0.12)',
                        color: (activeProfile.phone && activeProfile.waApiKey) ? '#25D366' : '#ef4444',
                        border: `1px solid ${(activeProfile.phone && activeProfile.waApiKey) ? 'rgba(37,211,102,0.3)' : 'rgba(239,68,68,0.3)'}`,
                      }}>
                        {(activeProfile.phone && activeProfile.waApiKey) ? '● Configurado' : '○ Sin configurar'}
                      </span>
                    </div>

                    {/* Instruction card */}
                    <div style={{
                      background: 'rgba(37,211,102,0.06)', borderRadius: '12px',
                      border: '1px solid rgba(37,211,102,0.2)', padding: '14px', marginBottom: '16px',
                    }}>
                      <p style={{ fontSize: '0.65rem', fontWeight: 900, color: '#25D366', marginBottom: '10px', letterSpacing: '0.5px' }}>
                        📋 ACTIVACIÓN GRATUITA — 3 PASOS (solo una vez)
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                        {[
                          { n: '1', txt: 'Guarda en WhatsApp el número: +34 623 78 64 49 como "CallMeBot"' },
                          { n: '2', txt: 'Envíale el mensaje exacto: "I allow callmebot to send me messages"' },
                          { n: '3', txt: 'Recibirás tu API Key en segundos. Cópiala y pégala abajo.' },
                        ].map(({ n, txt }) => (
                          <div key={n} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                            <span style={{
                              minWidth: '20px', height: '20px', borderRadius: '50%',
                              background: 'rgba(37,211,102,0.25)', color: '#25D366',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: '0.6rem', fontWeight: 900, flexShrink: 0,
                            }}>{n}</span>
                            <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{txt}</p>
                          </div>
                        ))}
                      </div>
                      <p style={{ fontSize: '0.58rem', color: 'var(--text-muted)', marginTop: '10px', marginBottom: 0 }}>
                        💡 Recibirás alertas 10 min antes, 5 min antes y en la hora exacta de cada toma. Funciona aunque la app esté cerrada.
                      </p>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div className="input-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontWeight: 900, fontSize: '0.7rem', color: 'var(--primary-light)' }}>
                          <Phone size={14} style={{ display: 'inline', marginRight: '5px' }} /> TU NÚMERO WHATSAPP (con código país)
                        </label>
                        <input
                          type="tel"
                          className="input-field"
                          placeholder="Ej: +58424xxxxxxx  /  +573001234567"
                          value={activeProfile.phone || ''}
                          onChange={e => handleProfileFieldChange('phone', e.target.value)}
                          onBlur={() => updateProfile({ phone: activeProfile.phone })}
                          style={{ background: 'var(--bg-main)' }}
                        />
                      </div>
                      <div className="input-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontWeight: 900, fontSize: '0.7rem', color: 'var(--primary-light)' }}>
                          <Bell size={14} style={{ display: 'inline', marginRight: '5px' }} /> CALLMEBOT API KEY
                        </label>
                        <input
                          type="text"
                          className="input-field"
                          placeholder="Ej: 123456  (la recibes del bot por WhatsApp)"
                          value={activeProfile.waApiKey || ''}
                          onChange={e => handleProfileFieldChange('waApiKey', e.target.value)}
                          onBlur={() => updateProfile({ waApiKey: activeProfile.waApiKey })}
                          style={{ background: 'var(--bg-main)' }}
                        />
                      </div>
                    </div>

                    {/* Action buttons row */}
                    <div style={{ display: 'flex', gap: '10px', marginTop: '14px', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => window.open('https://wa.me/34623786449?text=I%20allow%20callmebot%20to%20send%20me%20messages', '_blank')}
                        className="btn-primary"
                        style={{ background: 'linear-gradient(135deg, #25D366 0%, #128C7E 100%)', flex: 2, minWidth: '140px', fontSize: '0.75rem', height: '42px' }}
                      >
                        <Phone size={16} /> ACTIVAR BOT
                      </button>
                      <button
                        onClick={async () => {
                          if (!activeProfile.phone || !activeProfile.waApiKey) {
                            alert('Completa el número de teléfono y el API Key antes de probar.');
                            return;
                          }
                          await testWhatsApp(activeProfile.phone, activeProfile.waApiKey);
                          alert('\u2705 Mensaje de prueba enviado. Revisa tu WhatsApp en unos segundos.');
                        }}
                        className="btn-primary"
                        style={{ background: 'var(--bg-main)', border: '1px solid #25D366', color: '#25D366', flex: 2, minWidth: '140px', fontSize: '0.75rem', height: '42px' }}
                      >
                        <Send size={16} /> PROBAR AHORA
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button onClick={handleLogout} className="btn-primary" style={{ background: '#ef4444', flex: 1 }}>
                      <LogOut size={20} /> SALIR
                    </button>
                  </div>
               
               </div>
            </div>
          </div>
        )}
      </main>
    </div>

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
                <div className="form-grid">
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--primary-light)' }}>PATOLOGÍA / CONDICIÓN</label>
                    <input type="text" className="input-field" placeholder="Ej: Lumbalgia, Migraña" value={formData.pathology || ''} onChange={e => setFormData({...formData, pathology: e.target.value})} style={{ background: 'var(--bg-main)', padding: '9px 14px' }} />
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--primary-light)' }}>MÉDICO QUE PRESCRIBE</label>
                    {getDoctorsList(user?.doctorName).length > 0 ? (
                      <>
                        <select 
                          className="input-field" 
                          value={showCustomDoctorInput ? 'custom_input' : (formData.doctorName || '')} 
                          onChange={e => {
                            if (e.target.value === 'custom_input') {
                              setShowCustomDoctorInput(true);
                              setFormData({...formData, doctorName: ''});
                            } else {
                              setShowCustomDoctorInput(false);
                              setFormData({...formData, doctorName: e.target.value});
                            }
                          }}
                          style={{ background: 'var(--bg-main)', padding: '9px 14px', color: 'var(--text-primary)' }}
                        >
                          <option value="">-- Seleccionar Médico --</option>
                          {getDoctorsList(user?.doctorName).map((d) => (
                            <option key={d.id} value={d.name}>{d.name}</option>
                          ))}
                          <option value="custom_input">Otro (Escribir...)</option>
                        </select>
                        {showCustomDoctorInput && (
                          <input 
                            type="text" 
                            className="input-field" 
                            required
                            placeholder="Ej: Dr. Roberto Leyva" 
                            value={formData.doctorName || ''} 
                            onChange={e => setFormData({...formData, doctorName: e.target.value})} 
                            style={{ background: 'var(--bg-main)', padding: '9px 14px', marginTop: '6px' }} 
                          />
                        )}
                      </>
                    ) : (
                      <input 
                        type="text" 
                        className="input-field" 
                        required
                        placeholder="Ej: Dr. Roberto Leyva" 
                        value={formData.doctorName || ''} 
                        onChange={e => setFormData({...formData, doctorName: e.target.value})} 
                        style={{ background: 'var(--bg-main)', padding: '9px 14px' }} 
                      />
                    )}
                  </div>
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

      <div className="fab" onClick={openNewPlanModal} style={{ width: '64px', height: '64px' }}><Plus size={32} /></div>

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

      {/* ── Add Manual Log Modal ── */}
      {showManualLogModal && (
        <div className="modal-overlay">
          <div className="modal-box animate-fade">
            <div className="modal-header">
              <h3 style={{ fontWeight: 900, fontSize: '1rem' }}>REGISTRAR TOMA MANUAL</h3>
              <X onClick={() => setShowManualLogModal(false)} size={22} style={{ cursor: 'pointer' }} />
            </div>
            <div className="modal-body">
              <form onSubmit={saveManualHistoryLog} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--primary-light)' }}>MEDICAMENTO</label>
                  <select 
                    className="input-field" 
                    required 
                    value={manualLogMedId} 
                    onChange={e => setManualLogMedId(e.target.value)} 
                    style={{ background: 'var(--bg-main)', padding: '9px 14px', border: '1px solid var(--border)', borderRadius: '12px', color: 'var(--text)' }}
                  >
                    {meds.map(med => (
                      <option key={med.id} value={med.id} style={{ background: 'var(--bg-card)', color: 'var(--text)' }}>
                        {med?.name?.toUpperCase() || 'Sin Nombre'} {med?.dosage ? `(${med.dosage})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="form-grid">
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--primary-light)' }}>FECHA</label>
                    <input 
                      type="date" 
                      className="input-field" 
                      required 
                      value={manualLogDate} 
                      onChange={e => setManualLogDate(e.target.value)} 
                      style={{ background: 'var(--bg-main)', padding: '9px 14px' }} 
                    />
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--primary-light)' }}>HORA</label>
                    <input 
                      type="time" 
                      className="input-field" 
                      required 
                      value={manualLogTime} 
                      onChange={e => setManualLogTime(e.target.value)} 
                      style={{ background: 'var(--bg-main)', padding: '9px 14px' }} 
                    />
                  </div>
                </div>
                
                <button type="submit" className="btn-primary" style={{ height: '48px', fontWeight: 900, marginTop: '8px', fontSize: '0.85rem' }}>
                  REGISTRAR TOMA
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit History Log Modal ── */}
      {showEditHistoryModal && editingHistoryLog && (
        <div className="modal-overlay">
          <div className="modal-box animate-fade">
            <div className="modal-header">
              <h3 style={{ fontWeight: 900, fontSize: '1rem' }}>EDITAR TOMA REGISTRADA</h3>
              <X onClick={() => { setShowEditHistoryModal(false); setEditingHistoryLog(null); }} size={22} style={{ cursor: 'pointer' }} />
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                <h4 style={{ fontWeight: 900, fontSize: '0.9rem', color: 'var(--primary-light)' }}>
                  {editingHistoryLog.medName.toUpperCase()}
                </h4>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {editingHistoryLog.dosage}
                </p>
              </div>
              <form onSubmit={saveEditHistory} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className="form-grid">
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--primary-light)' }}>FECHA</label>
                    <input 
                      type="date" 
                      className="input-field" 
                      required 
                      value={editHistoryDate} 
                      onChange={e => setEditHistoryDate(e.target.value)} 
                      style={{ background: 'var(--bg-main)', padding: '9px 14px' }} 
                    />
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--primary-light)' }}>HORA</label>
                    <input 
                      type="time" 
                      className="input-field" 
                      required 
                      value={editHistoryTime} 
                      onChange={e => setEditHistoryTime(e.target.value)} 
                      style={{ background: 'var(--bg-main)', padding: '9px 14px' }} 
                    />
                  </div>
                </div>
                
                <button type="submit" className="btn-primary" style={{ height: '48px', fontWeight: 900, marginTop: '8px', fontSize: '0.85rem' }}>
                  GUARDAR CAMBIOS
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {showCreatePatientModal && (
        <div className="modal-overlay">
          <div className="modal-box animate-fade" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3 style={{ fontWeight: 900, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UserPlus size={18} style={{ color: 'var(--primary-light)' }} /> REGISTRAR NUEVO PACIENTE
              </h3>
              <X onClick={() => { setShowCreatePatientModal(false); setCreatePatientError(''); }} size={22} style={{ cursor: 'pointer' }} />
            </div>
            <div className="modal-body">
              <form onSubmit={handleCreatePatient} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--primary-light)' }}>
                    IDENTIFICADOR DEL PACIENTE *
                  </label>
                  <input 
                    type="text" 
                    className="input-field" 
                    required 
                    placeholder="Ej: correo@gmail.com o +584241234567" 
                    value={createPatientForm.identifier} 
                    onChange={e => setCreatePatientForm({...createPatientForm, identifier: e.target.value})} 
                    style={{ background: 'var(--bg-main)', padding: '9px 14px' }} 
                  />
                  <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Se usará como credencial de acceso para el paciente.
                  </span>
                </div>

                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--primary-light)' }}>
                    NOMBRE COMPLETO *
                  </label>
                  <input 
                    type="text" 
                    className="input-field" 
                    required 
                    placeholder="Ej: María Gómez" 
                    value={createPatientForm.patientName} 
                    onChange={e => setCreatePatientForm({...createPatientForm, patientName: e.target.value})} 
                    style={{ background: 'var(--bg-main)', padding: '9px 14px' }} 
                  />
                </div>

                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--primary-light)' }}>
                    ROL DEL USUARIO
                  </label>
                  <select 
                    className="input-field" 
                    value={createPatientForm.role} 
                    onChange={e => setCreatePatientForm({...createPatientForm, role: e.target.value})} 
                    style={{ background: 'var(--bg-main)', padding: '9px 14px', color: 'var(--text-primary)' }}
                  >
                    <option value="user">PACIENTE ESTÁNDAR</option>
                    <option value="admin">SUPERADMINISTRADOR</option>
                  </select>
                </div>

                {createPatientError && (
                  <div style={{ 
                    background: 'rgba(239, 68, 68, 0.1)', 
                    color: '#ef4444', 
                    padding: '10px 14px', 
                    borderRadius: '12px', 
                    fontSize: '0.75rem', 
                    border: '1px solid rgba(239, 68, 68, 0.2)', 
                    fontWeight: 700 
                  }}>
                    <AlertCircle size={14} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle' }} /> {createPatientError}
                  </div>
                )}

                <button 
                  type="submit" 
                  className="btn-primary" 
                  disabled={createPatientLoading}
                  style={{ height: '48px', fontWeight: 900, marginTop: '8px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                  {createPatientLoading ? 'CREANDO PACIENTE...' : 'CREAR PACIENTE'} <Plus size={16} />
                </button>
              </form>
            </div>
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
