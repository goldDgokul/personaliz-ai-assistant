import React from 'react';

interface ApprovalModalProps {
  isOpen: boolean;
  content: string;
  onApprove: () => void;
  onEdit: (newContent: string) => void;
  onCancel: () => void;
}

export const ApprovalModal = ({ isOpen, content, onApprove, onEdit, onCancel }: any) => {
  if (!isOpen) return null;

  return (
    // fixed inset-0 and z-50 ensures it covers the whole screen
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
      <div className="bg-[#1a1b26] border border-slate-700 w-full max-w-lg rounded-xl shadow-2xl flex flex-col">
        <div className="p-6">
          <h3 className="text-xl font-bold text-white mb-2">Review Agent Content</h3>
          <p className="text-slate-400 text-sm mb-4">Verify the post before the agent goes live:</p>

          <textarea
            className="w-full h-48 bg-slate-900 text-slate-200 p-4 rounded-lg border border-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
            value={content}
            onChange={(e) => onEdit(e.target.value)}
          />
        </div>

        <div className="bg-slate-800/50 p-4 flex justify-end gap-3 rounded-b-xl">
          <button onClick={onCancel} className="px-4 py-2 text-slate-300 hover:text-white transition">
            Discard
          </button>
          <button
            onClick={onApprove}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md font-bold transition"
          >
            Approve & Execute
          </button>
        </div>
      </div>
    </div>
  );
};