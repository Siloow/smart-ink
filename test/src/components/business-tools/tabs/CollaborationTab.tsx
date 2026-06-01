import React, { useState, useEffect } from 'react';
import { FaPlus, FaCheckCircle, FaComments } from 'react-icons/fa';
import type { SceneData, Comment, User } from '../../../types';
import { commentStorage, userStorage, initializeBusinessTools } from '../../../businessToolsStorage';

interface CollaborationTabProps {
  currentScene: SceneData | null;
}

export default function CollaborationTab({ currentScene }: CollaborationTabProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [showCommentModal, setShowCommentModal] = useState(false);
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
    const sceneComments = commentStorage.getComments(currentScene.id);
    setComments(sceneComments);
  };

  const addComment = () => {
    if (!currentScene || !currentUser || !newComment.trim()) return;

    const comment: Comment = {
      id: `comment-${Date.now()}`,
      sceneId: currentScene.id,
      userId: currentUser.id,
      userName: currentUser.name,
      content: newComment,
      createdAt: new Date(),
      resolved: false
    };

    if (commentStorage.addComment(comment)) {
      setComments(commentStorage.getComments(currentScene.id));
      setNewComment('');
      setShowCommentModal(false);
    }
  };

  const resolveComment = (commentId: string) => {
    if (!currentUser) return;
    
    if (commentStorage.resolveComment(commentId, currentUser.id)) {
      setComments(commentStorage.getComments(currentScene?.id || ''));
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h4 style={{ margin: 0 }}>Comments & Feedback</h4>
        <button
          onClick={() => setShowCommentModal(true)}
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
          Add Comment
        </button>
      </div>

      {comments.length === 0 ? (
        <p style={{ color: '#888', textAlign: 'center', marginTop: '32px' }}>
          No comments yet. Add the first comment to start the discussion.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {comments.map(comment => (
            <div
              key={comment.id}
              style={{
                padding: '12px',
                background: comment.resolved ? '#1a2e1a' : '#2a2a2a',
                borderRadius: '6px',
                border: `1px solid ${comment.resolved ? '#059669' : '#333'}`
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontWeight: 'bold', color: comment.resolved ? '#059669' : 'white' }}>
                  {comment.userName}
                </span>
                <span style={{ fontSize: '12px', color: '#888' }}>
                  {new Date(comment.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p style={{ margin: '0 0 8px 0', fontSize: '14px' }}>{comment.content}</p>
              {!comment.resolved && (
                <button
                  onClick={() => resolveComment(comment.id)}
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
                  <FaCheckCircle style={{ marginRight: '4px' }} />
                  Resolve
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Comment Modal */}
      {showCommentModal && (
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
            <h4 style={{ margin: '0 0 16px 0' }}>Add Comment</h4>
            <textarea
              placeholder="Add your comment or feedback..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
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
                onClick={() => setShowCommentModal(false)}
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
                onClick={addComment}
                style={{
                  background: '#9333ea',
                  border: 'none',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Add Comment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 