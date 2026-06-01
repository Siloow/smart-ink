import React from 'react';
import { 
  FaHistory, 
  FaUsers, 
  FaSearch, 
  FaSignature, 
  FaCalculator, 
  FaEye, 
  FaCalendar 
} from 'react-icons/fa';
import type { BusinessToolTab } from './BusinessToolsPanel';

interface BusinessToolsTabsProps {
  activeTab: BusinessToolTab;
  onTabChange: (tab: BusinessToolTab) => void;
}

const TAB_CONFIG = [
  // Core Business Tools
  {
    group: 'Core',
    tabs: [
      { id: 'versioning', label: 'Versioning', icon: <FaHistory /> },
      { id: 'collaboration', label: 'Collaboration', icon: <FaUsers /> },
      { id: 'references', label: 'References', icon: <FaSearch /> },
      { id: 'approval', label: 'Approval', icon: <FaSignature /> }
    ]
  },
  // Advanced Business Tools
  {
    group: 'Advanced',
    tabs: [
      { id: 'pricing', label: 'Pricing', icon: <FaCalculator /> },
      { id: 'progress', label: 'Progress', icon: <FaHistory /> },
      { id: 'comparison', label: 'Compare', icon: <FaEye /> },
      { id: 'appointments', label: 'Schedule', icon: <FaCalendar /> }
    ]
  }
];

export default function BusinessToolsTabs({ activeTab, onTabChange }: BusinessToolsTabsProps) {
  return (
    <div
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-card)',
      }}
    >
      {TAB_CONFIG.map((group, groupIndex) => (
        <div key={group.group}>
          <div
            style={{
              padding: '8px 16px',
              background: 'var(--bg-primary)',
              borderBottom: '1px solid var(--border-subtle)',
              fontSize: '0.72rem',
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            {group.group}
          </div>

          <div
            style={{
              display: 'flex',
              borderBottom: groupIndex < TAB_CONFIG.length - 1 ? '1px solid var(--border-subtle)' : 'none',
            }}
          >
            {group.tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id as BusinessToolTab)}
                style={{
                  flex: 1,
                  padding: '12px 8px',
                  background: activeTab === tab.id ? 'var(--accent-blue)' : 'transparent',
                  border: 'none',
                  color: activeTab === tab.id ? '#fff' : 'var(--text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: '0.72rem',
                  fontFamily: 'var(--font)',
                  fontWeight: activeTab === tab.id ? 600 : 500,
                  transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (activeTab !== tab.id) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTab !== tab.id) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--text-muted)';
                  }
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
} 