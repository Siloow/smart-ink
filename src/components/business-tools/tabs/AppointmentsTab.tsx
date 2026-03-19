import React, { useState, useEffect } from 'react';
import { FaPlus, FaCalendar } from 'react-icons/fa';
import type { SceneData, Appointment } from '../../../types';
import { appointmentStorage, initializeBusinessTools } from '../../../businessToolsStorage';

interface AppointmentsTabProps {
  currentScene: SceneData | null;
}

export default function AppointmentsTab({ currentScene }: AppointmentsTabProps) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [appointmentData, setAppointmentData] = useState({
    clientName: '',
    clientEmail: '',
    clientPhone: '',
    date: new Date().toISOString().split('T')[0],
    time: '10:00',
    duration: 60,
    type: 'consultation' as Appointment['type'],
    location: 'studio' as Appointment['location'],
    notes: ''
  });

  useEffect(() => {
    initializeBusinessTools();
  }, []);

  useEffect(() => {
    if (currentScene) {
      loadSceneData();
    }
  }, [currentScene]);

  const loadSceneData = () => {
    if (!currentScene) return;
    const apps = appointmentStorage.getAppointments();
    setAppointments(apps);
  };

  const createAppointment = () => {
    if (!appointmentData.clientName.trim() || !appointmentData.clientEmail.trim()) return;

    const appointment: Appointment = {
      id: `appointment-${Date.now()}`,
      clientId: `client-${Date.now()}`,
      clientName: appointmentData.clientName,
      clientEmail: appointmentData.clientEmail,
      clientPhone: appointmentData.clientPhone,
      date: new Date(appointmentData.date + 'T' + appointmentData.time),
      duration: appointmentData.duration,
      type: appointmentData.type,
      status: 'scheduled',
      notes: appointmentData.notes,
      sceneIds: currentScene ? [currentScene.id] : [],
      location: appointmentData.location,
      createdAt: new Date(),
      createdBy: 'admin-1'
    };

    if (appointmentStorage.saveAppointment(appointment)) {
      setAppointments(appointmentStorage.getAppointments());
      setAppointmentData({
        clientName: '',
        clientEmail: '',
        clientPhone: '',
        date: new Date().toISOString().split('T')[0],
        time: '10:00',
        duration: 60,
        type: 'consultation',
        location: 'studio',
        notes: ''
      });
      setShowAppointmentModal(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h4 style={{ margin: 0 }}>Appointment Scheduler</h4>
        <button
          onClick={() => setShowAppointmentModal(true)}
          style={{
            background: '#9333ea',
            border: 'none',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          <FaPlus style={{ marginRight: '4px' }} />
          New Appointment
        </button>
      </div>

      {appointments.length === 0 ? (
        <p style={{ color: '#888', textAlign: 'center', marginTop: '32px' }}>
          No appointments scheduled. Create your first appointment.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {appointments.slice(0, 5).map(appointment => (
            <div
              key={appointment.id}
              style={{
                padding: '12px',
                background: '#2a2a2a',
                borderRadius: '6px',
                border: '1px solid #333'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontWeight: 'bold' }}>{appointment.clientName}</span>
                <span style={{
                  fontSize: '12px',
                  color: appointment.status === 'confirmed' ? '#059669' :
                         appointment.status === 'completed' ? '#1d4ed8' :
                         appointment.status === 'cancelled' ? '#dc2626' : '#f59e0b'
                }}>
                  {appointment.status.toUpperCase()}
                </span>
              </div>
              <div style={{ fontSize: '14px', marginBottom: '4px' }}>
                {new Date(appointment.date).toLocaleDateString()} at {new Date(appointment.date).toLocaleTimeString().slice(0, 5)}
              </div>
              <div style={{ fontSize: '12px', color: '#888' }}>
                {appointment.type.replace('_', ' ')} • {appointment.location}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Appointment Modal */}
      {showAppointmentModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000
        }}>
          <div style={{
            background: '#2a2a2a',
            padding: '24px',
            borderRadius: '8px',
            width: '350px',
            maxHeight: '80vh',
            overflowY: 'auto'
          }}>
            <h4 style={{ margin: '0 0 16px 0' }}>Schedule Appointment</h4>
            
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>Client Name</label>
              <input
                type="text"
                value={appointmentData.clientName}
                onChange={(e) => setAppointmentData({ ...appointmentData, clientName: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  color: 'white'
                }}
              />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>Email</label>
              <input
                type="email"
                value={appointmentData.clientEmail}
                onChange={(e) => setAppointmentData({ ...appointmentData, clientEmail: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  color: 'white'
                }}
              />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>Phone (optional)</label>
              <input
                type="tel"
                value={appointmentData.clientPhone}
                onChange={(e) => setAppointmentData({ ...appointmentData, clientPhone: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  color: 'white'
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>Date</label>
                <input
                  type="date"
                  value={appointmentData.date}
                  onChange={(e) => setAppointmentData({ ...appointmentData, date: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: '4px',
                    color: 'white'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>Time</label>
                <input
                  type="time"
                  value={appointmentData.time}
                  onChange={(e) => setAppointmentData({ ...appointmentData, time: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: '4px',
                    color: 'white'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>Type</label>
                <select
                  value={appointmentData.type}
                  onChange={(e) => setAppointmentData({ ...appointmentData, type: e.target.value as Appointment['type'] })}
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: '4px',
                    color: 'white'
                  }}
                >
                  <option value="consultation">Consultation</option>
                  <option value="design_review">Design Review</option>
                  <option value="final_approval">Final Approval</option>
                  <option value="touch_up">Touch Up</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>Location</label>
                <select
                  value={appointmentData.location}
                  onChange={(e) => setAppointmentData({ ...appointmentData, location: e.target.value as Appointment['location'] })}
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: '4px',
                    color: 'white'
                  }}
                >
                  <option value="studio">Studio</option>
                  <option value="video_call">Video Call</option>
                  <option value="phone">Phone</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>Notes</label>
              <textarea
                value={appointmentData.notes}
                onChange={(e) => setAppointmentData({ ...appointmentData, notes: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  color: 'white',
                  height: '60px',
                  resize: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowAppointmentModal(false)}
                style={{
                  background: '#666',
                  border: 'none',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={createAppointment}
                style={{
                  background: '#9333ea',
                  border: 'none',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 