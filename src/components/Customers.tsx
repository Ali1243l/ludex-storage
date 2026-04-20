import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Edit2, Trash2, Search, Users, User, AtSign, Calendar, FileText, CheckCircle, X, ShoppingBag } from 'lucide-react';
import { Customer, Purchase } from '../types';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import { supabase } from '../supabaseClient';
import { useAuth } from '../AuthContext';

const generateId = () => Math.random().toString(36).substring(2, 9);

export default function Customers() {
  const { role } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const [formData, setFormData] = useState<Omit<Customer, 'id' | 'customer_number'>>({
    name: '',
    username: '',
    customer_code: '',
    purchases: [],
    notes: '',
  });

  useEffect(() => {
    // 1. دالة تجيب البيانات أول ما يفتح البرنامج
    const fetchCustomers = async () => {
      setIsLoading(true);
      const { data, error } = await supabase.from('customers').select('*');
      if (data) setCustomers(data as Customer[]);
      if (error) console.error("Error fetching:", error);
      setIsLoading(false);
    };

    fetchCustomers();

    // 2. نشغل ميزة التحديث التلقائي (Real-time)
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: '*', // يشمل الإضافة، التعديل، والحذف
          schema: 'public',
          table: 'customers' // خلي اسم الجدول مالتك هنا
        },
        (payload) => {
          console.log('صار تغيير بالبيانات!', payload);
          // نحدث الواجهة فوراً من يصير تغيير
          fetchCustomers();
        }
      )
      .subscribe();

    // تنظيف الاشتراك من المستخدم يطلع من الصفحة حتى ما يصير ثقل بالبرنامج
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleOpenModal = (customer?: Customer) => {
    if (customer) {
      setEditingCustomer(customer);
      setFormData({
        name: customer.name,
        username: customer.username,
        customer_code: customer.customer_code || '',
        purchases: customer.purchases ? [...customer.purchases] : [],
        notes: customer.notes || '',
      });
    } else {
      setEditingCustomer(null);
      setFormData({
        name: '',
        username: '',
        customer_code: '',
        purchases: [],
        notes: '',
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingCustomer(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const sanitizedUsername = formData.username ? formData.username.replace('@', '').trim().toLowerCase() : null;
    const sanitizedName = formData.name ? formData.name.trim() : '';

    if (editingCustomer) {
      const { error } = await supabase
        .from('customers')
        .update({ ...formData, username: sanitizedUsername, name: sanitizedName })
        .eq('id', editingCustomer.id);
      
      if (error) {
        console.error("Error updating:", error);
        alert(`حدث خطأ أثناء التعديل: ${error.message}`);
      }
    } else {
      // Get max customer_number to generate the next one
      const { data: maxData } = await supabase
        .from('customers')
        .select('customer_number')
        .not('customer_number', 'is', null)
        .order('customer_number', { ascending: false })
        .limit(1);
      
      let nextNumber = 1;
      if (maxData && maxData.length > 0 && maxData[0].customer_number) {
        nextNumber = maxData[0].customer_number + 1;
      }

      let finalCustomerCode = formData.customer_code;
      if (!finalCustomerCode || finalCustomerCode.trim() === '') {
         finalCustomerCode = 'C' + Math.random().toString(36).substring(2, 6).toUpperCase() + Math.floor(Math.random() * 1000);
      }

      const payload = {
        name: sanitizedName,
        username: sanitizedUsername,
        purchases: formData.purchases,
        notes: formData.notes,
        customer_code: finalCustomerCode,
        customer_number: nextNumber
      };

      const { error } = await supabase
        .from('customers')
        .insert([payload]);
        
      if (error) {
        console.error("Error inserting:", error);
        alert(`حدث خطأ أثناء الإضافة: ${error.message}`);
      }
    }
    handleCloseModal();
  };

  const handleDeleteClick = (id: string | undefined) => {
    if (!id) return;
    
    const skipWarning = localStorage.getItem('skipDeleteWarning') === 'true';
    if (skipWarning) {
      // Delete directly
      supabase.from('customers').delete().eq('id', id).then(({ error }) => {
        if (error) {
          console.error("Error deleting:", error);
          alert(`حدث خطأ أثناء الحذف: ${error.message}`);
        }
      });
    } else {
      setItemToDelete(id);
    }
  };

  const confirmDelete = async () => {
    if (itemToDelete !== null && itemToDelete !== undefined) {
      const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', itemToDelete);
        
      if (error) {
        console.error("Error deleting:", error);
        alert(`حدث خطأ أثناء الحذف: ${error.message}`);
      }
      setItemToDelete(null);
    } else {
      setItemToDelete(null);
    }
  };

  const handleAddPurchase = () => {
    setFormData(prev => ({
      ...prev,
      purchases: [
        ...prev.purchases,
        { id: generateId(), date: new Date().toISOString().split('T')[0], details: '' }
      ]
    }));
  };

  const handleUpdatePurchase = (id: string, field: keyof Purchase, value: string) => {
    setFormData(prev => ({
      ...prev,
      purchases: prev.purchases.map(p => p.id === id ? { ...p, [field]: value } : p)
    }));
  };

  const handleRemovePurchase = (id: string) => {
    setFormData(prev => ({
      ...prev,
      purchases: prev.purchases.filter(p => p.id !== id)
    }));
  };

  const filteredCustomers = useMemo(() => {
    return customers
      .filter(c =>
        (c.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.username || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.notes || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.customer_number?.toString() || '').includes(searchQuery)
      )
      .sort((a, b) => {
        // Sort by latest purchase date
        const aPurchases = a.purchases || [];
        const bPurchases = b.purchases || [];
        const aLast = aPurchases.length > 0 ? Math.max(...aPurchases.map(p => new Date(p.date).getTime())) : 0;
        const bLast = bPurchases.length > 0 ? Math.max(...bPurchases.map(p => new Date(p.date).getTime())) : 0;
        return bLast - aLast;
      });
  }, [customers, searchQuery]);

  const stats = useMemo(() => {
    const totalCustomers = customers.length;
    const totalPurchases = customers.reduce((sum, c) => sum + (c.purchases?.length || 0), 0);
    return { totalCustomers, totalPurchases };
  }, [customers]);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="bg-white dark:bg-slate-800 overflow-hidden shadow-sm rounded-xl border border-gray-100 dark:border-slate-700 transition-colors duration-200">
          <div className="px-4 py-5 sm:p-6 flex items-center">
            <div className="p-3 rounded-full bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 ml-4">
              <Users className="w-8 h-8" />
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-slate-400 truncate">إجمالي الزبائن</dt>
              <dd className="mt-1 text-3xl font-semibold text-blue-600 dark:text-blue-400">{stats.totalCustomers}</dd>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 overflow-hidden shadow-sm rounded-xl border border-gray-100 dark:border-slate-700 transition-colors duration-200">
          <div className="px-4 py-5 sm:p-6 flex items-center">
            <div className="p-3 rounded-full bg-purple-100 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 ml-4">
              <ShoppingBag className="w-8 h-8" />
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-slate-400 truncate">إجمالي عمليات الشراء</dt>
              <dd className="mt-1 text-3xl font-semibold text-purple-600 dark:text-purple-400">{stats.totalPurchases}</dd>
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
              className="block w-full pl-3 pr-10 py-2 border border-gray-300 dark:border-slate-600 rounded-md leading-5 bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-gray-500 dark:placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-colors"
              placeholder="ابحث عن زبون، يوزر، أو ملاحظة..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {role === 'admin' && (
            <button
              onClick={() => handleOpenModal()}
              className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors"
            >
              <Plus className="w-5 h-5 ml-2 -mr-1" />
              إضافة زبون جديد
            </button>
          )}
        </div>

        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-800/50">
              <tr>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">التسلسل (ID)</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">اسم الزبون</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">يوزر الحساب</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">كود الزبون</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">عدد المرات</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">آخر شراء</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">الملاحظات</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">إجراءات</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center text-slate-500 dark:text-slate-400">
                    <div className="flex flex-col items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400 mb-4"></div>
                      <p className="text-lg font-medium text-slate-900 dark:text-white">جاري تحميل البيانات...</p>
                      <p className="text-sm mt-1">يتم الآن جلب معلومات الزبائن من السحابة.</p>
                    </div>
                  </td>
                </tr>
              ) : filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center text-slate-500 dark:text-slate-400">
                    <div className="flex flex-col items-center justify-center">
                      <Users className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-4" />
                      <p className="text-lg font-medium text-slate-900 dark:text-white">لا يوجد زبائن</p>
                      <p className="text-sm mt-1">أضف زبوناً جديداً للبدء في إدارة زبائنك.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((customer) => {
                  const purchases = customer.purchases || [];
                  const lastPurchase = purchases.length > 0 
                    ? [...purchases].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
                    : null;

                  return (
                    <tr key={customer.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-sm font-medium bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-slate-200">
                          #{customer.customer_number || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div 
                          className={`flex items-center ${role === 'admin' ? 'cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors group' : ''}`}
                          onClick={() => role === 'admin' && handleOpenModal(customer)}
                        >
                          <User className={`w-4 h-4 ml-2 text-gray-400 dark:text-slate-500 ${role === 'admin' ? 'group-hover:text-blue-500 transition-colors' : ''}`} />
                          <span className={`text-sm font-medium text-gray-900 dark:text-white ${role === 'admin' ? 'group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors' : ''}`}>{customer.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm text-gray-500 dark:text-slate-400">
                          <AtSign className="w-4 h-4 ml-1 text-gray-400 dark:text-slate-500" />
                          <span dir="ltr" className="text-right">{customer.username || '-'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-slate-400 font-mono">
                        {customer.customer_code || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-500/10 text-blue-800 dark:text-blue-400">
                          {purchases.length} مرات
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-slate-400">
                        {lastPurchase ? (
                          <div className="flex items-center">
                            <Calendar className="w-4 h-4 ml-1.5 text-gray-400 dark:text-slate-500" />
                            {lastPurchase.date}
                          </div>
                        ) : (
                          <span className="text-gray-400 dark:text-slate-600">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900 dark:text-slate-300 whitespace-pre-wrap break-words min-w-[150px] max-w-[250px] max-h-24 overflow-y-auto custom-scrollbar">
                          {customer.notes || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        {role === 'admin' && (
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => handleOpenModal(customer)}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 transition-colors"
                              title="تعديل"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteClick(customer.id)}
                              className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300 transition-colors"
                              title="حذف"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
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
          ) : filteredCustomers.length === 0 ? (
            <div className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
              <div className="flex flex-col items-center justify-center">
                <Users className="w-10 h-10 text-slate-300 dark:text-slate-600 mb-3" />
                <p className="text-base font-medium text-slate-900 dark:text-white">لا يوجد زبائن</p>
              </div>
            </div>
          ) : (
            filteredCustomers.map((customer) => {
              const purchases = customer.purchases || [];
              const lastPurchase = purchases.length > 0 
                ? [...purchases].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
                : null;

              return (
                <div key={customer.id} className="p-4 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-start">
                      <div className="flex-shrink-0 h-10 w-10 bg-blue-100 dark:bg-blue-500/20 rounded-xl flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-lg">
                        <User className="w-5 h-5" />
                      </div>
                      <div className="ml-3 mr-3">
                        <div 
                          className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                          onClick={() => handleOpenModal(customer)}
                        >
                          {customer.name}
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-slate-200">
                            #{customer.customer_number || '-'}
                          </span>
                        </div>
                        {customer.username && (
                          <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5" dir="ltr">
                            <AtSign className="w-3 h-3" />
                            {customer.username}
                          </span>
                        )}
                      </div>
                    </div>
                    {role === 'admin' && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleOpenModal(customer)}
                          className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteClick(customer.id)}
                          className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 mt-3 text-xs bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 dark:text-slate-400">عدد المرات</span>
                      <span className="font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 px-2 py-0.5 rounded">
                        {purchases.length}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 dark:text-slate-400">آخر شراء</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {lastPurchase ? lastPurchase.date : '-'}
                      </span>
                    </div>
                  </div>
                  
                  {customer.notes && (
                    <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap break-words max-h-24 overflow-y-auto custom-scrollbar">
                      <span className="font-medium text-slate-700 dark:text-slate-300 ml-1">ملاحظات:</span>
                      {customer.notes}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-gray-900/40 dark:bg-slate-900/60 backdrop-blur-sm transition-opacity" aria-hidden="true" onClick={handleCloseModal}></div>
          
          <div className="relative bg-white dark:bg-slate-800 rounded-2xl text-right shadow-2xl w-full max-w-2xl border border-gray-100 dark:border-slate-700 flex flex-col max-h-[95vh] animate-in fade-in zoom-in-95 duration-200 transition-colors">
            
            {/* Header */}
            <div className="bg-gray-50/80 dark:bg-slate-800/80 px-6 py-4 border-b border-gray-100 dark:border-slate-700 flex justify-between items-center shrink-0 rounded-t-2xl">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2" id="modal-title">
                {editingCustomer ? <Edit2 className="w-5 h-5 text-blue-600 dark:text-blue-400" /> : <Plus className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
                {editingCustomer ? 'تعديل بيانات الزبون' : 'إضافة زبون جديد'}
              </h3>
              <button onClick={handleCloseModal} className="text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors rounded-full p-1 hover:bg-gray-200 dark:hover:bg-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
              <div className="overflow-y-auto px-6 py-5 space-y-6">
                
                {/* Group 1: Basic Info */}
                <div>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <User className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                    المعلومات الأساسية
                  </h4>
                  <div className="bg-gray-50/50 dark:bg-slate-700/30 p-4 rounded-xl border border-gray-100 dark:border-slate-600 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">اسم الزبون <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        id="name"
                        required
                        className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="مثال: محمد علي"
                      />
                    </div>
                    <div>
                      <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">يوزر الحساب</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <AtSign className="h-4 w-4 text-gray-400 dark:text-slate-500" />
                        </div>
                        <input
                          type="text"
                          id="username"
                          dir="ltr"
                          className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 pl-10 pr-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-left"
                          value={formData.username}
                          onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                          placeholder="username"
                        />
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor="customer_code" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">كود الزبون (اختياري)</label>
                      <input
                        type="text"
                        id="customer_code"
                        dir="ltr"
                        className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-left"
                        value={formData.customer_code}
                        onChange={(e) => setFormData({ ...formData, customer_code: e.target.value })}
                        placeholder="كود خاص للبحث عنه بسرعة..."
                      />
                      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">يمكنك استخدام هذا الكود في سجل المبيعات لربط الشراء بهذا الزبون مباشرة بدلاً من دقة الاسم او اليوزر.</p>
                    </div>
                  </div>
                </div>

                {/* Group 2: Purchases */}
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-2">
                      <ShoppingBag className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                      سجل المشتريات
                    </h4>
                    <button
                      type="button"
                      onClick={handleAddPurchase}
                      className="inline-flex items-center text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20 px-2.5 py-1.5 rounded-md transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5 ml-1" />
                      إضافة شراء
                    </button>
                  </div>
                  
                  <div className="space-y-3">
                    {formData.purchases.length === 0 ? (
                      <div className="text-center py-6 bg-gray-50/50 dark:bg-slate-700/30 rounded-xl border border-gray-100 dark:border-slate-600 border-dashed">
                        <p className="text-sm text-gray-500 dark:text-slate-400">لم يتم إضافة أي مشتريات بعد.</p>
                      </div>
                    ) : (
                      formData.purchases.map((purchase, index) => (
                        <div key={purchase.id} className="flex items-start gap-3 bg-white dark:bg-slate-800 p-3 rounded-xl border border-gray-200 dark:border-slate-600 shadow-sm relative group">
                          <div className="absolute -right-2 -top-2 bg-blue-100 dark:bg-blue-500/20 text-blue-800 dark:text-blue-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-500/30">
                            {index + 1}
                          </div>
                          <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="sm:col-span-1">
                              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">تاريخ الشراء</label>
                              <input
                                type="date"
                                required
                                className="block w-full border border-gray-300 dark:border-slate-600 rounded-md shadow-sm py-1.5 px-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                                value={purchase.date}
                                onChange={(e) => handleUpdatePurchase(purchase.id, 'date', e.target.value)}
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">التفاصيل (المنتج)</label>
                              <input
                                type="text"
                                required
                                className="block w-full border border-gray-300 dark:border-slate-600 rounded-md shadow-sm py-1.5 px-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                                value={purchase.details}
                                onChange={(e) => handleUpdatePurchase(purchase.id, 'details', e.target.value)}
                                placeholder="مثال: اشتراك نتفليكس شهر"
                              />
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemovePurchase(purchase.id)}
                            className="mt-5 text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-colors p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10"
                            title="حذف هذا الشراء"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Group 3: Notes */}
                <div>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                    ملاحظات عامة
                  </h4>
                  <div className="bg-gray-50/50 dark:bg-slate-700/30 p-4 rounded-xl border border-gray-100 dark:border-slate-600">
                    <textarea
                      id="notes"
                      rows={3}
                      className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white resize-none"
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      placeholder="أي ملاحظات إضافية حول الزبون، طريقة الدفع المفضلة، إلخ..."
                    ></textarea>
                  </div>
                </div>

              </div>
              
              {/* Footer */}
              <div className="bg-gray-50 dark:bg-slate-800/80 px-6 py-4 border-t border-gray-100 dark:border-slate-700 sm:flex sm:flex-row-reverse gap-3 shrink-0 rounded-b-2xl">
                <button
                  type="submit"
                  className="w-full inline-flex justify-center items-center rounded-lg border border-transparent shadow-sm px-5 py-2.5 bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:w-auto transition-colors"
                >
                  <CheckCircle className="w-4 h-4 ml-2" />
                  حفظ بيانات الزبون
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
        title="تأكيد حذف الزبون"
        message="هل أنت متأكد من حذف هذا الزبون؟ لا يمكن التراجع عن هذا الإجراء."
      />
    </div>
  );
}
