import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Edit2, Trash2, Search, ShoppingCart, User, AtSign, Calendar, Tag, CheckCircle, X, FileText, DollarSign, Link as LinkIcon, ExternalLink } from 'lucide-react';
import { SaleRecord } from '../types';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import { supabase } from '../supabaseClient';
import { useAuth } from '../AuthContext';

const generateId = () => Math.random().toString(36).substring(2, 9);

export type ProductLinkObj = { url: string; originalPrice?: number | ''; finalPrice?: number };

const parseLinks = (linksStr?: string): ProductLinkObj[] => {
  if (!linksStr) return [];
  try {
    const parsed = JSON.parse(linksStr);
    if (Array.isArray(parsed)) {
      return parsed.map(item => {
        if (typeof item === 'string') return { url: item };
        return item;
      });
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.links)) {
      return parsed.links.map((item: any) => {
        if (typeof item === 'string') return { url: item };
        return item;
      });
    }
    return [{ url: linksStr }];
  } catch (e) {
    return [{ url: linksStr }];
  }
};

export default function Sales() {
  const { role } = useAuth();
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [customersList, setCustomersList] = useState<{name: string, username: string}[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<SaleRecord | null>(null);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const [formData, setFormData] = useState<Omit<SaleRecord, 'id' | 'productLink'> & { productLinks: ProductLinkObj[] }>({
    customerName: '',
    customerUsername: '',
    date: new Date().toISOString().split('T')[0],
    productName: '',
    price: 0,
    notes: '',
    productLinks: [],
  });

  useEffect(() => {
    const fetchSales = async () => {
      setIsLoading(true);
      const { data, error } = await supabase.from('sales').select('*');
      if (data) setSales(data as SaleRecord[]);
      if (error) console.error("Error fetching sales:", error);
      
      const { data: cData } = await supabase.from('customers').select('name, username');
      if (cData) setCustomersList(cData as {name: string, username: string}[]);

      setIsLoading(false);
    };

    fetchSales();

    const channel = supabase
      .channel('schema-db-changes-sales')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sales' },
        (payload) => {
          fetchSales();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleOpenModal = (sale?: SaleRecord) => {
    if (sale) {
      setEditingSale(sale);
      setFormData({
        customerName: sale.customerName,
        customerUsername: sale.customerUsername,
        date: sale.date,
        productName: sale.productName,
        price: sale.price,
        notes: sale.notes,
        productLinks: parseLinks(sale.productLink),
      });
    } else {
      setEditingSale(null);
      setFormData({
        customerName: '',
        customerUsername: '',
        date: new Date().toISOString().split('T')[0],
        productName: '',
        price: 0,
        notes: '',
        productLinks: [],
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingSale(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const dataToSubmit = {
      customerName: formData.customerName,
      customerUsername: formData.customerUsername,
      date: formData.date,
      productName: formData.productName,
      price: formData.price,
      notes: formData.notes,
      productLink: JSON.stringify(formData.productLinks.filter(l => l.url.trim() !== '')),
    };

    if (editingSale) {
      const { error } = await supabase
        .from('sales')
        .update(dataToSubmit)
        .eq('id', editingSale.id);
      
      if (error) {
        console.error("Error updating:", error);
        alert(`حدث خطأ أثناء التعديل: ${error.message}`);
      }
    } else {
      const { error } = await supabase
        .from('sales')
        .insert([dataToSubmit]);
        
      if (error) {
        console.error("Error inserting:", error);
        alert(`حدث خطأ أثناء الإضافة: ${error.message}`);
      } else {
        // Sync with customers
        if (formData.customerUsername || formData.customerName) {
           try {
             let query = supabase.from('customers').select('*');
             
             let searchUsername = formData.customerUsername ? formData.customerUsername.replace('@', '').trim() : '';
             let searchName = formData.customerName ? formData.customerName.trim() : '';

             if (searchUsername) {
               query = query.eq('username', searchUsername);
             } else if (searchName) {
               query = query.eq('name', searchName);
             }
             
             const { data: existingCustomers, error: fetchErr } = await query.limit(1);
             if (fetchErr) console.error("Error fetching matching customer:", fetchErr);

             const detailsString = `${formData.productName} | السعر: ${formData.price}${formData.notes ? ' | ملاحظات: ' + formData.notes : ''}`;
             const purchaseInfo = { id: generateId(), date: formData.date, details: detailsString };

             if (existingCustomers && existingCustomers.length > 0) {
                 const customer = existingCustomers[0];
                 const updatedPurchases = customer.purchases ? [...customer.purchases, purchaseInfo] : [purchaseInfo];
                 const { error: updErr } = await supabase.from('customers').update({ purchases: updatedPurchases }).eq('id', customer.id);
                 if (updErr) console.error("Error updating customer purchases:", updErr);
             } else {
                 const { data: maxData } = await supabase.from('customers').select('customer_number').not('customer_number', 'is', null).order('customer_number', { ascending: false }).limit(1);
                 let nextNumber = 1;
                 if (maxData && maxData.length > 0 && maxData[0].customer_number) nextNumber = maxData[0].customer_number + 1;
                 
                 const { error: insErr } = await supabase.from('customers').insert([{
                     name: searchName || 'زبون غير معروف',
                     username: searchUsername || '',
                     customer_number: nextNumber,
                     purchases: [purchaseInfo],
                     notes: 'تمت الإضافة تلقائياً من سجل البيع'
                 }]);
                 if (insErr) console.error("Error inserting new customer from sales:", insErr);
             }
           } catch (err) {
             console.error("Sync error:", err);
           }
        }
      }
    }
    handleCloseModal();
  };

  const handleDeleteClick = (id: string) => {
    const skipWarning = localStorage.getItem('skipDeleteWarning') === 'true';
    if (skipWarning) {
      supabase.from('sales').delete().eq('id', id).then(({ error }) => {
        if (error) console.error("Error deleting:", error);
      });
    } else {
      setItemToDelete(id);
    }
  };

  const confirmDelete = async () => {
    if (itemToDelete) {
      const { error } = await supabase
        .from('sales')
        .delete()
        .eq('id', itemToDelete);
        
      if (error) console.error("Error deleting:", error);
      setItemToDelete(null);
    }
  };

  const filteredSales = useMemo(() => {
    return sales
      .filter(s =>
        (s.customerName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.customerUsername || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.productName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.notes || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [sales, searchQuery]);

  const stats = useMemo(() => {
    const totalSales = sales.length;
    const totalRevenue = sales.reduce((sum, s) => sum + s.price, 0);
    return { totalSales, totalRevenue };
  }, [sales]);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="bg-white dark:bg-slate-800 overflow-hidden shadow-sm rounded-xl border border-gray-100 dark:border-slate-700 transition-colors duration-200">
          <div className="px-4 py-5 sm:p-6 flex items-center">
            <div className="p-3 rounded-full bg-orange-100 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 ml-4">
              <ShoppingCart className="w-8 h-8" />
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-slate-400 truncate">إجمالي عمليات البيع</dt>
              <dd className="mt-1 text-3xl font-semibold text-orange-600 dark:text-orange-400">{stats.totalSales}</dd>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 overflow-hidden shadow-sm rounded-xl border border-gray-100 dark:border-slate-700 transition-colors duration-200">
          <div className="px-4 py-5 sm:p-6 flex items-center">
            <div className="p-3 rounded-full bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ml-4">
              <DollarSign className="w-8 h-8" />
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-slate-400 truncate">إجمالي الإيرادات</dt>
              <dd className="mt-1 text-3xl font-semibold text-emerald-600 dark:text-emerald-400">
                {stats.totalRevenue.toLocaleString()} <span className="text-sm font-normal text-gray-500 dark:text-slate-500">د.ع</span>
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
              className="block w-full pl-3 pr-10 py-2 border border-gray-300 dark:border-slate-600 rounded-md leading-5 bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-gray-500 dark:placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-colors"
              placeholder="ابحث عن زبون، منتج، أو ملاحظة..."
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
              إضافة سجل بيع
            </button>
          )}
        </div>

        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-800/50">
              <tr>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">الزبون</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">المنتج</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">السعر</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">التاريخ</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">ملاحظات</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">إجراءات</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
              {filteredSales.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-slate-400">
                    لا توجد بيانات لعرضها. أضف سجل بيع جديد للبدء.
                  </td>
                </tr>
              ) : (
                filteredSales.map((sale) => (
                  <tr key={sale.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span 
                          className={`text-sm font-medium text-gray-900 dark:text-white flex items-center gap-1.5 ${role === 'admin' ? 'cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors' : ''}`}
                          onClick={() => role === 'admin' && handleOpenModal(sale)}
                        >
                          <User className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
                          {sale.customerName}
                        </span>
                        {sale.customerUsername && (
                          <span className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1 mt-1" dir="ltr">
                            <AtSign className="w-3 h-3 text-gray-400 dark:text-slate-500" />
                            {sale.customerUsername}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center text-sm text-gray-900 dark:text-white">
                        <Tag className="w-4 h-4 ml-1.5 text-gray-400 dark:text-slate-500" />
                        {sale.productName}
                        <div className="flex items-center mr-2 gap-1">
                          {parseLinks(sale.productLink).map((link, idx) => (
                            <a 
                              key={idx}
                              href={link.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                              title={`فتح الرابط ${idx + 1}`}
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          ))}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-400">
                        {Number(sale.price).toLocaleString()} د.ع
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-slate-400">
                      <div className="flex items-center">
                        <Calendar className="w-4 h-4 ml-1.5 text-gray-400 dark:text-slate-500" />
                        {sale.date}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900 dark:text-slate-300 whitespace-pre-wrap break-words min-w-[150px] max-w-[250px] max-h-24 overflow-y-auto custom-scrollbar">
                        {sale.notes || '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      {role === 'admin' && (
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handleOpenModal(sale)}
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 transition-colors"
                            title="تعديل"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteClick(sale.id)}
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
          {filteredSales.length === 0 ? (
            <div className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
              <div className="flex flex-col items-center justify-center">
                <ShoppingCart className="w-10 h-10 text-slate-300 dark:text-slate-600 mb-3" />
                <p className="text-base font-medium text-slate-900 dark:text-white">لا توجد سجلات بيع</p>
              </div>
            </div>
          ) : (
            filteredSales.map((sale) => (
              <div key={sale.id} className="p-4 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-start">
                    <div className="flex-shrink-0 h-10 w-10 bg-emerald-100 dark:bg-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold text-lg">
                      <User className="w-5 h-5" />
                    </div>
                    <div className="ml-3 mr-3">
                      <div 
                        className="text-sm font-bold text-slate-900 dark:text-white cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        onClick={() => handleOpenModal(sale)}
                      >
                        {sale.customerName}
                      </div>
                      {sale.customerUsername && (
                        <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5" dir="ltr">
                          <AtSign className="w-3 h-3" />
                          {sale.customerUsername}
                        </span>
                      )}
                    </div>
                  </div>
                  {role === 'admin' && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenModal(sale)}
                        className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteClick(sale.id)}
                        className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
                
                <div className="grid grid-cols-2 gap-2 mt-3 text-xs bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 block mb-1">السعر</span>
                    <span className="font-medium text-slate-700 dark:text-slate-300">{Number(sale.price).toLocaleString()} د.ع</span>
                  </div>
                  <div className="col-span-2 pt-2 mt-1 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                    <span className="text-slate-500 dark:text-slate-400">المنتج</span>
                    <span className="font-medium text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
                      {sale.productName}
                      <div className="flex items-center gap-1">
                        {parseLinks(sale.productLink).map((link, idx) => (
                          <a 
                            key={idx}
                            href={link.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ))}
                      </div>
                    </span>
                  </div>
                </div>
                
                <div className="mt-3 flex flex-col gap-2 text-xs">
                  <div className="flex items-center text-slate-500 dark:text-slate-400">
                    <Calendar className="w-3.5 h-3.5 ml-1" />
                    {sale.date}
                  </div>
                  {sale.notes && <div className="text-slate-500 dark:text-slate-400 whitespace-pre-wrap break-words max-h-24 overflow-y-auto custom-scrollbar">{sale.notes}</div>}
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
                {editingSale ? <Edit2 className="w-5 h-5 text-blue-600 dark:text-blue-400" /> : <Plus className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
                {editingSale ? 'تعديل سجل البيع' : 'إضافة سجل بيع جديد'}
              </h3>
              <button onClick={handleCloseModal} className="text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors rounded-full p-1 hover:bg-gray-200 dark:hover:bg-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
              <div className="overflow-y-auto px-6 py-5 space-y-6">
                
                {/* Group 1: Customer Info */}
                <div>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <User className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                    معلومات الزبون
                  </h4>
                  <div className="bg-gray-50/50 dark:bg-slate-700/30 p-4 rounded-xl border border-gray-100 dark:border-slate-600 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="customerName" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">اسم الزبون <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        id="customerName"
                        required
                        list="customersNamesList"
                        className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                        value={formData.customerName}
                        onChange={(e) => {
                          const val = e.target.value;
                          const found = customersList.find(c => c.name.toLowerCase() === val.toLowerCase());
                          setFormData({ 
                            ...formData, 
                            customerName: val,
                            customerUsername: found && found.username ? found.username : formData.customerUsername
                          });
                        }}
                        placeholder="مثال: محمد علي"
                      />
                      <datalist id="customersNamesList">
                        {customersList.map((c, idx) => <option key={`name-${idx}`} value={c.name} />)}
                      </datalist>
                    </div>
                    <div>
                      <label htmlFor="customerUsername" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">يوزر الزبون</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <AtSign className="h-4 w-4 text-gray-400 dark:text-slate-500" />
                        </div>
                        <input
                          type="text"
                          id="customerUsername"
                          dir="ltr"
                          list="customersUsernamesList"
                          className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 pl-10 pr-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-left"
                          value={formData.customerUsername}
                          onChange={(e) => {
                            const val = e.target.value.replace('@', '');
                            const found = customersList.find(c => c.username && c.username.toLowerCase() === val.toLowerCase());
                            setFormData({ 
                              ...formData, 
                              customerUsername: val,
                              customerName: found ? found.name : formData.customerName
                            });
                          }}
                          placeholder="username"
                        />
                        <datalist id="customersUsernamesList">
                          {customersList.map((c, idx) => c.username ? <option key={`user-${idx}`} value={c.username}>{c.name}</option> : null)}
                        </datalist>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Group 2: Purchase Details */}
                <div>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                    تفاصيل الشراء
                  </h4>
                  <div className="bg-gray-50/50 dark:bg-slate-700/30 p-4 rounded-xl border border-gray-100 dark:border-slate-600 space-y-4">
                    <div>
                      <label htmlFor="productName" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">المنتج (ماذا اشترى؟) <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        id="productName"
                        required
                        className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                        value={formData.productName}
                        onChange={(e) => setFormData({ ...formData, productName: e.target.value })}
                        placeholder="مثال: اشتراك نتفليكس شهر"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1.5">
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">روابط المنتج (الحد الأقصى 5)</label>
                        {formData.productLinks.length < 5 && (
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, productLinks: [...formData.productLinks, { url: '' }] })}
                            className="inline-flex items-center text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20 px-2 py-1 rounded transition-colors"
                          >
                            <Plus className="w-3 h-3 ml-1" />
                            إضافة رابط
                          </button>
                        )}
                      </div>
                      <div className="space-y-2">
                        {formData.productLinks.length === 0 && (
                          <p className="text-xs text-gray-500 dark:text-slate-400">لا توجد روابط مضافة.</p>
                        )}
                        {formData.productLinks.map((link, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <div className="relative flex-1">
                              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <LinkIcon className="h-4 w-4 text-gray-400 dark:text-slate-500" />
                              </div>
                              <input
                                type="url"
                                dir="ltr"
                                className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 pl-10 pr-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-left"
                                value={link.url}
                                onChange={(e) => {
                                  const newLinks = [...formData.productLinks];
                                  newLinks[index].url = e.target.value;
                                  setFormData({ ...formData, productLinks: newLinks });
                                }}
                                placeholder="https://example.com/product"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const newLinks = formData.productLinks.filter((_, i) => i !== index);
                                setFormData({ ...formData, productLinks: newLinks });
                              }}
                              className="p-2 text-gray-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 transition-colors rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="price" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">السعر (بكم اشترى؟) <span className="text-red-500">*</span></label>
                        <div className="relative">
                          <input
                            type="number"
                            id="price"
                            required
                            min="0"
                            step="any"
                            className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 pl-12 pr-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                            value={formData.price || ''}
                            onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
                          />
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <span className="text-gray-500 dark:text-slate-400 sm:text-sm">د.ع</span>
                          </div>
                        </div>
                      </div>
                      <div>
                        <label htmlFor="date" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">تاريخ الشراء <span className="text-red-500">*</span></label>
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
                </div>

                {/* Group 3: Notes */}
                <div>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                    ملاحظات
                  </h4>
                  <div className="bg-gray-50/50 dark:bg-slate-700/30 p-4 rounded-xl border border-gray-100 dark:border-slate-600">
                    <textarea
                      id="notes"
                      rows={2}
                      className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white resize-none"
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      placeholder="أي ملاحظات إضافية..."
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
                  حفظ السجل
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
        title="تأكيد حذف السجل"
        message="هل أنت متأكد من حذف هذا السجل؟ لا يمكن التراجع عن هذا الإجراء."
      />
    </div>
  );
}
