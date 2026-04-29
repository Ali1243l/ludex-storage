import React, { useState, useEffect, useMemo } from 'react';
import Sessions from './components/Sessions';
import { Plus, Edit2, Trash2, Search, Calendar, AlertCircle, CheckCircle, Package, X, Wallet, LayoutDashboard, Users, Box, ShoppingCart, Moon, Sun, Settings, LogOut, Store, Activity, Copy, Check, Key, AtSign } from 'lucide-react';
import { Subscription } from './types';
import Transactions from './components/Transactions';
import Customers from './components/Customers';
import Products from './components/Products';
import Sales from './components/Sales';
import Suppliers from './components/Suppliers';
import SettingsPage from './components/Settings';
import UsersPage from './components/Users';
import ConfirmDeleteModal from './components/ConfirmDeleteModal';
import { supabase } from './supabaseClient';
import { useAuth } from './AuthContext';
import Login from './components/Login';

// Helper to generate unique IDs
const generateId = () => Math.random().toString(36).substring(2, 9);

// Helper to calculate days remaining
const getDaysRemaining = (expirationDate: string) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expDate = new Date(expirationDate);
  const diffTime = expDate.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

export default function App() {
  const { role, token, logout, isApproved } = useAuth();
  const [activePage, setActivePage] = useState<'subscriptions' | 'finances' | 'customers' | 'products' | 'sales' | 'settings' | 'suppliers' | 'users' | 'sessions'>('subscriptions');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('darkMode');
      if (saved !== null) return saved === 'true';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', isDarkMode.toString());
  }, [isDarkMode]);

  const toggleDarkMode = () => setIsDarkMode(!isDarkMode);

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('expirationDate_asc');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<Subscription | null>(null);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState<Omit<Subscription, 'id'>>({
    name: '',
    activationDate: '',
    expirationDate: '',
    notes: '',
    category: 'عام',
    account_username: '',
    account_password: '',
  });

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  useEffect(() => {
    let isMounted = true;
    
    const fetchSubscriptions = async () => {
      if (!isMounted) return;
      setIsLoading(true);
      try {
        const { data, error } = await supabase.from('subscriptions').select('*').order('id', { ascending: false });
        if (!isMounted) return;
        if (data) setSubscriptions(data as Subscription[]);
        if (error) console.error("Error fetching subscriptions:", error);
      } catch(e) {
        console.error("Critical fetch error:", e);
      }
      if (isMounted) setIsLoading(false);
    };

    fetchSubscriptions();

    let timeoutId: NodeJS.Timeout;
    
    const channel = supabase
      .channel('schema-db-changes-subscriptions')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'subscriptions' },
        () => {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => fetchSubscriptions(), 500);
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      supabase.removeChannel(channel);
    };
  }, []);

  const handleOpenModal = (sub?: Subscription) => {
    if (sub) {
      setEditingSub(sub);
      setFormData({
        name: sub.name,
        activationDate: sub.activationDate || '',
        expirationDate: sub.expirationDate || '',
        notes: sub.notes,
        category: sub.category,
        account_username: sub.account_username || '',
        account_password: sub.account_password || '',
      });
    } else {
      setEditingSub(null);
      setFormData({
        name: '',
        activationDate: new Date().toISOString().split('T')[0],
        expirationDate: '',
        notes: '',
        category: 'عام',
        account_username: '',
        account_password: '',
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingSub(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const payload = {
        ...formData,
        activationDate: formData.activationDate || null,
        expirationDate: formData.expirationDate || null,
    };

    if (editingSub) {
      const { error } = await supabase
        .from('subscriptions')
        .update(payload)
        .eq('id', editingSub.id);
      
      if (error) {
        console.error("Error updating:", error);
        alert(`حدث خطأ أثناء التعديل: ${error.message}`);
      }
    } else {
      const { error } = await supabase
        .from('subscriptions')
        .insert([payload]);
        
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
      supabase.from('subscriptions').delete().eq('id', id).then(({ error }) => {
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
    if (itemToDelete) {
      const { error } = await supabase
        .from('subscriptions')
        .delete()
        .eq('id', itemToDelete);
        
      if (error) {
        console.error("Error deleting:", error);
        alert(`حدث خطأ أثناء الحذف: ${error.message}`);
      }
      setItemToDelete(null);
    }
  };

  const categories = useMemo(() => {
    const cats = new Set(subscriptions.map(s => s.category).filter(Boolean));
    return Array.from(cats).sort();
  }, [subscriptions]);

  const filteredSubscriptions = useMemo(() => {
    let filtered = subscriptions.filter(sub => {
      const matchSearch = (sub.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (sub.notes || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchCategory = selectedCategory === '' || sub.category === selectedCategory;
      return matchSearch && matchCategory;
    });

    return filtered.sort((a, b) => {
      if (sortBy === 'name_asc') return (a.name || '').localeCompare(b.name || '');
      if (sortBy === 'name_desc') return (b.name || '').localeCompare(a.name || '');
      if (sortBy === 'activationDate_asc') return new Date(a.activationDate || 0).getTime() - new Date(b.activationDate || 0).getTime();
      if (sortBy === 'activationDate_desc') return new Date(b.activationDate || 0).getTime() - new Date(a.activationDate || 0).getTime();
      if (sortBy === 'expirationDate_desc') return new Date(b.expirationDate || 0).getTime() - new Date(a.expirationDate || 0).getTime();
      
      const dateDiff = new Date(a.expirationDate || 0).getTime() - new Date(b.expirationDate || 0).getTime();
      if (dateDiff === 0) {
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      }
      return dateDiff;
    });
  }, [subscriptions, searchQuery, selectedCategory, sortBy]);

  const stats = useMemo(() => {
    let active = 0;
    let expired = 0;
    let expiringSoon = 0; // within 7 days

    subscriptions.forEach(sub => {
      const days = getDaysRemaining(sub.expirationDate);
      if (days < 0) {
        expired++;
      } else if (days <= 7) {
        expiringSoon++;
        active++;
      } else {
        active++;
      }
    });

    return { total: subscriptions.length, active, expired, expiringSoon };
  }, [subscriptions]);

  const getStatusBadge = (expirationDate: string) => {
    const days = getDaysRemaining(expirationDate);
    if (days < 0) {
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-500/10 text-red-800 dark:text-red-400"><AlertCircle className="w-3 h-3 ml-1" /> منتهي</span>;
    }
    if (days <= 7) {
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 dark:bg-yellow-500/10 text-yellow-800 dark:text-yellow-400"><AlertCircle className="w-3 h-3 ml-1" /> ينتهي قريباً ({days} أيام)</span>;
    }
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-500/10 text-green-800 dark:text-green-400"><CheckCircle className="w-3 h-3 ml-1" /> فعال ({days} أيام)</span>;
  };

  const navItems = [
    { id: 'subscriptions', label: 'الحسابات', icon: LayoutDashboard },
    { id: 'products', label: 'المنتجات', icon: Box },
    { id: 'sales', label: 'سجل البيع', icon: ShoppingCart },
    { id: 'customers', label: 'الزبائن', icon: Users },
    { id: 'finances', label: 'المالية', icon: Wallet },
    ...(role === 'admin' ? [
      { id: 'suppliers', label: 'الموردين', icon: Store },
      { id: 'users', label: 'المستخدمين', icon: Users },
      { id: 'sessions', label: 'سجل الدخول', icon: Activity },
      { id: 'settings', label: 'الإعدادات', icon: Settings }
    ] : []),
  ] as const;

  if (!token || !role || role === 'pending' || !isApproved) {
    return <Login />;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col md:flex-row transition-colors duration-200" dir="rtl">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 sticky top-0 h-screen shrink-0 z-10 transition-colors duration-200">
        <div className="p-6 flex items-center justify-between border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-start leading-none justify-center" dir="ltr">
              <span className="text-4xl font-black text-blue-600 dark:text-blue-500 tracking-tighter" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>Pixel</span>
              <span className="text-sm font-bold text-amber-500 tracking-widest ml-1">store</span>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActivePage(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
                  isActive 
                    ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 shadow-sm' 
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-100 dark:border-slate-700 space-y-2">
          <button
            onClick={toggleDarkMode}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white transition-all duration-200"
          >
            {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            {isDarkMode ? 'الوضع النهاري' : 'الوضع الليلي'}
          </button>
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all duration-200"
          >
            <LogOut className="w-5 h-5" />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="md:hidden bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-20 transition-colors duration-200">
        <div className="px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-start leading-none justify-center" dir="ltr">
              <span className="text-2xl font-black text-blue-600 dark:text-blue-500 tracking-tighter" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>Pixel</span>
              <span className="text-[10px] font-bold text-amber-500 tracking-widest ml-0.5">store</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleDarkMode}
              className="p-2 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button
              onClick={logout}
              className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
              title="تسجيل الخروج"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 pb-20 md:pb-0 min-w-0">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
        {activePage === 'subscriptions' ? (
          <>
            {/* Stats */}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-4 mb-8">
              <div className="bg-white dark:bg-slate-800 overflow-hidden shadow-sm rounded-2xl border border-slate-200 dark:border-slate-700 transition-colors duration-200">
                <div className="px-5 py-6">
                  <dt className="text-sm font-medium text-slate-500 dark:text-slate-400 truncate">إجمالي الحسابات</dt>
                  <dd className="mt-2 text-3xl font-bold text-slate-900 dark:text-white">{stats.total}</dd>
                </div>
              </div>
              <div className="bg-white dark:bg-slate-800 overflow-hidden shadow-sm rounded-2xl border border-slate-200 dark:border-slate-700 transition-colors duration-200">
                <div className="px-5 py-6">
                  <dt className="text-sm font-medium text-slate-500 dark:text-slate-400 truncate">النشطة حالياً</dt>
                  <dd className="mt-2 text-3xl font-bold text-emerald-600 dark:text-emerald-400">{stats.active}</dd>
                </div>
              </div>
              <div className="bg-white dark:bg-slate-800 overflow-hidden shadow-sm rounded-2xl border border-slate-200 dark:border-slate-700 transition-colors duration-200">
                <div className="px-5 py-6">
                  <dt className="text-sm font-medium text-slate-500 dark:text-slate-400 truncate">تنتهي قريباً (أقل من 7 أيام)</dt>
                  <dd className="mt-2 text-3xl font-bold text-amber-500 dark:text-amber-400">{stats.expiringSoon}</dd>
                </div>
              </div>
              <div className="bg-white dark:bg-slate-800 overflow-hidden shadow-sm rounded-2xl border border-slate-200 dark:border-slate-700 transition-colors duration-200">
                <div className="px-5 py-6">
                  <dt className="text-sm font-medium text-slate-500 dark:text-slate-400 truncate">منتهية الصلاحية</dt>
                  <dd className="mt-2 text-3xl font-bold text-red-600 dark:text-red-400">{stats.expired}</dd>
                </div>
              </div>
            </div>

            {/* Actions and List */}
            <div className="bg-white dark:bg-slate-800 shadow-sm rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden transition-colors duration-200">
              <div className="p-5 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto flex-1">
                  <div className="relative w-full sm:max-w-md">
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                      <Search className="h-5 w-5 text-slate-400 dark:text-slate-500" />
                    </div>
                    <input
                      type="text"
                      className="block w-full pl-3 pr-10 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl leading-5 bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-all"
                      placeholder="ابحث عن حساب، ملاحظة..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                  <div className="w-full sm:w-48">
                    <select
                      className="block w-full py-2.5 px-3 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-all"
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                    >
                      <option value="">كل التصنيفات</option>
                      {categories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                  <div className="w-full sm:w-48">
                    <select
                      className="block w-full py-2.5 px-3 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-all"
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                    >
                      <option value="expirationDate_asc">الانتهاء (الأقرب)</option>
                      <option value="expirationDate_desc">الانتهاء (الأبعد)</option>
                      <option value="activationDate_desc">التفعيل (الأحدث)</option>
                      <option value="activationDate_asc">التفعيل (الأقدم)</option>
                      <option value="name_asc">الاسم (أ-ي)</option>
                      <option value="name_desc">الاسم (ي-أ)</option>
                    </select>
                  </div>
                </div>
                {role === 'admin' && (
                  <button
                    onClick={() => handleOpenModal()}
                    className="w-full sm:w-auto inline-flex items-center justify-center px-5 py-2.5 border border-transparent text-sm font-medium rounded-xl text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-all active:scale-[0.98]"
                  >
                    <Plus className="w-5 h-5 ml-2 -mr-1" />
                    إضافة حساب جديد
                  </button>
                )}
              </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-800/50">
                <tr>
                  <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">اسم الحساب</th>
                  <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">التصنيف</th>
                  <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">تاريخ التفعيل</th>
                  <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">تاريخ الانتهاء</th>
                  <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">الحالة والتاريخ</th>
                  <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">حالة البيع (المخزون)</th>
                  <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">إجراءات</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center text-slate-500 dark:text-slate-400">
                      <div className="flex flex-col items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400 mb-4"></div>
                        <p className="text-lg font-medium text-slate-900 dark:text-white">جاري تحميل البيانات...</p>
                        <p className="text-sm mt-1">يتم الآن جلب معلومات الحسابات من السحابة.</p>
                      </div>
                    </td>
                  </tr>
                ) : filteredSubscriptions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center text-slate-500 dark:text-slate-400">
                      <div className="flex flex-col items-center justify-center">
                        <Package className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-4" />
                        <p className="text-lg font-medium text-slate-900 dark:text-white">لا توجد حسابات</p>
                        <p className="text-sm mt-1">أضف حساباً جديداً للبدء في إدارتها.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredSubscriptions.map((sub) => (
                    <tr key={sub.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-10 w-10 bg-blue-100 dark:bg-blue-500/20 rounded-xl flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-lg">
                            {sub.name.charAt(0)}
                          </div>
                          <div className="ml-4 mr-4 flex flex-col">
                            <div 
                              className="text-sm font-bold text-slate-900 dark:text-white cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                              onClick={() => handleOpenModal(sub)}
                            >
                              {sub.name}
                            </div>
                            {sub.notes && <div className="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap break-words mt-0.5 max-h-24 overflow-y-auto custom-scrollbar max-w-[250px]">{sub.notes}</div>}
                            {(sub.account_username || sub.account_password) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopyText(`اسم الحساب: ${sub.name}\nيوزر: ${sub.account_username || 'لا يوجد'}\nرمز: ${sub.account_password || 'لا يوجد'}`, `desk-${sub.id}`);
                                }}
                                className="flex w-fit items-center gap-1 mt-2 text-xs text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                              >
                                {copiedId === `desk-${sub.id}` ? <Check className="w-3.5 h-3.5 text-blue-500" /> : <Copy className="w-3.5 h-3.5" />}
                                <span className={copiedId === `desk-${sub.id}` ? "text-blue-600 dark:text-blue-400" : ""}>نسخ الحساب</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200">
                          {sub.category}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-400">
                        <div className="flex items-center">
                          <Calendar className="w-4 h-4 ml-1.5 text-slate-400 dark:text-slate-500" />
                          {sub.activationDate}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-400">
                        <div className="flex items-center">
                          <Calendar className="w-4 h-4 ml-1.5 text-slate-400 dark:text-slate-500" />
                          {sub.expirationDate}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(sub.expirationDate)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${sub.status === 'مباع' ? 'bg-blue-100 text-blue-800' : sub.status === 'منتهي' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
                            {sub.status || 'غير مباع'}
                          </span>
                          <span className="text-xs text-slate-500">
                            مباع: {sub.sell_count || 0} مرات
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        {role === 'admin' && (
                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleOpenModal(sub)}
                              className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-colors"
                              title="تعديل"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteClick(sub.id)}
                              className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
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
            ) : filteredSubscriptions.length === 0 ? (
              <div className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
                <div className="flex flex-col items-center justify-center">
                  <Package className="w-10 h-10 text-slate-300 dark:text-slate-600 mb-3" />
                  <p className="text-base font-medium text-slate-900 dark:text-white">لا توجد حسابات</p>
                </div>
              </div>
            ) : (
              filteredSubscriptions.map((sub) => (
                <div key={sub.id} className="p-4 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors flex flex-col gap-3">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-12 w-12 bg-blue-100 dark:bg-blue-500/20 rounded-xl flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-xl">
                        {sub.name.charAt(0)}
                      </div>
                      <div className="ml-3 mr-3">
                        <div 
                          className="text-base font-bold text-slate-900 dark:text-white cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                          onClick={() => handleOpenModal(sub)}
                        >
                          {sub.name}
                        </div>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 mt-1">
                          {sub.category}
                        </span>
                      </div>
                    </div>
                    <div>{getStatusBadge(sub.expirationDate)}</div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-700/50">
                    <div className="flex items-center">
                      <Calendar className="w-3.5 h-3.5 ml-1.5 text-slate-400 dark:text-slate-500 shrink-0" />
                      <span className="truncate">تفعيل: {sub.activationDate || '-'}</span>
                    </div>
                    <div className="flex items-center">
                      <Calendar className="w-3.5 h-3.5 ml-1.5 text-slate-400 dark:text-slate-500 shrink-0" />
                      <span className="truncate">انتهاء: {sub.expirationDate || '-'}</span>
                    </div>
                    <div className="flex items-center col-span-2">
                       <span className="text-slate-400 dark:text-slate-500 ml-2 shrink-0">حالة المخزون:</span>
                       <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ml-2 ${sub.status === 'مباع' ? 'bg-blue-100 text-blue-800' : sub.status === 'منتهي' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
                         {sub.status || 'غير مباع'}
                       </span>
                       <span className="text-xs text-slate-500">
                         مباع ({sub.sell_count || 0}) مرة
                       </span>
                    </div>
                  </div>

                  {(sub.account_username || sub.account_password) && (
                    <div className="bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-lg p-2.5 text-sm flex flex-col gap-1.5">
                       {sub.account_username && (
                         <div className="flex items-center text-slate-700 dark:text-slate-300">
                           <span className="text-gray-500 dark:text-slate-400 text-xs ml-2 w-8 shrink-0">يوزر:</span>
                           <span className="font-medium truncate" dir="ltr">{sub.account_username}</span>
                         </div>
                       )}
                       {sub.account_password && (
                         <div className="flex items-center text-slate-700 dark:text-slate-300">
                           <span className="text-gray-500 dark:text-slate-400 text-xs ml-2 w-8 shrink-0">رمز:</span>
                           <span className="font-medium truncate" dir="ltr">{sub.account_password}</span>
                         </div>
                       )}
                    </div>
                  )}
                  
                  {sub.notes && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap break-words bg-gray-50 dark:bg-slate-800 p-2.5 rounded-lg border border-gray-100 dark:border-slate-700/50">
                      {sub.notes}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-100 dark:border-slate-700">
                     <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyText(`اسم الحساب: ${sub.name}\nيوزر: ${sub.account_username || 'لا يوجد'}\nرمز: ${sub.account_password || 'لا يوجد'}`, `mob-${sub.id}`);
                        }}
                        className="flex-1 flex justify-center items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 py-2.5 rounded-lg transition-colors ml-2"
                      >
                        {copiedId === `mob-${sub.id}` ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                        <span className={copiedId === `mob-${sub.id}` ? "text-emerald-600 dark:text-emerald-400" : ""}>نسخ الحساب</span>
                     </button>
                    
                    {role === 'admin' && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleOpenModal(sub)}
                          className="p-2.5 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteClick(sub.id)}
                          className="p-2.5 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/40 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-gray-900/40 dark:bg-slate-900/60 backdrop-blur-sm transition-opacity" aria-hidden="true" onClick={handleCloseModal}></div>
          
          {/* Modal Panel */}
          <div className="relative bg-white dark:bg-slate-800 rounded-2xl text-right shadow-2xl w-full max-w-xl border border-gray-100 dark:border-slate-700 flex flex-col max-h-[95vh] animate-in fade-in zoom-in-95 duration-200 transition-colors">
            
            {/* Header */}
            <div className="bg-gray-50/80 dark:bg-slate-800/80 px-6 py-4 border-b border-gray-100 dark:border-slate-700 flex justify-between items-center shrink-0 rounded-t-2xl">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2" id="modal-title">
                {editingSub ? <Edit2 className="w-5 h-5 text-blue-600 dark:text-blue-400" /> : <Plus className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
                {editingSub ? 'تعديل الحساب' : 'إضافة حساب جديد'}
              </h3>
              <button onClick={handleCloseModal} className="text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors rounded-full p-1 hover:bg-gray-200 dark:hover:bg-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
              {/* Scrollable Body */}
              <div className="overflow-y-auto px-6 py-5 space-y-6">
                
                {/* Group 1: Basic Info */}
                <div>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <Package className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                    المعلومات الأساسية
                  </h4>
                  <div className="bg-gray-50/50 dark:bg-slate-700/30 p-4 rounded-xl border border-gray-100 dark:border-slate-600 space-y-4">
                    <div>
                      <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">اسم المنتج / الحساب <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        id="name"
                        required
                        className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="مثال: حساب ديجتال، رخصة برنامج..."
                      />
                    </div>
                    <div>
                      <label htmlFor="category" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">التصنيف</label>
                      <input
                        type="text"
                        id="category"
                        className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        placeholder="مثال: ترفيه، عمل، خدمات سحابية..."
                      />
                    </div>
                  </div>
                </div>

                {/* Group 2: Dates */}
                {!formData.category.includes('لعب') && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                      التواريخ والصلاحية
                    </h4>
                    <div className="bg-gray-50/50 dark:bg-slate-700/30 p-4 rounded-xl border border-gray-100 dark:border-slate-600 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="activationDate" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">تاريخ التفعيل <span className="text-red-500">*</span></label>
                        <input
                          type="date"
                          id="activationDate"
                          required
                          className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                          value={formData.activationDate}
                          onChange={(e) => setFormData({ ...formData, activationDate: e.target.value })}
                        />
                      </div>
                      <div>
                        <label htmlFor="expirationDate" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">تاريخ الانتهاء <span className="text-red-500">*</span></label>
                        <input
                          type="date"
                          id="expirationDate"
                          required
                          className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                          value={formData.expirationDate}
                          onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Group 3: Notes & Additional Details */}
                <div>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                    تفاصيل إضافية
                  </h4>
                  <div className="bg-gray-50/50 dark:bg-slate-700/30 p-4 rounded-xl border border-gray-100 dark:border-slate-600 space-y-4">
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="account_username" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">يوزر الحساب <span className="text-gray-400 font-normal">(اختياري)</span></label>
                        <div className="relative">
                          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                            <AtSign className="w-4 h-4 text-gray-400" />
                          </div>
                          <input
                            type="text"
                            id="account_username"
                            className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 pr-10 pl-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                            value={formData.account_username}
                            onChange={(e) => setFormData({ ...formData, account_username: e.target.value })}
                            dir="ltr"
                          />
                        </div>
                      </div>
                      <div>
                        <label htmlFor="account_password" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">رمز الحساب <span className="text-gray-400 font-normal">(اختياري)</span></label>
                        <div className="relative">
                          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                            <Key className="w-4 h-4 text-gray-400" />
                          </div>
                          <input
                            type="text"
                            id="account_password"
                            className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 pr-10 pl-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                            value={formData.account_password}
                            onChange={(e) => setFormData({ ...formData, account_password: e.target.value })}
                            dir="ltr"
                          />
                        </div>
                      </div>
                    </div>

                    {(formData.account_username || formData.account_password) && (
                      <div className="flex justify-start">
                        <button
                          type="button"
                          onClick={() => {
                            const namePart = formData.name ? `${formData.name}\n` : '';
                            handleCopyText(`${namePart}يوزر: ${formData.account_username}\nرمز: ${formData.account_password}`, 'sub-form');
                          }}
                          className="flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-lg border border-blue-100 dark:border-blue-800"
                        >
                          {copiedId === 'sub-form' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          نسخ سريع مدمج
                        </button>
                      </div>
                    )}

                    <div className="pt-2 border-t border-gray-200 dark:border-slate-600">
                      <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">ملاحظات</label>
                      <textarea
                        id="notes"
                        rows={3}
                        className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white resize-none"
                        value={formData.notes}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                        placeholder="أي تفاصيل إضافية، روابط، أو معلومات حساب..."
                      ></textarea>
                    </div>
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
        title="تأكيد حذف الاشتراك"
        message="هل أنت متأكد من حذف هذا الاشتراك؟ لا يمكن التراجع عن هذا الإجراء."
      />
          </>
        ) : activePage === 'finances' ? (
          <Transactions />
        ) : activePage === 'suppliers' ? (
          <Suppliers />
        ) : activePage === 'products' ? (
          <Products />
        ) : activePage === 'sales' ? (
          <Sales />
        ) : activePage === 'settings' ? (
          <SettingsPage />
        ) : activePage === 'users' ? (
          <UsersPage />
        ) : activePage === 'sessions' ? (
          <Sessions />
        ) : (
          <Customers />
        )}
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 z-30 pb-safe transition-colors duration-200">
        <div className="flex overflow-x-auto hide-scrollbar items-center h-16 px-4 gap-6">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActivePage(item.id)}
                className={`flex flex-col items-center justify-center min-w-[60px] h-full space-y-1 transition-colors shrink-0 ${
                  isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'fill-blue-50 dark:fill-blue-500/20' : ''}`} />
                <span className="text-[10px] font-medium whitespace-nowrap">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
