import React, { useState, useEffect } from 'react';
import { FaPlus, FaEye, FaHistory } from 'react-icons/fa';
import type { SceneData, VersionHistory, User } from '../../../types';
import { versionStorage, userStorage, initializeBusinessTools } from '../../../businessToolsStorage';

interface VersioningTabProps {
  currentScene: SceneData | null;
  onSceneUpdate: (scene: SceneData) => void;
}

export default function VersioningTab({ currentScene, onSceneUpdate }: VersioningTabProps) {
  const [versions, setVersions] = useState<VersionHistory[]>([]);
  const [versionDescription, setVersionDescription] = useState('');
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    initializeBusinessTools();
    const user = userStorage.getCurrentUser();
    setCurrentUser(user);
  }, []);

  useEffect(() => {
    if (currentScene) {
      loadSceneData();
    }
  }, [currentScene]);

  const loadSceneData = () => {
    if (!currentScene) return;
    const sceneVersions = versionStorage.getVersions(currentScene.id);
    setVersions(sceneVersions);
  };

  const createVersion = () => {
    if (!currentScene || !currentUser) return;

    const latestVersion = versionStorage.getLatestVersionNumber(currentScene.id);
    const description = versionDescription.trim() || 'Snapshot saved';
    const newVersion: VersionHistory = {
      id: `version-${Date.now()}`,
      sceneId: currentScene.id,
      version: latestVersion + 1,
      sceneData: { ...currentScene, updatedAt: new Date() },
      createdAt: new Date(),
      createdBy: currentUser.id,
      description,
      changes: ['Scene updated']
    };

    if (versionStorage.saveVersion(newVersion)) {
      setVersions(versionStorage.getVersions(currentScene.id));
      setVersionDescription('');
      setShowVersionModal(false);
    }
  };

  const restoreVersion = (version: VersionHistory) => {
    if (!currentScene) return;
    
    // Restore a snapshot into the editor. `id` must remain the current scene's id.
    // Also bump `updatedAt` so lists/sorting reflect the restore action.
    const restoredScene = { ...version.sceneData, id: currentScene.id, updatedAt: new Date() };
    onSceneUpdate(restoredScene);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h4 style={{ margin: 0 }}>Version History</h4>
        <button
          onClick={() => setShowVersionModal(true)}
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
          Save Version
        </button>
      </div>

      {versions.length === 0 ? (
        <p style={{ color: '#888', textAlign: 'center', marginTop: '32px' }}>
          No versions saved yet. Create your first version to start tracking changes.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {versions.map(version => (
            <div
              key={version.id}
              style={{
                padding: '12px',
                background: '#2a2a2a',
                borderRadius: '6px',
                border: '1px solid #333'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontWeight: 'bold' }}>Version {version.version}</span>
                <span style={{ fontSize: '12px', color: '#888' }}>
                  {new Date(version.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p style={{ margin: '0 0 8px 0', fontSize: '14px' }}>{version.description}</p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => restoreVersion(version)}
                  style={{
                    background: '#059669',
                    border: 'none',
                    color: 'white',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  <FaEye style={{ marginRight: '4px' }} />
                  Restore
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Version Modal */}
      {showVersionModal && (
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
            width: '300px'
          }}>
            <h4 style={{ margin: '0 0 16px 0' }}>Save Version</h4>
            <textarea
              placeholder="Describe the changes in this version..."
              value={versionDescription}
              onChange={(e) => setVersionDescription(e.target.value)}
              style={{
                width: '100%',
                height: '80px',
                padding: '8px',
                background: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: '4px',
                color: 'white',
                marginBottom: '16px',
                resize: 'none'
              }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowVersionModal(false)}
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
                onClick={createVersion}
                style={{
                  background: '#9333ea',
                  border: 'none',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Save Version
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 