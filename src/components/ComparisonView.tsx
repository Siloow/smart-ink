import React, { useState, useRef, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import ModelWithDecal from '../ModelWithDecal';
import CinematicLights from '../CinematicLights';
import type { SceneData } from '../types';

interface ComparisonViewProps {
  beforeScene: SceneData;
  afterScene: SceneData;
  isVisible: boolean;
  onClose: () => void;
}

// Component for the before scene (clean skin)
function BeforeScene({ sceneData }: { sceneData: SceneData }) {
  const { camera } = useThree();
  const [decalVisible, setDecalVisible] = useState(false);
  
  useEffect(() => {
    // Set camera position from scene data
    camera.position.set(...sceneData.camera.position);
    camera.fov = sceneData.camera.fov;
    camera.updateProjectionMatrix();
  }, [sceneData.camera.position, sceneData.camera.fov, camera]);

  return (
    <>
      <CinematicLights preset={sceneData.lightingPreset} />
      <ModelWithDecal
        model={sceneData.model}
        uploadedImage={null} // No decal for before scene
        decalRotation={0}
        decalScale={1}
        decalColor="#ffffff"
        decalOpacity={1}
        setDecalVisible={setDecalVisible}
        decalPosition={null}
        decalNormal={null}
      />
      <OrbitControls 
        target={sceneData.camera.target}
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
      />
    </>
  );
}

// Component for the after scene (with design)
function AfterScene({ sceneData }: { sceneData: SceneData }) {
  const { camera } = useThree();
  const [decalVisible, setDecalVisible] = useState(sceneData.decalVisible);
  
  useEffect(() => {
    // Set camera position from scene data
    camera.position.set(...sceneData.camera.position);
    camera.fov = sceneData.camera.fov;
    camera.updateProjectionMatrix();
  }, [sceneData.camera.position, sceneData.camera.fov, camera]);

  return (
    <>
      <CinematicLights preset={sceneData.lightingPreset} />
      <ModelWithDecal
        model={sceneData.model}
        uploadedImage={sceneData.decalImage}
        decalRotation={sceneData.decalRotation}
        decalScale={sceneData.decalScale}
        decalColor={sceneData.decalColor}
        decalOpacity={sceneData.decalOpacity}
        setDecalVisible={setDecalVisible}
        decalPosition={sceneData.decalPosition}
        decalNormal={sceneData.decalNormal}
      />
      <OrbitControls 
        target={sceneData.camera.target}
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
      />
    </>
  );
}

// Background component that applies the scene's background
function SceneBackground({ background }: { background: string }) {
  const BG_PRESETS = {
    white: { background: '#fff' },
    dark: { background: '#181818' },
    gray: { background: 'linear-gradient(135deg, #444 0%, #888 100%)' },
    bluepurple: { background: 'linear-gradient(135deg, #3a1c71 0%, #d76d77 50%, #ffaf7b 100%)' },
    peach: { background: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)' },
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        ...(BG_PRESETS[background as keyof typeof BG_PRESETS] || BG_PRESETS.white),
        transition: 'background 0.4s',
      }}
    />
  );
}

export default function ComparisonView({ beforeScene, afterScene, isVisible, onClose }: ComparisonViewProps) {
  const [activeView, setActiveView] = useState<'before' | 'after' | 'split'>('split');
  const [isTransitioning, setIsTransitioning] = useState(false);

  if (!isVisible) return null;

  const handleViewChange = (view: 'before' | 'after' | 'split') => {
    setIsTransitioning(true);
    setTimeout(() => {
      setActiveView(view);
      setIsTransitioning(false);
    }, 200);
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.95)',
      zIndex: 3000,
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 24px',
        background: 'rgba(0,0,0,0.8)',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h2 style={{ color: 'white', margin: 0, fontSize: '24px' }}>Before & After Comparison</h2>
        
        {/* View Controls */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => handleViewChange('before')}
            style={{
              padding: '8px 16px',
              background: activeView === 'before' ? '#9333ea' : '#333',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Before
          </button>
          <button
            onClick={() => handleViewChange('after')}
            style={{
              padding: '8px 16px',
              background: activeView === 'after' ? '#9333ea' : '#333',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            After
          </button>
          <button
            onClick={() => handleViewChange('split')}
            style={{
              padding: '8px 16px',
              background: activeView === 'split' ? '#9333ea' : '#333',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Split View
          </button>
        </div>

        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: '24px',
            padding: '8px'
          }}
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {activeView === 'before' && (
          <div style={{
            position: 'absolute',
            inset: 0,
            opacity: isTransitioning ? 0 : 1,
            transition: 'opacity 0.2s ease'
          }}>
            <SceneBackground background={beforeScene.background} />
            <Canvas
              camera={{ position: beforeScene.camera.position, fov: beforeScene.camera.fov }}
              shadows
            >
              <BeforeScene sceneData={beforeScene} />
            </Canvas>
            <div style={{
              position: 'absolute',
              top: '20px',
              left: '20px',
              background: 'rgba(0,0,0,0.7)',
              color: 'white',
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '18px',
              fontWeight: 'bold'
            }}>
              BEFORE
            </div>
          </div>
        )}

        {activeView === 'after' && (
          <div style={{
            position: 'absolute',
            inset: 0,
            opacity: isTransitioning ? 0 : 1,
            transition: 'opacity 0.2s ease'
          }}>
            <SceneBackground background={afterScene.background} />
            <Canvas
              camera={{ position: afterScene.camera.position, fov: afterScene.camera.fov }}
              shadows
            >
              <AfterScene sceneData={afterScene} />
            </Canvas>
            <div style={{
              position: 'absolute',
              top: '20px',
              left: '20px',
              background: 'rgba(0,0,0,0.7)',
              color: 'white',
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '18px',
              fontWeight: 'bold'
            }}>
              AFTER
            </div>
          </div>
        )}

        {activeView === 'split' && (
          <div style={{
            display: 'flex',
            height: '100%',
            opacity: isTransitioning ? 0 : 1,
            transition: 'opacity 0.2s ease'
          }}>
            {/* Before Side */}
            <div style={{ flex: 1, position: 'relative' }}>
              <SceneBackground background={beforeScene.background} />
              <Canvas
                camera={{ position: beforeScene.camera.position, fov: beforeScene.camera.fov }}
                shadows
              >
                <BeforeScene sceneData={beforeScene} />
              </Canvas>
              <div style={{
                position: 'absolute',
                top: '20px',
                left: '20px',
                background: 'rgba(0,0,0,0.7)',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '6px',
                fontSize: '18px',
                fontWeight: 'bold'
              }}>
                BEFORE
              </div>
            </div>

            {/* Divider */}
            <div style={{
              width: '2px',
              background: 'rgba(255,255,255,0.3)',
              position: 'relative'
            }}>
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                background: 'rgba(0,0,0,0.8)',
                color: 'white',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '12px',
                whiteSpace: 'nowrap'
              }}>
                COMPARISON
              </div>
            </div>

            {/* After Side */}
            <div style={{ flex: 1, position: 'relative' }}>
              <SceneBackground background={afterScene.background} />
              <Canvas
                camera={{ position: afterScene.camera.position, fov: afterScene.camera.fov }}
                shadows
              >
                <AfterScene sceneData={afterScene} />
              </Canvas>
              <div style={{
                position: 'absolute',
                top: '20px',
                right: '20px',
                background: 'rgba(0,0,0,0.7)',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '6px',
                fontSize: '18px',
                fontWeight: 'bold'
              }}>
                AFTER
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 