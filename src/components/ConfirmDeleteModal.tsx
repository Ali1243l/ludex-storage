import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message?: string;
}

export default function ConfirmDeleteModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title = 'تأكيد الحذف', 
  message = 'هل أنت متأكد من حذف هذا العنصر؟ لا يمكن التراجع عن هذا الإجراء.' 
}: Props) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (dontShowAgain) {
      localStorage.setItem('skipDeleteWarning', 'true');
    }
    onConfirm();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6" dir="rtl">
      <div className="absolute inset-0 bg-gray-900/40 dark:bg-slate-900/60 backdrop-blur-sm transition-opacity" onClick={onClose}></div>
      <div className="relative bg-white dark:bg-slate-800 rounded-2xl text-right shadow-2xl w-full max-w-sm border border-gray-100 dark:border-slate-700 flex flex-col animate-in fade-in zoom-in-95 duration-200 transition-colors">
        <div className="p-6">
          <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 dark:bg-red-500/20 rounded-full mb-4">
            <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-500" />
          </div>
          <h3 className="text-lg font-semibold text-center text-gray-900 dark:text-white mb-2">{title}</h3>
          <p className="text-sm text-center text-gray-500 dark:text-slate-400 mb-6">{message}</p>
          
          <div className="flex items-center mb-6 bg-gray-50 dark:bg-slate-700/50 p-3 rounded-lg border border-gray-100 dark:border-slate-600">
            <input
              id="dontShowAgain"
              type="checkbox"
              className="w-4 h-4 text-blue-600 dark:text-blue-500 border-gray-300 dark:border-slate-500 rounded focus:ring-blue-500 dark:focus:ring-blue-400 bg-white dark:bg-slate-800"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />
            <label htmlFor="dontShowAgain" className="mr-2 text-sm text-gray-700 dark:text-slate-300 cursor-pointer">
              عدم إظهار هذا التحذير مرة أخرى
            </label>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleConfirm}
              className="flex-1 inline-flex justify-center items-center rounded-lg px-4 py-2.5 bg-red-600 text-sm font-medium text-white hover:bg-red-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              نعم، احذف
            </button>
            <button
              onClick={onClose}
              className="flex-1 inline-flex justify-center items-center rounded-lg px-4 py-2.5 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              إلغاء
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
