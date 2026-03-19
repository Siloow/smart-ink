import React, { useState, useEffect } from 'react';
import { FaUpload, FaSearch, FaTag } from 'react-icons/fa';
import type { SceneData, ReferenceImage, User, Project } from '../../../types';
import { referenceStorage, userStorage, projectStorage, initializeBusinessTools } from '../../../businessToolsStorage';

interface ReferencesTabProps {
  currentScene: SceneData | null;
}

export default function ReferencesTab({ currentScene }: ReferencesTabProps) {
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadData, setUploadData] = useState({ name: '', category: '', tags: '' });
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');

  useEffect(() => {
    initializeBusinessTools();
    const user = userStorage.getCurrentUser();
    setCurrentUser(user);
    
    if (user) {
      const userProjects = projectStorage.getProjects().filter(p => p.team.includes(user.id));
      setProjects(userProjects);
      if (userProjects.length > 0) {
        setSelectedProject(userProjects[0].id);
      }
    }
  }, []);

  useEffect(() => {
    loadReferences();
  }, []);

  const loadReferences = () => {
    const allReferences = referenceStorage.getReferences();
    setReferences(allReferences);
  };

  const uploadReference = () => {
    if (!currentUser || !uploadData.name.trim() || !uploadData.category.trim()) return;

    // Simulate file upload - in real app, you'd handle actual file upload
    const reference: ReferenceImage = {
      id: `ref-${Date.now()}`,
      name: uploadData.name,
      url: 'https://via.placeholder.com/300x200?text=Reference+Image',
      tags: uploadData.tags.split(',').map(tag => tag.trim()).filter(tag => tag),
      category: uploadData.category,
      uploadedBy: currentUser.id,
      uploadedAt: new Date(),
      projects: selectedProject ? [selectedProject] : []
    };

    if (referenceStorage.addReference(reference)) {
      loadReferences();
      setUploadData({ name: '', category: '', tags: '' });
      setShowUploadModal(false);
    }
  };

  const searchReferences = () => {
    const results = referenceStorage.searchReferences(searchQuery, selectedTags);
    setReferences(results);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h4 style={{ margin: 0 }}>Reference Library</h4>
        <button
          onClick={() => setShowUploadModal(true)}
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
          <FaUpload style={{ marginRight: '4px' }} />
          Upload
        </button>
      </div>

      {/* Search */}
      <div style={{ marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="Search references..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            background: '#2a2a2a',
            border: '1px solid #333',
            borderRadius: '4px',
            color: 'white',
            marginBottom: '8px'
          }}
        />
        <button
          onClick={searchReferences}
          style={{
            background: '#1d4ed8',
            border: 'none',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          <FaSearch style={{ marginRight: '4px' }} />
          Search
        </button>
      </div>

      {references.length === 0 ? (
        <p style={{ color: '#888', textAlign: 'center', marginTop: '32px' }}>
          No references found. Upload your first reference image.
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {references.map(ref => (
            <div
              key={ref.id}
              style={{
                background: '#2a2a2a',
                borderRadius: '6px',
                overflow: 'hidden',
                border: '1px solid #333'
              }}
            >
              <img
                src={ref.url}
                alt={ref.name}
                style={{
                  width: '100%',
                  height: '80px',
                  objectFit: 'cover'
                }}
              />
              <div style={{ padding: '8px' }}>
                <h5 style={{ margin: '0 0 4px 0', fontSize: '12px' }}>{ref.name}</h5>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                  {ref.tags.slice(0, 2).map(tag => (
                    <span
                      key={tag}
                      style={{
                        background: '#9333ea',
                        color: 'white',
                        padding: '2px 6px',
                        borderRadius: '10px',
                        fontSize: '10px'
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
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
            <h4 style={{ margin: '0 0 16px 0' }}>Upload Reference</h4>
            <input
              type="text"
              placeholder="Reference name"
              value={uploadData.name}
              onChange={(e) => setUploadData({ ...uploadData, name: e.target.value })}
              style={{
                width: '100%',
                padding: '8px',
                background: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: '4px',
                color: 'white',
                marginBottom: '8px'
              }}
            />
            <input
              type="text"
              placeholder="Category"
              value={uploadData.category}
              onChange={(e) => setUploadData({ ...uploadData, category: e.target.value })}
              style={{
                width: '100%',
                padding: '8px',
                background: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: '4px',
                color: 'white',
                marginBottom: '8px'
              }}
            />
            <input
              type="text"
              placeholder="Tags (comma separated)"
              value={uploadData.tags}
              onChange={(e) => setUploadData({ ...uploadData, tags: e.target.value })}
              style={{
                width: '100%',
                padding: '8px',
                background: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: '4px',
                color: 'white',
                marginBottom: '16px'
              }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowUploadModal(false)}
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
                onClick={uploadReference}
                style={{
                  background: '#9333ea',
                  border: 'none',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Upload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 