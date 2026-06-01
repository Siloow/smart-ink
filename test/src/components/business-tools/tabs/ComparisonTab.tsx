import React, { useState, useEffect } from 'react';
import { FaPlus, FaEye } from 'react-icons/fa';
import type { SceneData, BeforeAfterComparison } from '../../../types';
import { comparisonStorage, initializeBusinessTools } from '../../../businessToolsStorage';
import ComparisonView from '../../ComparisonView';

interface ComparisonTabProps {
  currentScene: SceneData | null;
  onSceneUpdate: (scene: SceneData) => void;
}

export default function ComparisonTab({ currentScene, onSceneUpdate }: ComparisonTabProps) {
  const [comparisons, setComparisons] = useState<BeforeAfterComparison[]>([]);
  const [showComparisonModal, setShowComparisonModal] = useState(false);
  const [showComparisonView, setShowComparisonView] = useState(false);
  const [selectedComparison, setSelectedComparison] = useState<BeforeAfterComparison | null>(null);

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
    const comps = comparisonStorage.getComparisons(currentScene.id);
    setComparisons(comps);
  };

  const createComparison = () => {
    if (!currentScene) return;

    // Create before scene (clean skin)
    const beforeSceneData: SceneData = {
      ...currentScene,
      decalVisible: false,
      name: `${currentScene.name} - Before`
    };

    // Create after scene (with design)
    const afterSceneData: SceneData = {
      ...currentScene,
      decalVisible: true,
      name: `${currentScene.name} - After`
    };

    const comparison: BeforeAfterComparison = {
      id: `comparison-${Date.now()}`,
      sceneId: currentScene.id,
      beforeImage: 'https://via.placeholder.com/400x300?text=Before',
      afterImage: 'https://via.placeholder.com/400x300?text=After',
      beforeSceneData,
      afterSceneData,
      createdAt: new Date(),
      createdBy: 'admin-1',
      description: 'Before and after comparison',
      isPublic: false
    };

    if (comparisonStorage.saveComparison(comparison)) {
      setComparisons(comparisonStorage.getComparisons(currentScene.id));
      setShowComparisonModal(false);
    }
  };

  const openComparisonView = (comparison: BeforeAfterComparison) => {
    setSelectedComparison(comparison);
    setShowComparisonView(true);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h4 style={{ margin: 0 }}>Before/After Comparisons</h4>
        <button
          onClick={() => setShowComparisonModal(true)}
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
          Create Comparison
        </button>
      </div>

      {comparisons.length === 0 ? (
        <p style={{ color: '#888', textAlign: 'center', marginTop: '32px' }}>
          No comparisons created yet. Create your first before/after comparison.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {comparisons.map(comparison => (
            <div
              key={comparison.id}
              style={{
                padding: '12px',
                background: '#2a2a2a',
                borderRadius: '6px',
                border: '1px solid #333'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontWeight: 'bold' }}>Before/After</span>
                <span style={{ fontSize: '12px', color: '#888' }}>
                  {new Date(comparison.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                <div style={{
                  width: '100%',
                  height: '80px',
                  background: '#1a1a1a',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#888',
                  fontSize: '12px'
                }}>
                  3D Before Scene
                </div>
                <div style={{
                  width: '100%',
                  height: '80px',
                  background: '#1a1a1a',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#888',
                  fontSize: '12px'
                }}>
                  3D After Scene
                </div>
              </div>
              <p style={{ margin: '0 0 8px 0', fontSize: '14px' }}>{comparison.description}</p>
              <button
                onClick={() => openComparisonView(comparison)}
                style={{
                  background: '#9333ea',
                  border: 'none',
                  color: 'white',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                <FaEye style={{ marginRight: '4px' }} />
                View 3D Comparison
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Comparison Modal */}
      {showComparisonModal && (
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
            <h4 style={{ margin: '0 0 16px 0' }}>Create Before/After Comparison</h4>
            <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#888' }}>
              This will create a comparison between the current state and a version without the design.
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowComparisonModal(false)}
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
                onClick={createComparison}
                style={{
                  background: '#9333ea',
                  border: 'none',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3D Comparison View */}
      {showComparisonView && selectedComparison && (
        <ComparisonView
          beforeScene={selectedComparison.beforeSceneData}
          afterScene={selectedComparison.afterSceneData}
          isVisible={showComparisonView}
          onClose={() => setShowComparisonView(false)}
        />
      )}
    </div>
  );
} 