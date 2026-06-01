import React, { useState, useEffect } from 'react';
import { FaPlus, FaSignature } from 'react-icons/fa';
import type { SceneData, ApprovalRequest, User } from '../../../types';
import { approvalStorage, userStorage, initializeBusinessTools } from '../../../businessToolsStorage';

interface ApprovalTabProps {
  currentScene: SceneData | null;
}

export default function ApprovalTab({ currentScene }: ApprovalTabProps) {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalData, setApprovalData] = useState({ clientEmail: '', clientName: '', message: '' });
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
    const sceneApprovals = approvalStorage.getApprovalRequests(currentScene.id);
    setApprovals(sceneApprovals);
  };

  const requestApproval = () => {
    if (!currentScene || !currentUser || !approvalData.clientEmail.trim()) return;

    const approval: ApprovalRequest = {
      id: `approval-${Date.now()}`,
      sceneId: currentScene.id,
      requestedBy: currentUser.id,
      requestedAt: new Date(),
      clientEmail: approvalData.clientEmail,
      clientName: approvalData.clientName,
      message: approvalData.message,
      status: 'pending'
    };

    if (approvalStorage.createApprovalRequest(approval)) {
      setApprovals(approvalStorage.getApprovalRequests(currentScene.id));
      setApprovalData({ clientEmail: '', clientName: '', message: '' });
      setShowApprovalModal(false);
    }
  };

  const approveScene = (approvalId: string) => {
    if (!currentUser) return;
    
    if (approvalStorage.updateApprovalStatus(approvalId, 'approved', currentUser.id)) {
      setApprovals(approvalStorage.getApprovalRequests(currentScene?.id || ''));
    }
  };

  const rejectScene = (approvalId: string) => {
    if (!currentUser) return;
    
    if (approvalStorage.updateApprovalStatus(approvalId, 'rejected', currentUser.id)) {
      setApprovals(approvalStorage.getApprovalRequests(currentScene?.id || ''));
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h4 style={{ margin: 0 }}>Approval Workflow</h4>
        <button
          onClick={() => setShowApprovalModal(true)}
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
          Request Approval
        </button>
      </div>

      {approvals.length === 0 ? (
        <p style={{ color: '#888', textAlign: 'center', marginTop: '32px' }}>
          No approval requests yet. Request client approval to start the workflow.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {approvals.map(approval => (
            <div
              key={approval.id}
              style={{
                padding: '12px',
                background: '#2a2a2a',
                borderRadius: '6px',
                border: `1px solid ${
                  approval.status === 'approved' ? '#059669' :
                  approval.status === 'rejected' ? '#dc2626' : '#333'
                }`
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontWeight: 'bold' }}>{approval.clientName}</span>
                <span style={{
                  fontSize: '12px',
                  color: approval.status === 'approved' ? '#059669' :
                         approval.status === 'rejected' ? '#dc2626' : '#f59e0b'
                }}>
                  {approval.status.toUpperCase()}
                </span>
              </div>
              <p style={{ margin: '0 0 8px 0', fontSize: '14px' }}>{approval.message}</p>
              <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>
                Requested: {new Date(approval.requestedAt).toLocaleDateString()}
              </div>
              {approval.status === 'pending' && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => approveScene(approval.id)}
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
                    Approve
                  </button>
                  <button
                    onClick={() => rejectScene(approval.id)}
                    style={{
                      background: '#dc2626',
                      border: 'none',
                      color: 'white',
                      padding: '6px 10px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Approval Modal */}
      {showApprovalModal && (
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
            <h4 style={{ margin: '0 0 16px 0' }}>Request Approval</h4>
            <input
              type="text"
              placeholder="Client name"
              value={approvalData.clientName}
              onChange={(e) => setApprovalData({ ...approvalData, clientName: e.target.value })}
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
              type="email"
              placeholder="Client email"
              value={approvalData.clientEmail}
              onChange={(e) => setApprovalData({ ...approvalData, clientEmail: e.target.value })}
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
            <textarea
              placeholder="Message to client..."
              value={approvalData.message}
              onChange={(e) => setApprovalData({ ...approvalData, message: e.target.value })}
              style={{
                width: '100%',
                height: '60px',
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
                onClick={() => setShowApprovalModal(false)}
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
                onClick={requestApproval}
                style={{
                  background: '#9333ea',
                  border: 'none',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Send Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 