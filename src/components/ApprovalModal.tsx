import React, { useState } from 'react';

interface ApprovalModalProps {
  isOpen: boolean;
  content: string;
  onApprove: () => void;
  onEdit: (newContent: string) => void;
  onCancel: () => void;
}

export const ApprovalModal: React.FC<ApprovalModalProps> = ({ isOpen, content, onApprove, onEdit, onCancel }) => {
  const [editedContent, setEditedContent] = useState(content);

  React.useEffect(() => {
    setEditedContent(content);
  }, [content]);

  if (!isOpen) return null;

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
          <button onClick={onCancel} className="cancel-btn">
            ❌ Discard
          </button>
          <button onClick={onApprove} className="approve-btn">
            ✅ Approve &amp; Execute
          </button>
        </div>
      </div>
    </div>
  );
};