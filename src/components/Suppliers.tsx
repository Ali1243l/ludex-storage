import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Edit2, Trash2, Search, Store, Link as LinkIcon, FileText, CheckCircle, X, ExternalLink } from 'lucide-react';
import { Supplier } from '../types';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import { supabase } from '../supabaseClient';
import { useAuth } from '../AuthContext';

export default function Suppliers() {
  const { role } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const [formData, setFormData] = useState<Omit<Supplier, 'id'>>({
    name: '',
    profile_link: '',
    notes: '',
  });

  useEffect(() => {
    const fetchSuppliers = async () => {
      setIsLoading(true);
      const { data, error } = await supabase.from('suppliers').select('*').order('created_at', { ascending: false });
      if (data) setSuppliers(data as Supplier[]);
      if (error) console.error("Error fetching suppliers:", error);
      setIsLoading(false);
    };

    fetchSuppliers();

    const channel = supabase
      .channel('schema-db-changes-suppliers')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'suppliers' },
        () => {
          fetchSuppliers();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleOpenModal = (supplier?: Supplier) => {
    if (supplier) {
      setEditingSupplier(supplier);
      setFormData({
        name: supplier.name,
        profile_link: supplier.profile_link,
        notes: supplier.notes || '',
      });
    } else {
      setEditingSupplier(null);
      setFormData({
        name: '',
        profile_link: '',
        notes: '',
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingSupplier(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingSupplier) {
      const { error } = await supabase
        .from('suppliers')
        .update({ ...formData })
        .eq('id', editingSupplier.id);
      
      if (error) {
        console.error("Error updating supplier:", error);
        alert(`حدث خطأ أثناء التعديل: ${error.message}`);
      }
    } else {
      const { error } = await supabase
        .from('suppliers')
        .insert([{ ...formData }]);
        
      if (error) {
        console.error("Error inserting supplier:", error);
        alert(`حدث خطأ أثناء الإضافة: ${error.message}`);
      }
    }
    handleCloseModal();
  };

  const handleDeleteClick = (id: string) => {
    const skipWarning = localStorage.getItem('skipDeleteWarning') === 'true';
    if (skipWarning) {
      supabase.from('suppliers').delete().eq('id', id).then(({ error }) => {
        if (error) {
          console.error("Error deleting supplier:", error);
          alert(`حدث خطأ أثناء الحذف: ${error.message}`);
        }
      });
    } else {
      setItemToDelete(id);
    }
  };

  const confirmDelete = async () => {
    if (itemToDelete) {
      const { error } = await supabase
        .from('suppliers')
        .delete()
        .eq('id', itemToDelete);
        
      if (error) {
        console.error("Error deleting supplier:", error);
        alert(`حدث خطأ أثناء الحذف: ${error.message}`);
      }
      setItemToDelete(null);
    }
  };

  const filteredSuppliers = useMemo(() => {
    return suppliers.filter(s =>
      (s.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.notes || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.profile_link || '').toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [suppliers, searchQuery]);

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header & Stats */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-1">
        <div className="bg-white dark:bg-slate-800 overflow-hidden shadow-sm rounded-xl border border-gray-100 dark:border-slate-700 transition-colors duration-200">
          <div className="px-4 py-5 sm:p-6 flex items-center">
            <div className="p-3 rounded-full bg-indigo-100 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ml-4">
              <Store className="w-8 h-8" />
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-slate-400 truncate">إجمالي الموردين</dt>
              <dd className="mt-1 text-3xl font-semibold text-indigo-600 dark:text-indigo-400">{suppliers.length}</dd>
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
              className="block w-full pl-3 pr-10 py-2 border border-gray-300 dark:border-slate-600 rounded-md leading-5 bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-gray-500 dark:placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors"
              placeholder="ابحث عن مورد، رابط، أو ملاحظة..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {role === 'admin' && (
            <button
              onClick={() => handleOpenModal()}
              className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors"
            >
              <Plus className="w-5 h-5 ml-2 -mr-1" />
              إضافة مورد جديد
            </button>
          )}
        </div>

        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-800/50">
              <tr>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">اسم المورد</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">رابط البروفايل</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">الملاحظات</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">إجراءات</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-16 text-center text-slate-500 dark:text-slate-400">
                    <div className="flex flex-col items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 dark:border-indigo-400 mb-4"></div>
                      <p className="text-lg font-medium text-slate-900 dark:text-white">جاري تحميل البيانات...</p>
                    </div>
                  </td>
                </tr>
              ) : filteredSuppliers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-16 text-center text-slate-500 dark:text-slate-400">
                    <div className="flex flex-col items-center justify-center">
                      <Store className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-4" />
                      <p className="text-lg font-medium text-slate-900 dark:text-white">لا يوجد موردين</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredSuppliers.map((supplier) => (
                  <tr key={supplier.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Store className="w-4 h-4 ml-2 text-gray-400 dark:text-slate-500" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{supplier.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <a 
                        href={supplier.profile_link} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-900 dark:hover:text-indigo-300 transition-colors"
                      >
                        <ExternalLink className="w-4 h-4 ml-1.5" />
                        فتح البروفايل
                      </a>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900 dark:text-slate-300 whitespace-pre-wrap break-words min-w-[150px] max-w-[300px] max-h-24 overflow-y-auto custom-scrollbar">
                        {supplier.notes || '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      {role === 'admin' && (
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handleOpenModal(supplier)}
                            className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-900 dark:hover:text-indigo-300 transition-colors"
                            title="تعديل"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteClick(supplier.id)}
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
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 dark:border-indigo-400 mx-auto mb-4"></div>
              <p className="text-base font-medium text-slate-900 dark:text-white">جاري تحميل البيانات...</p>
            </div>
          ) : filteredSuppliers.length === 0 ? (
            <div className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
              <Store className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-base font-medium text-slate-900 dark:text-white">لا يوجد موردين</p>
            </div>
          ) : (
            filteredSuppliers.map((supplier) => (
              <div key={supplier.id} className="p-4 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-10 w-10 bg-indigo-100 dark:bg-indigo-500/20 rounded-xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-lg">
                      <Store className="w-5 h-5" />
                    </div>
                    <div className="ml-3 mr-3">
                      <div className="text-sm font-bold text-slate-900 dark:text-white">{supplier.name}</div>
                    </div>
                  </div>
                  {role === 'admin' && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenModal(supplier)}
                        className="p-1.5 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteClick(supplier.id)}
                        className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
                
                <div className="mt-3">
                  <a 
                    href={supplier.profile_link} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-3 py-2 rounded-lg w-full justify-center font-medium"
                  >
                    <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
                    فتح بروفايل المورد
                  </a>
                </div>
                
                {supplier.notes && (
                  <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap break-words bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg">
                    <span className="font-medium text-slate-700 dark:text-slate-300 ml-1">ملاحظات:</span>
                    {supplier.notes}
                  </div>
                )}
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
                {editingSupplier ? <Edit2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" /> : <Plus className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
                {editingSupplier ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}
              </h3>
              <button onClick={handleCloseModal} className="text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors rounded-full p-1 hover:bg-gray-200 dark:hover:bg-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
              <div className="overflow-y-auto px-6 py-5 space-y-6">
                
                {/* Basic Info */}
                <div>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <Store className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                    المعلومات الأساسية
                  </h4>
                  <div className="bg-gray-50/50 dark:bg-slate-700/30 p-4 rounded-xl border border-gray-100 dark:border-slate-600 space-y-4">
                    <div>
                      <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">اسم المورد <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        id="name"
                        required
                        className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="مثال: علي إكسبرس"
                      />
                    </div>
                    <div>
                      <label htmlFor="profile_link" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">رابط البروفايل <span className="text-red-500">*</span></label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <LinkIcon className="h-4 w-4 text-gray-400 dark:text-slate-500" />
                        </div>
                        <input
                          type="url"
                          id="profile_link"
                          required
                          dir="ltr"
                          className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 pl-10 pr-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-left"
                          value={formData.profile_link}
                          onChange={(e) => setFormData({ ...formData, profile_link: e.target.value })}
                          placeholder="https://example.com/profile"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                    ملاحظات
                  </h4>
                  <div className="bg-gray-50/50 dark:bg-slate-700/30 p-4 rounded-xl border border-gray-100 dark:border-slate-600">
                    <textarea
                      id="notes"
                      rows={3}
                      className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white resize-none"
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      placeholder="أي ملاحظات إضافية حول المورد..."
                    ></textarea>
                  </div>
                </div>

              </div>
              
              {/* Footer */}
              <div className="bg-gray-50 dark:bg-slate-800/80 px-6 py-4 border-t border-gray-100 dark:border-slate-700 sm:flex sm:flex-row-reverse gap-3 shrink-0 rounded-b-2xl">
                <button
                  type="submit"
                  className="w-full inline-flex justify-center items-center rounded-lg border border-transparent shadow-sm px-5 py-2.5 bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:w-auto transition-colors"
                >
                  <CheckCircle className="w-4 h-4 ml-2" />
                  حفظ بيانات المورد
                </button>
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="mt-3 w-full inline-flex justify-center items-center rounded-lg border border-gray-300 dark:border-slate-600 shadow-sm px-5 py-2.5 bg-white dark:bg-slate-700 text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:w-auto transition-colors"
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
        title="تأكيد حذف المورد"
        message="هل أنت متأكد من حذف هذا المورد؟ لا يمكن التراجع عن هذا الإجراء."
      />
    </div>
  );
}
