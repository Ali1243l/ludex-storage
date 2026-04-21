import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Edit2, Trash2, Search, Calendar, DollarSign, TrendingDown, TrendingUp, User, X, FileText, CheckCircle, Copy, Check } from 'lucide-react';
import { Transaction, TransactionType } from '../types';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import { supabase } from '../supabaseClient';
import { useAuth } from '../AuthContext';

const generateId = () => Math.random().toString(36).substring(2, 9);

export default function Transactions() {
  const { role } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<TransactionType>('expense');
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const [formData, setFormData] = useState<Omit<Transaction, 'id' | 'type'>>({
    person: '',
    username: '',
    description: '',
    amount: 0,
    date: new Date().toISOString().split('T')[0],
    notes: '',
  });

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  useEffect(() => {
    let isMounted = true;
    
    const fetchTransactions = async () => {
      if (!isMounted) return;
      setIsLoading(true);
      try {
        const { data, error } = await supabase.from('transactions').select('*').order('date', { ascending: false });
        if (!isMounted) return;
        if (data) setTransactions(data as Transaction[]);
        if (error) console.error("Error fetching transactions:", error);
      } catch (e) {
        console.error("Fetch transactions error:", e);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchTransactions();

    let timeoutId: NodeJS.Timeout;

    const channel = supabase
      .channel('schema-db-changes-transactions')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions' },
        () => {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => fetchTransactions(), 500);
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      supabase.removeChannel(channel);
    };
  }, []);

  const handleOpenModal = (tx?: Transaction) => {
    if (tx) {
      setEditingTx(tx);
      setFormData({
        person: tx.person,
        username: tx.username || '',
        description: tx.description,
        amount: tx.amount,
        date: tx.date,
        notes: tx.notes || '',
      });
    } else {
      setEditingTx(null);
      setFormData({
        person: '',
        username: '',
        description: '',
        amount: 0,
        date: new Date().toISOString().split('T')[0],
        notes: '',
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingTx(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingTx) {
      const { error } = await supabase
        .from('transactions')
        .update({ ...formData, type: activeTab })
        .eq('id', editingTx.id);
      
      if (error) {
        console.error("Error updating:", error);
        alert(`حدث خطأ أثناء التعديل: ${error.message}`);
      }
    } else {
      const { error } = await supabase
        .from('transactions')
        .insert([{ ...formData, type: activeTab }]);
        
      if (error) {
        console.error("Error inserting:", error);
        alert(`حدث خطأ أثناء الإضافة: ${error.message}`);
      }
    }
    handleCloseModal();
  };

  const handleDeleteClick = (id: string) => {
    const skipWarning = localStorage.getItem('skipDeleteWarning') === 'true';
    if (skipWarning) {
      supabase.from('transactions').delete().eq('id', id).then(({ error }) => {
        if (error) console.error("Error deleting:", error);
      });
    } else {
      setItemToDelete(id);
    }
  };

  const confirmDelete = async () => {
    if (itemToDelete) {
      const { error } = await supabase
        .from('transactions')
        .delete()
        .eq('id', itemToDelete);
        
      if (error) console.error("Error deleting:", error);
      setItemToDelete(null);
    }
  };

  const filteredTransactions = useMemo(() => {
    return transactions
      .filter(t => t.type === activeTab)
      .filter(t =>
        (t.person || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.description || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, activeTab, searchQuery]);

  const currentMonthTotal = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    return transactions
      .filter(t => t.type === activeTab)
      .filter(t => {
        const d = new Date(t.date);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      })
      .reduce((sum, t) => sum + Number(t.amount), 0);
  }, [transactions, activeTab]);

  const allTimeTotal = useMemo(() => {
    return transactions
      .filter(t => t.type === activeTab)
      .reduce((sum, t) => sum + Number(t.amount), 0);
  }, [transactions, activeTab]);

  const isExpense = activeTab === 'expense';
  const ThemeIcon = isExpense ? TrendingDown : TrendingUp;
  const tabLabel = isExpense ? 'المصروفات' : 'الواردات';
  const personLabel = isExpense ? 'من قام بالصرف' : 'اسم الزبون';
  const descriptionLabel = isExpense ? 'التفاصيل (على ماذا؟)' : 'اسم المنتج';
  const amountLabel = isExpense ? 'المبلغ المصروف' : 'المبلغ الوارد';

  const colorClasses = isExpense 
    ? {
        bg: 'bg-red-600 dark:bg-red-500',
        hover: 'hover:bg-red-700 dark:hover:bg-red-600',
        text: 'text-red-600 dark:text-red-400',
        bgLight: 'bg-red-100 dark:bg-red-500/10',
        ring: 'focus:ring-red-500 dark:focus:ring-red-400'
      }
    : {
        bg: 'bg-green-600 dark:bg-green-500',
        hover: 'hover:bg-green-700 dark:hover:bg-green-600',
        text: 'text-green-600 dark:text-green-400',
        bgLight: 'bg-green-100 dark:bg-green-500/10',
        ring: 'focus:ring-green-500 dark:focus:ring-green-400'
      };

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-1 transition-colors duration-200">
        <button
          onClick={() => setActiveTab('expense')}
          className={`flex-1 flex items-center justify-center py-3 text-sm font-medium rounded-lg transition-colors ${
            isExpense ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400' : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700/50'
          }`}
        >
          <TrendingDown className="w-5 h-5 ml-2" />
          المصروفات
        </button>
        <button
          onClick={() => setActiveTab('income')}
          className={`flex-1 flex items-center justify-center py-3 text-sm font-medium rounded-lg transition-colors ${
            !isExpense ? 'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400' : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700/50'
          }`}
        >
          <TrendingUp className="w-5 h-5 ml-2" />
          الواردات
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="bg-white dark:bg-slate-800 overflow-hidden shadow-sm rounded-xl border border-gray-100 dark:border-slate-700 transition-colors duration-200">
          <div className="px-4 py-5 sm:p-6 flex items-center">
            <div className={`p-3 rounded-full ${colorClasses.bgLight} ${colorClasses.text} ml-4`}>
              <ThemeIcon className="w-8 h-8" />
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-slate-400 truncate">إجمالي {tabLabel} (الشهر الحالي)</dt>
              <dd className={`mt-1 text-3xl font-semibold ${colorClasses.text}`}>
                {currentMonthTotal.toLocaleString()} <span className="text-sm font-normal text-gray-500 dark:text-slate-500">د.ع</span>
              </dd>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 overflow-hidden shadow-sm rounded-xl border border-gray-100 dark:border-slate-700 transition-colors duration-200">
          <div className="px-4 py-5 sm:p-6 flex items-center">
            <div className={`p-3 rounded-full bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-400 ml-4`}>
              <DollarSign className="w-8 h-8" />
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-slate-400 truncate">إجمالي {tabLabel} (الكلي)</dt>
              <dd className="mt-1 text-3xl font-semibold text-gray-900 dark:text-white">
                {allTimeTotal.toLocaleString()} <span className="text-sm font-normal text-gray-500 dark:text-slate-500">د.ع</span>
              </dd>
            </div>
          </div>
        </div>
      </div>

      {/* Actions and List */}
      <div className="bg-white dark:bg-slate-800 shadow-sm rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden transition-colors duration-200">
        <div className="p-4 border-b border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="relative w-full sm:max-w-md">
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400 dark:text-slate-500" />
            </div>
            <input
              type="text"
              className="block w-full pl-3 pr-10 py-2 border border-gray-300 dark:border-slate-600 rounded-md leading-5 bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-gray-500 dark:placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              placeholder={`ابحث في ${tabLabel}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {role === 'admin' && (
            <button
              onClick={() => handleOpenModal()}
              className={`w-full sm:w-auto inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white ${colorClasses.bg} ${colorClasses.hover} shadow-sm transition-colors`}
            >
              <Plus className="w-5 h-5 ml-2 -mr-1" />
              إضافة {isExpense ? 'مصروف' : 'وارد'} جديد
            </button>
          )}
        </div>

        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-800/50">
              <tr>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">{personLabel}</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">التفاصيل</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">المبلغ</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">التاريخ</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">إجراءات</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center text-slate-500 dark:text-slate-400">
                    <div className="flex flex-col items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400 mb-4"></div>
                      <p className="text-lg font-medium text-slate-900 dark:text-white">جاري تحميل البيانات...</p>
                      <p className="text-sm mt-1">يتم الآن جلب معلومات المالية من السحابة.</p>
                    </div>
                  </td>
                </tr>
              ) : filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500 dark:text-slate-400">
                    لا توجد بيانات لعرضها. أضف {isExpense ? 'مصروفاً' : 'وارداً'} جديداً للبدء.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <div 
                          className={`flex items-center ${role === 'admin' ? 'cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors group' : ''}`}
                          onClick={() => role === 'admin' && handleOpenModal(tx)}
                        >
                          <User className={`w-4 h-4 ml-2 text-gray-400 dark:text-slate-500 ${role === 'admin' ? 'group-hover:text-blue-500 transition-colors' : ''}`} />
                          <span className={`text-sm font-medium text-gray-900 dark:text-white ${role === 'admin' ? 'group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors' : ''}`}>
                            {tx.person}
                          </span>
                        </div>
                        {tx.username && (
                          <div className="flex items-center mt-1 mr-6">
                            <span className="text-xs text-slate-500 dark:text-slate-400" dir="ltr">{tx.username}</span>
                          </div>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(`${tx.person}${tx.username ? `\n${tx.username}` : ''}`, tx.id);
                          }}
                          className="flex items-center gap-1 mt-2 mr-6 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                        >
                          {copiedId === tx.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          نسخ سريع
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900 dark:text-slate-200 whitespace-pre-wrap break-words min-w-[150px] max-w-[250px]">
                        {tx.description}
                      </div>
                      {tx.notes && (
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 whitespace-pre-wrap break-words min-w-[150px] max-w-[250px]">
                          {tx.notes}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`text-sm font-bold ${colorClasses.text} dark:opacity-90`}>
                        {Number(tx.amount).toLocaleString()} د.ع
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-slate-400">
                      <div className="flex items-center">
                        <Calendar className="w-4 h-4 ml-1.5 text-gray-400 dark:text-slate-500" />
                        {tx.date}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      {role === 'admin' && (
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handleOpenModal(tx)}
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 transition-colors"
                            title="تعديل"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteClick(tx.id)}
                            className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300 transition-colors"
                            title="حذف"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden divide-y divide-slate-200 dark:divide-slate-700">
          {isLoading ? (
            <div className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
              <div className="flex flex-col items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400 mb-4"></div>
                <p className="text-base font-medium text-slate-900 dark:text-white">جاري تحميل البيانات...</p>
              </div>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
              <div className="flex flex-col items-center justify-center">
                <ThemeIcon className="w-10 h-10 text-slate-300 dark:text-slate-600 mb-3" />
                <p className="text-base font-medium text-slate-900 dark:text-white">لا توجد سجلات</p>
              </div>
            </div>
          ) : (
            filteredTransactions.map((tx) => (
              <div key={tx.id} className="p-4 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-start">
                    <div className={`flex-shrink-0 h-10 w-10 rounded-xl flex items-center justify-center font-bold text-lg ${colorClasses.bgLight} ${colorClasses.text}`}>
                      <User className="w-5 h-5" />
                    </div>
                    <div className="ml-3 mr-3 mt-1">
                      <div 
                        className="text-sm font-bold text-slate-900 dark:text-white cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        onClick={() => handleOpenModal(tx)}
                      >
                        {tx.person}
                      </div>
                      {tx.username && (
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5" dir="ltr">
                          {tx.username}
                        </div>
                      )}
                      <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-1">
                        <Calendar className="w-3 h-3" />
                        {tx.date}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(`${tx.person}${tx.username ? `\n${tx.username}` : ''}`, `mob-${tx.id}`);
                        }}
                        className="flex items-center gap-1 mt-2 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                      >
                        {copiedId === `mob-${tx.id}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        نسخ الاسم واليوزر
                      </button>
                    </div>
                  </div>
                  {role === 'admin' && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenModal(tx)}
                        className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteClick(tx.id)}
                        className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
                
                <div className="mt-3 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400">المبلغ</span>
                    <span className={`font-bold ${colorClasses.text}`}>
                      {Number(tx.amount).toLocaleString()} د.ع
                    </span>
                  </div>
                  <div className="border-t border-slate-200 dark:border-slate-700 pt-2 mt-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">اسم المنتج</span>
                    <p className="text-sm font-medium text-slate-900 dark:text-white whitespace-pre-wrap break-words max-h-24 overflow-y-auto custom-scrollbar">{tx.description}</p>
                    {tx.notes && (
                      <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 border-dashed">
                        <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">ملاحظات</span>
                        <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words max-h-20 overflow-y-auto custom-scrollbar">{tx.notes}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-gray-900/40 dark:bg-slate-900/60 backdrop-blur-sm transition-opacity" aria-hidden="true" onClick={handleCloseModal}></div>
          
          <div className="relative bg-white dark:bg-slate-800 rounded-2xl text-right shadow-2xl w-full max-w-xl border border-gray-100 dark:border-slate-700 flex flex-col max-h-[95vh] animate-in fade-in zoom-in-95 duration-200 transition-colors">
            
            {/* Header */}
            <div className="bg-gray-50/80 dark:bg-slate-800/80 px-6 py-4 border-b border-gray-100 dark:border-slate-700 flex justify-between items-center shrink-0 rounded-t-2xl">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2" id="modal-title">
                {editingTx ? <Edit2 className="w-5 h-5 text-blue-600 dark:text-blue-400" /> : <Plus className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
                {editingTx ? `تعديل ${isExpense ? 'المصروف' : 'الوارد'}` : `إضافة ${isExpense ? 'مصروف' : 'وارد'} جديد`}
              </h3>
              <button onClick={handleCloseModal} className="text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors rounded-full p-1 hover:bg-gray-200 dark:hover:bg-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
              <div className="overflow-y-auto px-6 py-5 space-y-6">
                
                {/* Group 1: Details */}
                <div>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                    تفاصيل العملية
                  </h4>
                  <div className="bg-gray-50/50 dark:bg-slate-700/30 p-4 rounded-xl border border-gray-100 dark:border-slate-600 space-y-4">
                    <div>
                      <label htmlFor="person" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">{personLabel} <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        id="person"
                        required
                        className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                        value={formData.person}
                        onChange={(e) => setFormData({ ...formData, person: e.target.value })}
                        placeholder={isExpense ? "مثال: أحمد، شركة التوصيل..." : "مثال: Tony Redgrave"}
                      />
                    </div>
                    {!isExpense && (
                      <div>
                        <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">يوزر حساب الزبون <span className="text-gray-400 font-normal">(اختياري)</span></label>
                        <input
                          type="text"
                          id="username"
                          className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                          value={formData.username || ''}
                          onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                          placeholder="مثال: @user_name..."
                        />
                      </div>
                    )}
                    <div>
                      <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">{descriptionLabel} <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        id="description"
                        required
                        className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        placeholder={isExpense ? "مثال: شراء قرطاسية، دفع فاتورة..." : "مثال: اشتراك فلكس، حساب العاب..."}
                      />
                    </div>
                  </div>
                </div>

                {/* Group 2: Amount & Date */}
                <div>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                    المبلغ والتاريخ
                  </h4>
                  <div className="bg-gray-50/50 dark:bg-slate-700/30 p-4 rounded-xl border border-gray-100 dark:border-slate-600 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="amount" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">{amountLabel} <span className="text-red-500">*</span></label>
                      <div className="relative">
                        <input
                          type="number"
                          id="amount"
                          required
                          min="0"
                          step="any"
                          className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 pl-12 pr-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                          value={formData.amount || ''}
                          onChange={(e) => setFormData({ ...formData, amount: Number(e.target.value) })}
                        />
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <span className="text-gray-500 dark:text-slate-400 sm:text-sm">د.ع</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="date" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">التاريخ <span className="text-red-500">*</span></label>
                      <input
                        type="date"
                        id="date"
                        required
                        className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                        value={formData.date}
                        onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                {/* Group 3: Notes */}
                <div>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                    ملاحظات إضافية
                  </h4>
                  <div className="bg-gray-50/50 dark:bg-slate-700/30 p-4 rounded-xl border border-gray-100 dark:border-slate-600">
                    <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">ملاحظات <span className="text-gray-400 font-normal">(اختياري)</span></label>
                    <textarea
                      id="notes"
                      rows={2}
                      className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white custom-scrollbar"
                      value={formData.notes || ''}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      placeholder="أية ملاحظات إضافية حول العملية..."
                    />
                  </div>
                </div>

              </div>
              
              {/* Footer */}
              <div className="bg-gray-50 dark:bg-slate-800/80 px-6 py-4 border-t border-gray-100 dark:border-slate-700 sm:flex sm:flex-row-reverse gap-3 shrink-0 rounded-b-2xl">
                <button
                  type="submit"
                  className={`w-full inline-flex justify-center items-center rounded-lg border border-transparent shadow-sm px-5 py-2.5 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 sm:w-auto transition-colors ${colorClasses.bg} ${colorClasses.hover} ${colorClasses.ring}`}
                >
                  <CheckCircle className="w-4 h-4 ml-2" />
                  حفظ البيانات
                </button>
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="mt-3 w-full inline-flex justify-center items-center rounded-lg border border-gray-300 dark:border-slate-600 shadow-sm px-5 py-2.5 bg-white dark:bg-slate-700 text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:w-auto transition-colors"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDeleteModal 
        isOpen={itemToDelete !== null}
        onClose={() => setItemToDelete(null)}
        onConfirm={confirmDelete}
        title="تأكيد حذف العملية"
        message="هل أنت متأكد من حذف هذه العملية المالية؟ لا يمكن التراجع عن هذا الإجراء."
      />
    </div>
  );
}
