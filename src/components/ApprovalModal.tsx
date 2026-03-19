import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface ApprovalModalProps {
  isOpen: boolean;
  content: string;
  agentId?: string;
  onApprove: () => void;
  onEdit: (newContent: string) => void;
  onCancel: () => void;
}

export const ApprovalModal: React.FC<ApprovalModalProps> = ({
  isOpen,
  content,
  agentId = 'unknown',
  onApprove,
  onEdit,
  onCancel,
}) => {
  const [editedContent, setEditedContent] = useState(content);

  React.useEffect(() => {
    setEditedContent(content);
  }, [content]);

  if (!isOpen) return null;

  const recordApproval = (outcome: 'approved' | 'rejected' | 'cancelled') => {
    const preview = editedContent.slice(0, 200);
    invoke('db_record_approval', {
      agentId,
      contentPreview: preview,
      outcome,
      notes: null,
    }).catch(console.error);
  };

  const handleApprove = () => {
    recordApproval('approved');
    onApprove();
  };

  const handleCancel = () => {
    recordApproval('cancelled');
    onCancel();
  };

  return (
    <div className="approval-modal-overlay">
      <div className="approval-modal-content">
        <div className="approval-modal-header">
          <h3>🔍 Review Agent Content</h3>
          <p>Verify the post before the agent goes live:</p>
        </div>

        <div className="approval-modal-body">
          <textarea
            value={editedContent}
            onChange={(e) => {
              setEditedContent(e.target.value);
              onEdit(e.target.value);
            }}
            placeholder="Edit content here..."
          />
        </div>

        <div className="approval-modal-footer">
          <button onClick={handleCancel} className="cancel-btn">
            ❌ Discard
          </button>
          <button onClick={handleApprove} className="approve-btn">
            ✅ Approve & Execute
          </button>
        </div>
      </div>
    </div>
  );
};
