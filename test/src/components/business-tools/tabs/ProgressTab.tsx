import React, { useState, useEffect } from 'react';
import { FaPlus, FaHistory } from 'react-icons/fa';
import type { SceneData, ProgressState } from '../../../types';
import { progressStorage, initializeBusinessTools } from '../../../businessToolsStorage';

interface ProgressTabProps {
  currentScene: SceneData | null;
  onSceneUpdate: (scene: SceneData) => void;
}

export default function ProgressTab({ currentScene, onSceneUpdate }: ProgressTabProps) {
  const [progressStates, setProgressStates] = useState<ProgressState[]>([]);
  const [newProgressState, setNewProgressState] = useState({
    name: '',
    description: '',
    notes: '',
    isMilestone: false
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
    const states = progressStorage.getProgressStates(currentScene.id);
    setProgressStates(states);
  };

  const saveProgressState = () => {
    if (!currentScene || !newProgressState.name.trim()) return;

    // Simulate thumbnail generation
    const thumbnail = 'https://via.placeholder.com/200x150?text=Progress+State';

    const state: ProgressState = {
      id: `progress-${Date.now()}`,
      sceneId: currentScene.id,
      name: newProgressState.name,
      description: newProgressState.description,
      sceneData: { ...currentScene, updatedAt: new Date() },
      thumbnail,
      createdAt: new Date(),
      createdBy: 'admin-1',
      tags: [],
      notes: newProgressState.notes,
      isMilestone: newProgressState.isMilestone
    };

    if (progressStorage.saveProgressState(state)) {
      setProgressStates(progressStorage.getProgressStates(currentScene.id));
      setNewProgressState({ name: '', description: '', notes: '', isMilestone: false });
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h4 style={{ margin: 0 }}>Progress Documentation</h4>
        <button
          onClick={saveProgressState}
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
          Save State
        </button>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="State name"
          value={newProgressState.name}
          onChange={(e) => setNewProgressState({ ...newProgressState, name: e.target.value })}
          style={{
            width: '100%',
            padding: '8px',
            background: '#2a2a2a',
            border: '1px solid #333',
            borderRadius: '4px',
            color: 'white',
            marginBottom: '8px'
          }}
        />
        <textarea
          placeholder="Description"
          value={newProgressState.description}
          onChange={(e) => setNewProgressState({ ...newProgressState, description: e.target.value })}
          style={{
            width: '100%',
            padding: '8px',
            background: '#2a2a2a',
            border: '1px solid #333',
            borderRadius: '4px',
            color: 'white',
            marginBottom: '8px',
            height: '60px',
            resize: 'none'
          }}
        />
        <textarea
          placeholder="Notes"
          value={newProgressState.notes}
          onChange={(e) => setNewProgressState({ ...newProgressState, notes: e.target.value })}
          style={{
            width: '100%',
            padding: '8px',
            background: '#2a2a2a',
            border: '1px solid #333',
            borderRadius: '4px',
            color: 'white',
            marginBottom: '8px',
            height: '60px',
            resize: 'none'
          }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
          <input
            type="checkbox"
            checked={newProgressState.isMilestone}
            onChange={(e) => setNewProgressState({ ...newProgressState, isMilestone: e.target.checked })}
          />
          Mark as milestone
        </label>
      </div>

      {progressStates.length === 0 ? (
        <p style={{ color: '#888', textAlign: 'center', marginTop: '32px' }}>
          No progress states saved yet. Save your first state to start tracking progress.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {progressStates.map(state => (
            <div
              key={state.id}
              style={{
                padding: '12px',
                background: state.isMilestone ? '#1a2e1a' : '#2a2a2a',
                borderRadius: '6px',
                border: state.isMilestone ? '1px solid #059669' : '1px solid #333'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontWeight: 'bold', color: state.isMilestone ? '#059669' : 'white' }}>
                  {state.name}
                </span>
                <span style={{ fontSize: '12px', color: '#888' }}>
                  {new Date(state.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p style={{ margin: '0 0 8px 0', fontSize: '14px' }}>{state.description}</p>
              {state.notes && (
                <p style={{ margin: 0, fontSize: '12px', color: '#888' }}>{state.notes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
} 