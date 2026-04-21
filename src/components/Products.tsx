import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Edit2, Trash2, Search, Box, Truck, DollarSign, TrendingUp, CheckCircle, X, FileText, Link as LinkIcon, ExternalLink, Loader2, Filter, Package, LayoutDashboard, ShoppingCart, Copy, Check } from 'lucide-react';
import { Product, PriceTier } from '../types';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import { supabase } from '../supabaseClient';
import { useAuth } from '../AuthContext';

const generateId = () => Math.random().toString(36).substring(2, 9);

export type ProductLinkObj = { url: string; originalPrice: number | ''; finalPrice: number; duration?: string };

const calculateFinalPrice = (price: number, multiplier: number): number => {
  if (!price || isNaN(price)) return 0;
  return price * multiplier;
};

const parseLinks = (linksStr?: string): ProductLinkObj[] => {
  if (!linksStr) return [];
  try {
    const parsed = JSON.parse(linksStr);
    if (Array.isArray(parsed)) {
      return parsed.map(item => {
        if (typeof item === 'string') return { url: item, originalPrice: '', finalPrice: 0, duration: '' };
        return {
          url: item.url || '',
          originalPrice: item.originalPrice || '',
          finalPrice: item.finalPrice || 0,
          duration: item.duration || ''
        };
      });
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.links)) {
      return parsed.links.map((item: any) => ({
        url: item.url || '',
        originalPrice: item.originalPrice || '',
        finalPrice: item.finalPrice || 0,
        duration: item.duration || ''
      }));
    }
    return [{ url: linksStr, originalPrice: '', finalPrice: 0, duration: '' }];
  } catch (e) {
    return [{ url: linksStr, originalPrice: '', finalPrice: 0, duration: '' }];
  }
};

const parseTiers = (linksStr?: string): PriceTier[] => {
  if (!linksStr) return [];
  try {
    const parsed = JSON.parse(linksStr);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.tiers)) {
      return parsed.tiers.map((item: any) => ({
        id: item.id || generateId(),
        name: item.name || '',
        costPrice: item.costPrice || 0,
        sellingPrice: item.sellingPrice || 0,
        duration: item.duration || ''
      }));
    }
    return [];
  } catch (e) {
    return [];
  }
};

export default function Products() {
  const { role } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [multiplier, setMultiplier] = useState<number | ''>(1500);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; multiplier: number }[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  useEffect(() => {
    const saved = localStorage.getItem('supplierSettings');
    if (saved) {
      try {
        setSuppliers(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse supplier settings', e);
      }
    }
  }, []);

  const [formData, setFormData] = useState<Omit<Product, 'id' | 'productLink' | 'priceTiers'> & { productLinks: ProductLinkObj[], priceTiers: PriceTier[] }>({
    name: '',
    costPrice: 0,
    supplier: '',
    sellingPrice: 0,
    notes: '',
    productLinks: [],
    priceTiers: [],
    category: '',
    type: '',
  });

  useEffect(() => {
    let isMounted = true;
    
    const fetchProducts = async () => {
      if (!isMounted) return;
      setIsLoading(true);
      try {
        const { data, error } = await supabase.from('products').select('*').order('id', { ascending: false });
        if (!isMounted) return;
        if (data) setProducts(data as Product[]);
        if (error) console.error("Error fetching products:", error);
      } catch (e) {
        console.error("Fetch products error:", e);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchProducts();
    
    let timeoutId: NodeJS.Timeout;

    const channel = supabase
      .channel('schema-db-changes-products')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products' },
        () => {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => fetchProducts(), 500);
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      supabase.removeChannel(channel);
    };
  }, []);

  const handleOpenModal = (product?: Product) => {
    if (product) {
      setEditingProduct(product);
      
      // Find the supplier to set the correct multiplier
      const foundSupplier = suppliers.find(s => s.name === product.supplier);
      if (foundSupplier) {
        setMultiplier(foundSupplier.multiplier);
      } else {
        // Fallback to default if supplier not found in settings
        setMultiplier(1500);
      }

      setFormData({
        name: product.name,
        costPrice: product.costPrice,
        supplier: product.supplier,
        sellingPrice: product.sellingPrice,
        notes: product.notes,
        productLinks: parseLinks(product.productLink),
        priceTiers: parseTiers(product.productLink),
        category: product.category || '',
        type: product.type || '',
      });
    } else {
      setEditingProduct(null);
      setFormData({
        name: '',
        costPrice: 0,
        supplier: '',
        sellingPrice: 0,
        notes: '',
        productLinks: [],
        priceTiers: [],
        category: '',
        type: '',
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingProduct(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const dataToSubmit = {
      name: formData.name,
      costPrice: formData.costPrice,
      supplier: formData.supplier,
      sellingPrice: formData.sellingPrice,
      notes: formData.notes,
      productLink: JSON.stringify({
        links: formData.productLinks.filter(l => l.url.trim() !== ''),
        tiers: formData.priceTiers
      }),
      category: formData.category,
      type: formData.type,
    };

    if (editingProduct) {
      const { data, error } = await supabase
        .from('products')
        .update(dataToSubmit)
        .eq('id', editingProduct.id)
        .select();
      
      if (error) {
        console.error("Error updating:", error);
        alert(`حدث خطأ أثناء التعديل: ${error.message}`);
      } else if (!data || data.length === 0) {
        alert('لم يتم حفظ التعديلات! يبدو أن هناك مشكلة في صلاحيات قاعدة البيانات (RLS). يرجى تحديث قوانين Supabase.');
      }
    } else {
      const { error } = await supabase
        .from('products')
        .insert([dataToSubmit]);
        
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
      supabase.from('products').delete().eq('id', id).then(({ error }) => {
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
        .from('products')
        .delete()
        .eq('id', itemToDelete);
        
      if (error) {
        console.error("Error deleting:", error);
        alert(`حدث خطأ أثناء الحذف: ${error.message}`);
      }
      setItemToDelete(null);
    }
  };

  const filteredProducts = useMemo(() => {
    return products
      .filter(p =>
        ((p.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.supplier || '').toLowerCase().includes(searchQuery.toLowerCase())) &&
        (filterCategory === 'all' || p.category === filterCategory) &&
        (filterType === 'all' || p.type === filterType)
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [products, searchQuery, filterCategory, filterType]);

  const stats = useMemo(() => {
    const totalProducts = products.length;
    const categories = {
      'ألعاب': products.filter(p => p.category === 'ألعاب').length,
      'اشتراكات': products.filter(p => p.category === 'اشتراكات').length,
    };
    return { totalProducts, categories };
  }, [products]);

  const categories = [
    { id: 'all', label: 'الكل', icon: Box, color: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300' },
    { id: 'ألعاب', label: 'ألعاب', icon: ShoppingCart, color: 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
    { id: 'اشتراكات', label: 'اشتراكات', icon: CheckCircle, color: 'bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  ];

  return (
    <div className="space-y-6" dir="rtl">
      {/* Category Selection Grid - Improved Display */}
      <div className="flex flex-wrap gap-4 justify-center sm:justify-start">
        {categories.map((cat) => {
          const Icon = cat.icon;
          const isActive = filterCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setFilterCategory(cat.id)}
              className={`flex items-center gap-3 px-6 py-3 rounded-2xl border-2 transition-all duration-300 min-w-[140px] ${
                isActive 
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 shadow-lg shadow-blue-500/10 transform scale-105' 
                  : 'border-transparent bg-white dark:bg-slate-800 hover:border-slate-200 dark:hover:border-slate-700 shadow-sm hover:shadow-md'
              }`}
            >
              <div className={`p-2.5 rounded-xl ${cat.color}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="text-right">
                <span className={`block text-sm font-bold ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-600 dark:text-slate-400'}`}>
                  {cat.label}
                </span>
                {cat.id !== 'all' && (
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    {stats.categories[cat.id as keyof typeof stats.categories]} منتج
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-1">
        <div className="bg-white dark:bg-slate-800 overflow-hidden shadow-sm rounded-xl border border-gray-100 dark:border-slate-700 transition-colors duration-200">
          <div className="px-4 py-5 sm:p-6 flex items-center">
            <div className="p-3 rounded-full bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 ml-4">
              <Box className="w-8 h-8" />
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-slate-400 truncate">إجمالي المنتجات</dt>
              <dd className="mt-1 text-3xl font-semibold text-blue-600 dark:text-blue-400">{stats.totalProducts}</dd>
            </div>
          </div>
        </div>
      </div>

      {/* Actions and List */}
      <div className="bg-white dark:bg-slate-800 shadow-sm rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden transition-colors duration-200">
        <div className="p-4 border-b border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto flex-1">
            <div className="relative w-full sm:max-w-md">
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400 dark:text-slate-500" />
              </div>
              <input
                type="text"
                className="block w-full pl-3 pr-10 py-2 border border-gray-300 dark:border-slate-600 rounded-md leading-5 bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-gray-500 dark:placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-colors"
                placeholder="ابحث عن منتج أو مورد..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            <div className="flex gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-none sm:w-36">
                <div className="absolute inset-y-0 right-0 pr-2 flex items-center pointer-events-none">
                  <Filter className="h-4 w-4 text-gray-400 dark:text-slate-500" />
                </div>
                <select
                  className="block w-full pl-3 pr-8 py-2 border border-gray-300 dark:border-slate-600 rounded-md leading-5 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-colors appearance-none"
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                >
                  <option value="all">كل التصنيفات</option>
                  <option value="ألعاب">ألعاب</option>
                  <option value="اشتراكات">اشتراكات</option>
                  <option value="أخرى">أخرى</option>
                </select>
              </div>
              
              <div className="relative flex-1 sm:flex-none sm:w-36">
                <select
                  className="block w-full pl-3 pr-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md leading-5 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-colors appearance-none"
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                >
                  <option value="all">كل الأنواع</option>
                  <option value="حساب">حساب</option>
                  <option value="كود">كود</option>
                  <option value="أخرى">أخرى</option>
                </select>
              </div>
            </div>
          </div>
          {role === 'admin' && (
            <button
              onClick={() => handleOpenModal()}
              className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors shrink-0"
            >
              <Plus className="w-5 h-5 ml-2 -mr-1" />
              إضافة منتج جديد
            </button>
          )}
        </div>

        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-800/50">
              <tr>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">اسم المنتج</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">التصنيف</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">النوع</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">المورد</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">التسعيرات</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">ملاحظات</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">إجراءات</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-16 text-center text-slate-500 dark:text-slate-400">
                    <div className="flex flex-col items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400 mb-4"></div>
                      <p className="text-lg font-medium text-slate-900 dark:text-white">جاري تحميل البيانات...</p>
                      <p className="text-sm mt-1">يتم الآن جلب معلومات المنتجات من السحابة.</p>
                    </div>
                  </td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-gray-500 dark:text-slate-400">
                    لا توجد بيانات لعرضها. أضف منتجاً جديداً للبدء.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => {
                  const tiers = parseTiers(product.productLink);
                  const hasTiers = tiers.length > 0;
                  return (
                    <tr key={product.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center cursor-pointer group" onClick={() => handleOpenModal(product)}>
                          <Box className="w-4 h-4 ml-2 text-gray-400 dark:text-slate-500 group-hover:text-blue-500 transition-colors" />
                          <span className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{product.name}</span>
                          {role === 'admin' && (
                            <div className="flex items-center mr-2 gap-1" onClick={(e) => e.stopPropagation()}>
                              {parseLinks(product.productLink).map((link, idx) => (
                                <a 
                                  key={idx}
                                  href={link.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                                  title={`فتح الرابط ${idx + 1}${link.finalPrice ? ` - السعر النهائي: ${link.finalPrice.toLocaleString()}` : ''}${link.duration ? ` - المدة: ${link.duration}` : ''}`}
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-500/10 text-blue-800 dark:text-blue-400">
                          {product.category || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-500/10 text-purple-800 dark:text-purple-400">
                          {product.type || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {role === 'admin' ? (
                          <div className="flex items-center text-sm text-gray-500 dark:text-slate-400">
                            <Truck className="w-4 h-4 ml-1.5 text-gray-400 dark:text-slate-500" />
                            {product.supplier || '-'}
                          </div>
                        ) : (
                          <div className="text-sm text-gray-500 dark:text-slate-400">لا يوجد</div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1 max-h-24 overflow-y-auto custom-scrollbar min-w-[200px]">
                          {hasTiers ? (
                            tiers.map((tier, idx) => (
                              <div key={idx} className="text-xs flex items-center justify-between bg-gray-50 dark:bg-slate-700/50 p-1.5 rounded border border-gray-100 dark:border-slate-600">
                                <span className="font-medium text-slate-700 dark:text-slate-300">{tier.name || 'بدون اسم'}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-slate-500 dark:text-slate-400 line-through decoration-red-400/50">{Number(tier.costPrice).toLocaleString()}</span>
                                  <span className="font-bold text-emerald-600 dark:text-emerald-400">{Number(tier.sellingPrice).toLocaleString()}</span>
                                </div>
                              </div>
                            ))
                          ) : (
                            <span className="text-sm text-gray-500 dark:text-slate-400">-</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-500 dark:text-slate-400 whitespace-pre-wrap break-words min-w-[150px] max-w-[250px] max-h-24 overflow-y-auto custom-scrollbar">
                          {product.notes || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        {role === 'admin' && (
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => handleOpenModal(product)}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 transition-colors"
                              title="تعديل"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteClick(product.id)}
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
          ) : filteredProducts.length === 0 ? (
            <div className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
              <div className="flex flex-col items-center justify-center">
                <Box className="w-10 h-10 text-slate-300 dark:text-slate-600 mb-3" />
                <p className="text-base font-medium text-slate-900 dark:text-white">لا توجد منتجات</p>
              </div>
            </div>
          ) : (
            filteredProducts.map((product) => {
              const tiers = parseTiers(product.productLink);
              const hasTiers = tiers.length > 0;
              return (
                <div key={product.id} className="p-4 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors flex flex-col gap-3">
                  <div className="flex justify-between items-start">
                    <div className="flex items-start">
                      <div className="flex-shrink-0 h-12 w-12 bg-blue-100 dark:bg-blue-500/20 rounded-xl flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-xl">
                        <Box className="w-6 h-6" />
                      </div>
                      <div className="ml-3 mr-3 mt-1">
                        <div 
                          className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                          onClick={() => handleOpenModal(product)}
                        >
                          <span className="line-clamp-2 leading-tight">{product.name}</span>
                          {role === 'admin' && (
                            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                              {parseLinks(product.productLink).map((link, idx) => (
                                <a 
                                  key={idx}
                                  href={link.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-500/10 p-1.5 rounded-md transition-colors"
                                  title={`فتح الرابط ${idx + 1}${link.finalPrice ? ` - السعر النهائي: ${link.finalPrice.toLocaleString()}` : ''}${link.duration ? ` - المدة: ${link.duration}` : ''}`}
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 mt-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-blue-100 dark:bg-blue-500/10 text-blue-800 dark:text-blue-400">
                            {product.category || '-'}
                          </span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-purple-100 dark:bg-purple-500/10 text-purple-800 dark:text-purple-400">
                            {product.type || '-'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {hasTiers && (
                    <div className="mt-2 flex flex-col gap-1.5 bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-700/50 text-sm">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-0.5">التسعيرات:</span>
                      {tiers.map((tier, idx) => (
                        <div key={idx} className="flex justify-between items-center text-xs p-1.5 bg-white dark:bg-slate-800 rounded border border-gray-100 dark:border-slate-700/50 shadow-sm">
                          <span className="text-slate-700 dark:text-slate-300 font-medium">{tier.name || 'بدون اسم'}</span>
                          <div className="flex items-center gap-2">
                            {role === 'admin' && <span className="text-slate-400 line-through text-[10px]">{Number(tier.costPrice).toLocaleString()}</span>}
                            <span className="font-bold text-emerald-600 dark:text-emerald-400">{Number(tier.sellingPrice).toLocaleString()} د.ع</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <div className="flex flex-col gap-2 text-xs">
                    {role === 'admin' && (
                      <div className="flex items-center text-slate-500 dark:text-slate-400 bg-gray-50 dark:bg-slate-800/50 w-fit px-2 py-1.5 rounded-md">
                        <Truck className="w-3.5 h-3.5 ml-1.5 text-gray-400 dark:text-slate-500 shrink-0" />
                        <span className="truncate">{product.supplier || 'لا يوجد مورد'}</span>
                      </div>
                    )}
                    {product.notes && <div className="text-slate-500 dark:text-slate-400 whitespace-pre-wrap break-words max-h-24 overflow-y-auto custom-scrollbar bg-gray-50 dark:bg-slate-800/50 p-2.5 rounded-md">{product.notes}</div>}
                  </div>

                  {/* Bottom Action Bar */}
                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-100 dark:border-slate-700">
                     <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(`المنتج: ${product.name}\n${hasTiers ? `الأسعار:\n${tiers.map(t => `- ${t.name}: ${t.sellingPrice} د.ع`).join('\n')}` : ''}`, `mob-${product.id}`);
                        }}
                        className="flex-1 flex justify-center items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 py-2.5 rounded-lg transition-colors ml-2"
                      >
                        {copiedId === `mob-${product.id}` ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                        <span className={copiedId === `mob-${product.id}` ? "text-emerald-600 dark:text-emerald-400" : ""}>نسخ تفاصيل المنتج</span>
                     </button>
                    
                    {role === 'admin' && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleOpenModal(product)}
                          className="p-2.5 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteClick(product.id)}
                          className="p-2.5 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/40 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
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
          
          <div className="relative bg-white dark:bg-slate-800 rounded-2xl text-right shadow-2xl w-full max-w-3xl border border-gray-100 dark:border-slate-700 flex flex-col max-h-[95vh] animate-in fade-in zoom-in-95 duration-200 transition-colors">
            
            {/* Header */}
            <div className="bg-gray-50/80 dark:bg-slate-800/80 px-6 py-4 border-b border-gray-100 dark:border-slate-700 flex justify-between items-center shrink-0 rounded-t-2xl">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2" id="modal-title">
                {editingProduct ? (role === 'admin' ? <Edit2 className="w-5 h-5 text-blue-600 dark:text-blue-400" /> : <Box className="w-5 h-5 text-blue-600 dark:text-blue-400" />) : <Plus className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
                {editingProduct ? (role === 'admin' ? 'تعديل تفاصيل المنتج' : 'تفاصيل المنتج') : 'إضافة منتج جديد'}
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
                    <Box className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                    معلومات المنتج
                  </h4>
                  <div className="bg-gray-50/50 dark:bg-slate-700/30 p-4 rounded-xl border border-gray-100 dark:border-slate-600 space-y-4">
                    <div>
                      <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">اسم المنتج <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        id="name"
                        required
                        disabled={role !== 'admin'}
                        className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="مثال: اشتراك يوتيوب بريميوم، حساب كانفا..."
                      />
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="category" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">التصنيف</label>
                        <select
                          id="category"
                          disabled={role !== 'admin'}
                          className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                          value={formData.category}
                          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        >
                          <option value="">بدون تصنيف</option>
                          <option value="ألعاب">ألعاب</option>
                          <option value="اشتراكات">اشتراكات</option>
                          <option value="أخرى">أخرى</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="type" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">النوع</label>
                        <select
                          id="type"
                          disabled={role !== 'admin'}
                          className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                          value={formData.type}
                          onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                        >
                          <option value="">بدون نوع</option>
                          <option value="حساب">حساب</option>
                          <option value="كود">كود</option>
                          <option value="أخرى">أخرى</option>
                        </select>
                      </div>
                    </div>
                    {role === 'admin' && (
                      <>
                        <div>
                          <div className="flex justify-between items-center mb-1.5">
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">روابط المنتج وحاسبة الأسعار (الحد الأقصى 5)</label>
                            {formData.productLinks.length < 5 && (
                              <button
                                type="button"
                                onClick={() => setFormData({ ...formData, productLinks: [...formData.productLinks, { url: '', originalPrice: '', finalPrice: 0, duration: '' }] })}
                                className="inline-flex items-center text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20 px-2 py-1 rounded transition-colors"
                              >
                                <Plus className="w-3 h-3 ml-1" />
                                إضافة رابط
                              </button>
                            )}
                          </div>
                          
                          <div className="mb-3 bg-blue-50 dark:bg-blue-500/10 p-3 rounded-lg border border-blue-100 dark:border-blue-500/20">
                            <label className="block text-xs font-medium text-blue-800 dark:text-blue-300 mb-1.5">
                              سعر الصرف / معامل الضرب (يُطبق على جميع الروابط)
                            </label>
                            <input
                              type="number"
                              className="block w-full sm:w-1/2 border border-blue-200 dark:border-blue-500/30 rounded-md shadow-sm py-1.5 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/50 sm:text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                              value={multiplier}
                              onChange={(e) => {
                                const val = e.target.value === '' ? '' : Number(e.target.value);
                                setMultiplier(val);
                                const newLinks = formData.productLinks.map(link => ({
                                  ...link,
                                  finalPrice: calculateFinalPrice(Number(link.originalPrice), Number(val))
                                }));
                                setFormData({ ...formData, productLinks: newLinks });
                              }}
                              placeholder="مثال: 1500"
                            />
                          </div>

                          <div className="space-y-2">
                            {formData.productLinks.length === 0 && (
                              <p className="text-xs text-gray-500 dark:text-slate-400">لا توجد روابط مضافة.</p>
                            )}
                            {formData.productLinks.map((link, index) => (
                              <div key={index} className="flex flex-col sm:flex-row items-start sm:items-center gap-2 bg-gray-50 dark:bg-slate-700/30 p-2 rounded-lg border border-gray-100 dark:border-slate-600">
                                <div className="relative flex-1 w-full flex gap-2">
                                  <div className="relative flex-1">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                      <LinkIcon className="h-4 w-4 text-gray-400 dark:text-slate-500" />
                                    </div>
                                    <input
                                      type="url"
                                      dir="ltr"
                                      className="block w-full border border-gray-300 dark:border-slate-600 rounded-md shadow-sm py-2 pl-10 pr-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-left"
                                      value={link.url}
                                      onChange={(e) => {
                                        const newLinks = [...formData.productLinks];
                                        newLinks[index].url = e.target.value;
                                        setFormData({ ...formData, productLinks: newLinks });
                                      }}
                                      placeholder="https://example.com/product"
                                    />
                                  </div>
                                  {link.url && (
                                    <a
                                      href={link.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="p-2 text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:hover:text-blue-300 dark:bg-blue-500/10 dark:hover:bg-blue-500/20 rounded-md transition-colors flex items-center justify-center shrink-0"
                                      title="فتح الرابط"
                                    >
                                      <ExternalLink className="w-4 h-4" />
                                    </a>
                                  )}
                                </div>
                                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                                  {formData.category === 'اشتراكات' && (
                                    <div className="relative w-full sm:w-24">
                                      <input
                                        type="text"
                                        className="block w-full border border-gray-300 dark:border-slate-600 rounded-md shadow-sm py-2 px-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-center"
                                        value={link.duration || ''}
                                        onChange={(e) => {
                                          const newLinks = [...formData.productLinks];
                                          newLinks[index].duration = e.target.value;
                                          setFormData({ ...formData, productLinks: newLinks });
                                        }}
                                        placeholder="المدة (مثال: شهر)"
                                      />
                                    </div>
                                  )}
                                  <div className="relative w-full sm:w-24">
                                    <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                                      <span className="text-gray-500 dark:text-slate-400 text-sm">$</span>
                                    </div>
                                    <input
                                      type="number"
                                      step="0.01"
                                      className="block w-full border border-gray-300 dark:border-slate-600 rounded-md shadow-sm py-2 pl-6 pr-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-left"
                                      value={link.originalPrice}
                                      onChange={(e) => {
                                        const price = e.target.value === '' ? '' : Number(e.target.value);
                                        const newLinks = [...formData.productLinks];
                                        newLinks[index].originalPrice = price;
                                        newLinks[index].finalPrice = calculateFinalPrice(Number(price), Number(multiplier));
                                        setFormData({ ...formData, productLinks: newLinks });
                                      }}
                                      placeholder="السعر"
                                    />
                                  </div>
                                  <div className="w-full sm:w-28 px-2 py-2 bg-blue-100/50 dark:bg-blue-500/20 rounded-md text-center text-sm font-bold text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30 truncate" title="السعر النهائي">
                                    {link.finalPrice ? link.finalPrice.toLocaleString() : '0'}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const newLinks = formData.productLinks.filter((_, i) => i !== index);
                                      setFormData({ ...formData, productLinks: newLinks });
                                    }}
                                    className="p-2 text-gray-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 transition-colors rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 shrink-0"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label htmlFor="supplier" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">المورد (من أين تم الشراء؟) <span className="text-red-500">*</span></label>
                          <input
                            type="text"
                            id="supplier"
                            list="suppliers-list"
                            required
                            className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                            value={formData.supplier}
                            onChange={(e) => {
                              const val = e.target.value;
                              setFormData({ ...formData, supplier: val });
                              const foundSupplier = suppliers.find(s => s.name === val);
                              if (foundSupplier) {
                                setMultiplier(foundSupplier.multiplier);
                                const newLinks = formData.productLinks.map(link => ({
                                  ...link,
                                  finalPrice: calculateFinalPrice(Number(link.originalPrice), foundSupplier.multiplier)
                                }));
                                setFormData(prev => ({ ...prev, supplier: val, productLinks: newLinks }));
                              }
                            }}
                            placeholder="اختر من القائمة أو اكتب اسماً جديداً..."
                          />
                          <datalist id="suppliers-list">
                            {suppliers.map(s => (
                              <option key={s.id} value={s.name} />
                            ))}
                          </datalist>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Group 2: Pricing */}
                <div>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                    التسعير
                  </h4>
                  <div className="bg-gray-50/50 dark:bg-slate-700/30 p-4 rounded-xl border border-gray-100 dark:border-slate-600 grid grid-cols-1 gap-4">
                    {/* Price Tiers Section */}
                    <div className="sm:col-span-1">
                      <div className="flex justify-between items-center mb-3">
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">التسعيرات (الحد الأقصى 5)</label>
                        {role === 'admin' && formData.priceTiers.length < 5 && (
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, priceTiers: [...formData.priceTiers, { id: generateId(), name: '', costPrice: 0, sellingPrice: 0, duration: '' }] })}
                            className="inline-flex items-center text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 px-2 py-1 rounded transition-colors"
                          >
                            <Plus className="w-3 h-3 ml-1" />
                            إضافة تسعيرة
                          </button>
                        )}
                      </div>
                      
                      <div className="space-y-3">
                        {formData.priceTiers.length === 0 && (
                          <div className="text-center py-4 bg-white dark:bg-slate-800 rounded-lg border border-dashed border-gray-300 dark:border-slate-600">
                            <p className="text-sm text-gray-500 dark:text-slate-400 mb-2">لا توجد تسعيرات مضافة.</p>
                            {role === 'admin' && (
                              <button
                                type="button"
                                onClick={() => setFormData({ ...formData, priceTiers: [{ id: generateId(), name: 'أساسي', costPrice: 0, sellingPrice: 0, duration: '' }] })}
                                className="inline-flex items-center text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                              >
                                <Plus className="w-4 h-4 ml-1" />
                                أضف التسعيرة الأولى
                              </button>
                            )}
                          </div>
                        )}
                        {formData.priceTiers.map((tier, index) => (
                          <div key={tier.id} className="bg-white dark:bg-slate-800 p-3 rounded-lg border border-gray-200 dark:border-slate-600 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                            <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-12 gap-2">
                              <div className="sm:col-span-6">
                                <input
                                  type="text"
                                  placeholder="اسم التسعيرة (مثال: جملة، 3 أشهر)"
                                  disabled={role !== 'admin'}
                                  className="block w-full border border-gray-300 dark:border-slate-600 rounded-md shadow-sm py-1.5 px-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-xs bg-gray-50 dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                  value={tier.name}
                                  onChange={(e) => {
                                    const newTiers = [...formData.priceTiers];
                                    newTiers[index].name = e.target.value;
                                    setFormData({ ...formData, priceTiers: newTiers });
                                  }}
                                />
                              </div>
                              <div className="relative sm:col-span-3">
                                <input
                                  type="number"
                                  placeholder="سعر الشراء"
                                  disabled={role !== 'admin'}
                                  className="block w-full border border-gray-300 dark:border-slate-600 rounded-md shadow-sm py-1.5 pl-8 pr-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-xs bg-gray-50 dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                  value={tier.costPrice || ''}
                                  onChange={(e) => {
                                    const newTiers = [...formData.priceTiers];
                                    newTiers[index].costPrice = Number(e.target.value);
                                    setFormData({ ...formData, priceTiers: newTiers });
                                  }}
                                />
                                <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                                  <span className="text-gray-500 dark:text-slate-400 text-[10px]">د.ع</span>
                                </div>
                              </div>
                              <div className="relative sm:col-span-3">
                                <input
                                  type="number"
                                  placeholder="سعر البيع"
                                  disabled={role !== 'admin'}
                                  className="block w-full border border-gray-300 dark:border-slate-600 rounded-md shadow-sm py-1.5 pl-8 pr-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-xs bg-gray-50 dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                  value={tier.sellingPrice || ''}
                                  onChange={(e) => {
                                    const newTiers = [...formData.priceTiers];
                                    newTiers[index].sellingPrice = Number(e.target.value);
                                    setFormData({ ...formData, priceTiers: newTiers });
                                  }}
                                />
                                <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                                  <span className="text-gray-500 dark:text-slate-400 text-[10px]">د.ع</span>
                                </div>
                              </div>
                              {formData.category === 'اشتراكات' && (
                                <div className="sm:col-span-4">
                                  <input
                                    type="text"
                                    placeholder="المدة (مثال: شهر، سنة)"
                                    disabled={role !== 'admin'}
                                    className="block w-full border border-gray-300 dark:border-slate-600 rounded-md shadow-sm py-1.5 px-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-xs bg-gray-50 dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                    value={tier.duration || ''}
                                    onChange={(e) => {
                                      const newTiers = [...formData.priceTiers];
                                      newTiers[index].duration = e.target.value;
                                      setFormData({ ...formData, priceTiers: newTiers });
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                              <div className="flex-1 sm:flex-none px-2 py-1.5 bg-emerald-50 dark:bg-emerald-500/10 rounded-md text-center text-xs font-bold text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-500/20 whitespace-nowrap" title="صافي الربح">
                                {((tier.sellingPrice || 0) - (tier.costPrice || 0)).toLocaleString()} د.ع
                              </div>
                              {role === 'admin' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const newTiers = formData.priceTiers.filter((_, i) => i !== index);
                                    setFormData({ ...formData, priceTiers: newTiers });
                                  }}
                                  className="p-1.5 text-gray-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 transition-colors rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 shrink-0"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
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
                      rows={4}
                      disabled={role !== 'admin'}
                      className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white resize-y min-h-[100px] disabled:opacity-50 disabled:cursor-not-allowed"
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      placeholder="أي ملاحظات إضافية..."
                    ></textarea>
                  </div>
                </div>

              </div>
              
              {/* Footer */}
              <div className="bg-gray-50 dark:bg-slate-800/80 px-6 py-4 border-t border-gray-100 dark:border-slate-700 sm:flex sm:flex-row-reverse gap-3 shrink-0 rounded-b-2xl">
                {role === 'admin' && (
                  <button
                    type="submit"
                    className="w-full inline-flex justify-center items-center rounded-lg border border-transparent shadow-sm px-5 py-2.5 bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:w-auto transition-colors"
                  >
                    <CheckCircle className="w-4 h-4 ml-2" />
                    حفظ المنتج
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="mt-3 w-full inline-flex justify-center items-center rounded-lg border border-gray-300 dark:border-slate-600 shadow-sm px-5 py-2.5 bg-white dark:bg-slate-700 text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:w-auto transition-colors"
                >
                  {role === 'admin' ? 'إلغاء' : 'إغلاق'}
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
        title="تأكيد حذف المنتج"
        message="هل أنت متأكد من حذف هذا المنتج؟ لا يمكن التراجع عن هذا الإجراء."
      />
    </div>
  );
}
