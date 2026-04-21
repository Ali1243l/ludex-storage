import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Edit2, Trash2, Search, Users, User, AtSign, Calendar, FileText, CheckCircle, X, ShoppingBag } from 'lucide-react';
import { Customer } from '../types';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import { supabase } from '../supabaseClient';
import { useAuth } from '../AuthContext';

const generateId = () => Math.random().toString(36).substring(2, 9);

export default function Customers() {
  const { role } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salesRecord, setSalesRecord] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const [formData, setFormData] = useState<Omit<Customer, 'id' | 'customer_number' | 'purchases'>>({
    name: '',
    username: '',
    customer_code: '',
    notes: '',
  });

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      const [{ data: cData }, { data: sData }] = await Promise.all([
        supabase.from('customers').select('*'),
        supabase.from('sales').select('customerUsername, customerCode, date, productName, price, id')
      ]);
      if (cData) setCustomers(cData as Customer[]);
      if (sData) setSalesRecord(sData);
      setIsLoading(false);
    };

    fetchData();

    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'customers' },
        () => fetchData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sales' },
        () => fetchData()
      )
      .subscribe();

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
        notes: customer.notes || '',
      });
    } else {
      setEditingCustomer(null);
      setFormData({
        name: '',
        username: '',
        customer_code: '',
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

    const sanitizedUsername = formData.username ? formData.username.replace(/@/g, '').trim().toLowerCase() : null;
    const sanitizedName = formData.name ? formData.name.trim() : '';

    if (editingCustomer) {
      const { error } = await supabase
        .from('customers')
        .update({ 
           ...formData, 
           username: sanitizedUsername, 
           name: sanitizedName
        })
        .eq('id', editingCustomer.id);
      
      if (error) {
        console.error("Error updating:", error);
        alert(`حدث خطأ أثناء التعديل: ${error.message}`);
      }
    } else {
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

  // Attach relational sales data to customers
  const customersWithDerivedSales = useMemo(() => {
     // Create hash maps for faster lookup O(1) instead of O(N) filtering
     const salesByUsername = new Map();
     const salesByCode = new Map();
     
     salesRecord.forEach(sale => {
       if (sale.customerUsername) {
         const uname = sale.customerUsername.replace(/@/g, '').trim().toLowerCase();
         if (!salesByUsername.has(uname)) salesByUsername.set(uname, []);
         salesByUsername.get(uname).push(sale);
       }
       if (sale.customerCode) {
         const code = sale.customerCode.trim().toLowerCase();
         if (!salesByCode.has(code)) salesByCode.set(code, []);
         salesByCode.get(code).push(sale);
       }
     });

     return customers.map(customer => {
        const cUsername = (customer.username || '').replace(/@/g, '').trim().toLowerCase();
        const cCode = (customer.customer_code || '').trim().toLowerCase();
        
        let theirSales: any[] = [];
        const seenSales = new Set();
        
        // Add sales matched by username
        if (cUsername && salesByUsername.has(cUsername)) {
          salesByUsername.get(cUsername).forEach((sale: any) => {
             if (!seenSales.has(sale.id)) {
                seenSales.add(sale.id);
                theirSales.push(sale);
             }
          });
        }
        
        // Add sales matched by code
        if (cCode && salesByCode.has(cCode)) {
          salesByCode.get(cCode).forEach((sale: any) => {
             if (!seenSales.has(sale.id)) {
                seenSales.add(sale.id);
                theirSales.push(sale);
             }
          });
        }

        // Get count and latest date
        const purchaseCount = theirSales.length;
        let lastPurchaseDate = null;
        let purchaseHistory = [];
        
        if (purchaseCount > 0) {
           const sortedSales = [...theirSales].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
           lastPurchaseDate = sortedSales[0].date;
           purchaseHistory = sortedSales; // Store full sorted history
        }

        return {
           ...customer,
           derivedPurchaseCount: purchaseCount,
           derivedLastPurchase: lastPurchaseDate,
           purchaseHistory: purchaseHistory, // Add to customer object
        };
     });
  }, [customers, salesRecord]);


  const filteredCustomers = useMemo(() => {
    return customersWithDerivedSales
      .filter((c: any) =>
        (c.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.username || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.notes || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.customer_number?.toString() || '').includes(searchQuery)
      )
      .sort((a: any, b: any) => {
        const aDate = a.derivedLastPurchase ? new Date(a.derivedLastPurchase).getTime() : 0;
        const bDate = b.derivedLastPurchase ? new Date(b.derivedLastPurchase).getTime() : 0;
        
        if (aDate === 0 && bDate === 0) {
           return (b.customer_number || 0) - (a.customer_number || 0);
        }
        
        return bDate - aDate;
      });
  }, [customersWithDerivedSales, searchQuery]);

  const stats = useMemo(() => {
    const totalCustomers = customers.length;
    let totalPurchases = 0;
    // We can just sum up the derived counts
    customersWithDerivedSales.forEach((c: any) => { totalPurchases += c.derivedPurchaseCount; });
    return { totalCustomers, totalPurchases };
  }, [customersWithDerivedSales, customers.length]);

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
              <dt className="text-sm font-medium text-gray-500 dark:text-slate-400 truncate">إجمالي المشتريات المرتبطة</dt>
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
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">عدد المرات ذكياً</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">تاريخ آخر مبيعة</th>
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
                      <p className="text-sm mt-1">يتم الفحص والربط الذكي مع المبيعات...</p>
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
                filteredCustomers.map((customer: any) => {
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
                          {customer.derivedPurchaseCount} مرات
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-slate-400">
                        {customer.derivedLastPurchase ? (
                          <div className="flex items-center">
                            <Calendar className="w-4 h-4 ml-1.5 text-gray-400 dark:text-slate-500" />
                            {customer.derivedLastPurchase}
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
                 <p className="text-base font-medium text-slate-900 dark:text-white">جاري الفحص الذكي...</p>
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
            filteredCustomers.map((customer: any) => {
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
                      <span className="text-slate-500 dark:text-slate-400">المرات</span>
                      <span className="font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 px-2 py-0.5 rounded">
                        {customer.derivedPurchaseCount}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 dark:text-slate-400">آخر شراء</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {customer.derivedLastPurchase || '-'}
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
          
          <div className="relative bg-white dark:bg-slate-800 rounded-2xl text-right shadow-2xl w-full max-w-lg border border-gray-100 dark:border-slate-700 flex flex-col animate-in fade-in zoom-in-95 duration-200 transition-colors">
            
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

            <form onSubmit={handleSubmit} className="flex flex-col">
              <div className="px-6 py-5 space-y-6">
                
                {/* Group 1: Basic Info */}
                <div>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <User className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                    المعلومات الأساسية
                  </h4>
                  <div className="bg-gray-50/50 dark:bg-slate-700/30 p-4 rounded-xl border border-gray-100 dark:border-slate-600 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                       <div className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 p-2 text-center rounded-lg mb-2">
                          انتباه: المشتريات التابعة لهذا الزبون تتم مزامنتها وربطها تلقائياً بالكامل من صفحة (المبيعات).
                       </div>
                    </div>
                    <div className="sm:col-span-2">
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
                    <div>
                      <label htmlFor="customer_code" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">كود الزبون</label>
                      <input
                        type="text"
                        id="customer_code"
                        dir="ltr"
                        className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-left"
                        value={formData.customer_code}
                        onChange={(e) => setFormData({ ...formData, customer_code: e.target.value })}
                        placeholder="يولد تلقائيا..."
                      />
                    </div>
                  </div>
                </div>

                {/* Group 2: Notes */}
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

                {/* Group 3: Purchase History */}
                {editingCustomer && (editingCustomer as any).purchaseHistory && (editingCustomer as any).purchaseHistory.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                      <ShoppingBag className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                      سجل المشتريات
                    </h4>
                    <div className="bg-gray-50/50 dark:bg-slate-700/30 p-4 rounded-xl border border-gray-100 dark:border-slate-600 max-h-60 overflow-y-auto">
                       <ul className="divide-y divide-gray-200 dark:divide-slate-600/50">
                          {(editingCustomer as any).purchaseHistory.map((purchase: any, idx: number) => (
                             <li key={purchase.id || idx} className="py-3 flex justify-between items-center text-sm">
                               <div className="flex flex-col">
                                 <span className="font-medium text-gray-900 dark:text-white">
                                    {purchase.productName || 'منتج غير معروف'}
                                 </span>
                                 <span className="text-xs text-gray-500 dark:text-slate-400">
                                    {purchase.date ? new Date(purchase.date).toLocaleDateString('ar-IQ') : '-'}
                                 </span>
                               </div>
                               <div className="text-emerald-600 dark:text-emerald-400 font-semibold text-right flex flex-col items-end">
                                 {purchase.price ? purchase.price.toLocaleString('en-US') + ' د.ع' : '-'}
                               </div>
                             </li>
                          ))}
                       </ul>
                    </div>
                  </div>
                )}

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
