import React, { useState, useEffect } from 'react';
import { FaTimes } from 'react-icons/fa';
import type { SceneData } from '../../types';
import VersioningTab from './tabs/VersioningTab';
import CollaborationTab from './tabs/CollaborationTab';
import ReferencesTab from './tabs/ReferencesTab';
import ApprovalTab from './tabs/ApprovalTab';
import PricingTab from './tabs/PricingTab';
import ProgressTab from './tabs/ProgressTab';
import ComparisonTab from './tabs/ComparisonTab';
import AppointmentsTab from './tabs/AppointmentsTab';
import BusinessToolsTabs from './BusinessToolsTabs';

interface BusinessToolsPanelProps {
  currentScene: SceneData | null;
  onSceneUpdate: (scene: SceneData) => void;
  onExportScene: () => void;
  isVisible: boolean;
  onClose: () => void;
  /** When true, panel is embedded in layout (e.g. Scenes page) instead of fixed overlay */
  embedded?: boolean;
}

export type BusinessToolTab = 
  | 'versioning' 
  | 'collaboration' 
  | 'references' 
  | 'approval'
  | 'pricing'
  | 'progress'
  | 'comparison'
  | 'appointments';

export default function BusinessToolsPanel({ 
  currentScene, 
  onSceneUpdate, 
  onExportScene, 
  isVisible, 
  onClose,
  embedded = false,
}: BusinessToolsPanelProps) {
  const [activeTab, setActiveTab] = useState<BusinessToolTab>('versioning');

  if (!isVisible) return null;

  const renderTabContent = () => {
    switch (activeTab) {
      case 'versioning':
        return (
          <VersioningTab 
            currentScene={currentScene}
            onSceneUpdate={onSceneUpdate}
          />
        );
      case 'collaboration':
        return (
          <CollaborationTab 
            currentScene={currentScene}
          />
        );
      case 'references':
        return (
          <ReferencesTab 
            currentScene={currentScene}
          />
        );
      case 'approval':
        return (
          <ApprovalTab 
            currentScene={currentScene}
          />
        );
      case 'pricing':
        return (
          <PricingTab 
            currentScene={currentScene}
          />
        );
      case 'progress':
        return (
          <ProgressTab 
            currentScene={currentScene}
            onSceneUpdate={onSceneUpdate}
          />
        );
      case 'comparison':
        return (
          <ComparisonTab 
            currentScene={currentScene}
            onSceneUpdate={onSceneUpdate}
          />
        );
      case 'appointments':
        return (
          <AppointmentsTab 
            currentScene={currentScene}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div
      className={`panel-business ${embedded ? 'panel-business--embedded' : ''}`}
      style={
        embedded
          ? {
              width: '100%',
              minWidth: 0,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              borderLeft: '1px solid var(--border-subtle)',
            }
          : {
              position: 'fixed',
              top: 0,
              right: 0,
              width: 450,
              height: '100vh',
              zIndex: 1000,
              display: 'flex',
              flexDirection: 'column',
            }
      }
    >
      <div className="panel-business-header">
        <h3>Business tools</h3>
        <button type="button" className="panel-business-close" onClick={onClose} aria-label="Close">
          <FaTimes />
        </button>
      </div>

      {/* Tabs */}
      <BusinessToolsTabs 
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {renderTabContent()}
      </div>
    </div>
  );
} 