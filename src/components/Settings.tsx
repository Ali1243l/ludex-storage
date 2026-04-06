import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, CheckCircle, X, Settings as SettingsIcon, Store, Download, FileJson, FileText, File as FileIcon, FileSpreadsheet, Shield } from 'lucide-react';
import { supabase } from '../supabaseClient';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2pdf from 'html2pdf.js';

export interface SupplierSetting {
  id: string;
  name: string;
  multiplier: number;
}

export interface IpLog {
  id: number;
  ip_address: string;
  user_role: string;
  device_info: string;
  timestamp: string;
}

export default function Settings() {
  const [suppliers, setSuppliers] = useState<SupplierSetting[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<SupplierSetting | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    multiplier: 1500
  });

  const [exportTable, setExportTable] = useState('products');
  const [exportFormat, setExportFormat] = useState('excel');
  const [isExporting, setIsExporting] = useState(false);
  const [ipLogs, setIpLogs] = useState<IpLog[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem('supplierSettings');
    if (saved) {
      try {
        setSuppliers(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse supplier settings', e);
      }
    }

    const fetchIpLogs = async () => {
      try {
        const token = localStorage.getItem('authToken');
        const isNative = (window as any).Capacitor?.isNative;
        const baseUrl = isNative ? (import.meta.env.VITE_APP_URL || '') : '';
        const response = await fetch(`${baseUrl}/api/ip-logs`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (response.ok) {
          const data = await response.json();
          setIpLogs(data);
        }
      } catch (e) {
        console.error('Failed to fetch IP logs', e);
      }
    };
    fetchIpLogs();
  }, []);

  const saveSuppliers = (newSuppliers: SupplierSetting[]) => {
    setSuppliers(newSuppliers);
    localStorage.setItem('supplierSettings', JSON.stringify(newSuppliers));
  };

  const handleOpenModal = (supplier?: SupplierSetting) => {
    if (supplier) {
      setEditingSupplier(supplier);
      setFormData({
        name: supplier.name,
        multiplier: supplier.multiplier
      });
    } else {
      setEditingSupplier(null);
      setFormData({
        name: '',
        multiplier: 1500
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingSupplier(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    if (editingSupplier) {
      const updated = suppliers.map(s => 
        s.id === editingSupplier.id ? { ...s, name: formData.name, multiplier: formData.multiplier } : s
      );
      saveSuppliers(updated);
    } else {
      const newSupplier: SupplierSetting = {
        id: Math.random().toString(36).substring(2, 9),
        name: formData.name,
        multiplier: formData.multiplier
      };
      saveSuppliers([...suppliers, newSupplier]);
    }
    handleCloseModal();
  };

  const handleDelete = (id: string) => {
    if (confirm('هل أنت متأكد من حذف هذا المورد؟')) {
      saveSuppliers(suppliers.filter(s => s.id !== id));
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const { data: rawData, error } = await supabase.from(exportTable).select('*');
      
      if (error) throw error;
      if (!rawData || rawData.length === 0) {
        alert('لا توجد بيانات للتصدير في هذا القسم.');
        setIsExporting(false);
        return;
      }

      // Format data based on table
      const data = rawData.map(row => {
        const formattedRow = { ...row };
        
        if (exportTable === 'products') {
          // ... existing products logic ...
          delete formattedRow.costPrice;
          delete formattedRow.sellingPrice;
          
          try {
            if (formattedRow.productLink) {
              const parsed = JSON.parse(formattedRow.productLink);
              if (parsed.links && Array.isArray(parsed.links) && parsed.links.length > 0) {
                formattedRow.روابط_المنتج = parsed.links.map((l: any) => l.url).join(' | ');
              } else {
                formattedRow.روابط_المنتج = 'لا يوجد';
              }
              if (parsed.tiers && Array.isArray(parsed.tiers) && parsed.tiers.length > 0) {
                formattedRow.التسعيرات = parsed.tiers.map((t: any) => 
                  `${t.name || 'بدون اسم'}: شراء (${t.costPrice || 0}) - بيع (${t.sellingPrice || 0})`
                ).join(' | ');
              } else {
                formattedRow.التسعيرات = 'لا يوجد';
              }
              delete formattedRow.productLink;
            }
          } catch (e) {
            formattedRow.روابط_المنتج = formattedRow.productLink;
            delete formattedRow.productLink;
          }
          
          const translated: any = {};
          if (formattedRow.id && exportFormat !== 'pdf') translated['المعرف'] = formattedRow.id;
          if (formattedRow.name) translated['اسم المنتج'] = formattedRow.name;
          if (formattedRow.category) translated['التصنيف'] = formattedRow.category;
          if (formattedRow.type) translated['النوع'] = formattedRow.type;
          if (formattedRow.supplier && exportFormat !== 'pdf') translated['المورد'] = formattedRow.supplier;
          if (formattedRow.التسعيرات) translated['التسعيرات'] = formattedRow.التسعيرات;
          if (formattedRow.روابط_المنتج && exportFormat !== 'pdf') translated['روابط المنتج'] = formattedRow.روابط_المنتج;
          if (formattedRow.notes) translated['ملاحظات'] = formattedRow.notes;
          if (formattedRow.created_at && exportFormat !== 'pdf') translated['تاريخ الإضافة'] = new Date(formattedRow.created_at).toLocaleDateString('ar-EG');
          return translated;
        }
        
        if (exportTable === 'sales') {
          const translated: any = {};
          if (formattedRow.id && exportFormat !== 'pdf') translated['المعرف'] = formattedRow.id;
          if (formattedRow.customerName) translated['اسم الزبون'] = formattedRow.customerName;
          if (formattedRow.customerUsername) translated['معرف الزبون'] = formattedRow.customerUsername;
          if (formattedRow.productName) translated['اسم المنتج'] = formattedRow.productName;
          if (formattedRow.price) translated['السعر'] = formattedRow.price;
          if (formattedRow.date) translated['التاريخ'] = new Date(formattedRow.date).toLocaleDateString('ar-EG');
          if (formattedRow.notes) translated['ملاحظات'] = formattedRow.notes;
          if (formattedRow.productLink && exportFormat !== 'pdf') {
             try {
               const parsed = JSON.parse(formattedRow.productLink);
               if (Array.isArray(parsed)) {
                 translated['روابط المنتج'] = parsed.map((l: any) => l.url).join(' | ');
               } else {
                 translated['روابط المنتج'] = formattedRow.productLink;
               }
             } catch(e) {
               translated['روابط المنتج'] = formattedRow.productLink;
             }
          }
          if (formattedRow.created_at) translated['تاريخ الإضافة'] = new Date(formattedRow.created_at).toLocaleDateString('ar-EG');
          return translated;
        }

        if (exportTable === 'subscriptions') {
          const translated: any = {};
          if (formattedRow.id && exportFormat !== 'pdf') translated['المعرف'] = formattedRow.id;
          if (formattedRow.name) translated['اسم الاشتراك'] = formattedRow.name;
          if (formattedRow.category) translated['التصنيف'] = formattedRow.category;
          if (formattedRow.activationDate) translated['تاريخ التفعيل'] = new Date(formattedRow.activationDate).toLocaleDateString('ar-EG');
          if (formattedRow.expirationDate) translated['تاريخ الانتهاء'] = new Date(formattedRow.expirationDate).toLocaleDateString('ar-EG');
          if (formattedRow.notes) translated['ملاحظات'] = formattedRow.notes;
          if (formattedRow.created_at) translated['تاريخ الإضافة'] = new Date(formattedRow.created_at).toLocaleDateString('ar-EG');
          return translated;
        }

        if (exportTable === 'customers') {
          const translated: any = {};
          if (formattedRow.id && exportFormat !== 'pdf') translated['المعرف'] = formattedRow.id;
          if (formattedRow.customer_number) translated['رقم الزبون'] = formattedRow.customer_number;
          if (formattedRow.name) translated['اسم الزبون'] = formattedRow.name;
          if (formattedRow.username) translated['معرف الزبون'] = formattedRow.username;
          if (formattedRow.notes) translated['ملاحظات'] = formattedRow.notes;
          if (formattedRow.purchases) {
             try {
               const parsed = typeof formattedRow.purchases === 'string' ? JSON.parse(formattedRow.purchases) : formattedRow.purchases;
               if (Array.isArray(parsed)) {
                 translated['المشتريات'] = parsed.map((p: any) => `${p.details} (${new Date(p.date).toLocaleDateString('ar-EG')})`).join(' | ');
               }
             } catch(e) {
               translated['المشتريات'] = 'خطأ في قراءة المشتريات';
             }
          }
          if (formattedRow.created_at) translated['تاريخ الإضافة'] = new Date(formattedRow.created_at).toLocaleDateString('ar-EG');
          return translated;
        }

        if (exportTable === 'transactions') {
          const translated: any = {};
          if (formattedRow.id && exportFormat !== 'pdf') translated['المعرف'] = formattedRow.id;
          if (formattedRow.type) translated['النوع'] = formattedRow.type === 'income' ? 'إيراد' : 'مصروف';
          if (formattedRow.person) translated['الشخص / الجهة'] = formattedRow.person;
          if (formattedRow.description) translated['الوصف'] = formattedRow.description;
          if (formattedRow.amount) translated['المبلغ'] = formattedRow.amount;
          if (formattedRow.date) translated['التاريخ'] = new Date(formattedRow.date).toLocaleDateString('ar-EG');
          if (formattedRow.created_at) translated['تاريخ الإضافة'] = new Date(formattedRow.created_at).toLocaleDateString('ar-EG');
          return translated;
        }
        
        return formattedRow;
      });

      let content = '';
      let mimeType = '';
      let fileExtension = '';

      if (exportFormat === 'json') {
        content = JSON.stringify(data, null, 2);
        mimeType = 'application/json';
        fileExtension = 'json';
      } else if (exportFormat === 'csv') {
        const headers = Object.keys(data[0]);
        const csvRows = [];
        
        // Add headers
        csvRows.push(headers.join(','));
        
        // Add rows
        for (const row of data) {
          const values = headers.map(header => {
            const val = row[header];
            // Escape quotes and wrap in quotes if contains comma
            if (val === null || val === undefined) return '';
            const strVal = String(val);
            if (strVal.includes(',') || strVal.includes('"') || strVal.includes('\n')) {
              return `"${strVal.replace(/"/g, '""')}"`;
            }
            return strVal;
          });
          csvRows.push(values.join(','));
        }
        
        // Add BOM for Excel UTF-8 support
        content = '\uFEFF' + csvRows.join('\n');
        mimeType = 'text/csv;charset=utf-8;';
        fileExtension = 'csv';
      } else if (exportFormat === 'excel') {
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, exportTable);
        XLSX.writeFile(workbook, `تصدير_${exportTable}_${new Date().toISOString().split('T')[0]}.xlsx`);
        setIsExporting(false);
        return;
      } else if (exportFormat === 'pdf') {
        const headers = Object.keys(data[0]);
        
        // Create an iframe to isolate from Tailwind's oklch colors
        const iframe = document.createElement('iframe');
        iframe.style.position = 'absolute';
        iframe.style.width = '794px'; // Exact width for A4 portrait with 10mm margins (210mm at 96dpi)
        iframe.style.height = 'auto';
        iframe.style.left = '-9999px';
        document.body.appendChild(iframe);
        
        const iframeDoc = iframe.contentWindow?.document;
        if (!iframeDoc) {
          throw new Error('Could not create iframe document');
        }
        
        iframeDoc.open();
        iframeDoc.write(`
          <!DOCTYPE html>
          <html dir="rtl">
          <head>
            <meta charset="utf-8">
          </head>
          <body>
            <div id="pdf-content">
              <style>
                #pdf-content {
                  font-family: Arial, sans-serif;
                  background-color: white;
                  color: black;
                }
                #pdf-content h2 {
                  text-align: center;
                  margin-bottom: 15px;
                  font-size: 18pt;
                }
                #pdf-content table {
                  width: 100%;
                  border-collapse: collapse;
                  font-size: 8pt;
                  table-layout: fixed;
                }
                #pdf-content thead {
                  display: table-header-group;
                }
                #pdf-content th, #pdf-content td {
                  border: 1px solid #000;
                  padding: 4px;
                  text-align: right;
                  word-wrap: break-word;
                  vertical-align: top;
                  line-height: 1.2;
                  page-break-inside: avoid;
                }
                #pdf-content th {
                  background-color: #f2f2f2;
                  font-weight: bold;
                }
                #pdf-content tr {
                  page-break-inside: avoid !important;
                  page-break-after: auto;
                }
                .table-products th:nth-child(1) { width: 15%; } /* اسم المنتج */
                .table-products th:nth-child(2) { width: 10%; } /* التصنيف */
                .table-products th:nth-child(3) { width: 8%; } /* النوع */
                .table-products th:nth-child(4) { width: 25%; } /* التسعيرات */
                .table-products th:nth-child(5) { width: 42%; } /* ملاحظات */

                .table-sales th:nth-child(1) { width: 15%; } /* اسم الزبون */
                .table-sales th:nth-child(2) { width: 15%; } /* معرف الزبون */
                .table-sales th:nth-child(3) { width: 20%; } /* اسم المنتج */
                .table-sales th:nth-child(4) { width: 10%; } /* السعر */
                .table-sales th:nth-child(5) { width: 15%; } /* التاريخ */
                .table-sales th:nth-child(6) { width: 25%; } /* ملاحظات */

                .table-subscriptions th:nth-child(1) { width: 25%; } /* اسم الاشتراك */
                .table-subscriptions th:nth-child(2) { width: 15%; } /* التصنيف */
                .table-subscriptions th:nth-child(3) { width: 15%; } /* تاريخ التفعيل */
                .table-subscriptions th:nth-child(4) { width: 15%; } /* تاريخ الانتهاء */
                .table-subscriptions th:nth-child(5) { width: 30%; } /* ملاحظات */

                .table-customers th:nth-child(1) { width: 15%; } /* رقم الزبون */
                .table-customers th:nth-child(2) { width: 20%; } /* اسم الزبون */
                .table-customers th:nth-child(3) { width: 20%; } /* معرف الزبون */
                .table-customers th:nth-child(4) { width: 20%; } /* ملاحظات */
                .table-customers th:nth-child(5) { width: 25%; } /* المشتريات */

                .table-transactions th:nth-child(1) { width: 10%; } /* النوع */
                .table-transactions th:nth-child(2) { width: 20%; } /* الشخص / الجهة */
                .table-transactions th:nth-child(3) { width: 30%; } /* الوصف */
                .table-transactions th:nth-child(4) { width: 15%; } /* المبلغ */
                .table-transactions th:nth-child(5) { width: 10%; } /* التاريخ */
                .table-transactions th:nth-child(6) { width: 15%; } /* تاريخ الإضافة */
              </style>
              <h2>جدول ${exportTable === 'products' ? 'المنتجات' : exportTable === 'transactions' ? 'المعاملات المالية' : exportTable}</h2>
              <table class="table-${exportTable}">
                <thead>
                  <tr>
                    ${headers.map(h => `<th>${h}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${data.map(row => `
                    <tr class="pdf-row" style="page-break-inside: avoid;">
                      ${headers.map(h => `<td>${row[h] !== null && row[h] !== undefined ? String(row[h]) : ''}</td>`).join('')}
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </body>
          </html>
        `);
        iframeDoc.close();
        
        // Set iframe height to content height to ensure html2canvas captures everything
        iframe.style.height = iframeDoc.documentElement.scrollHeight + 'px';
        
        const container = iframeDoc.getElementById('pdf-content');
        
        const opt = {
          margin:       [10, 10, 10, 10] as [number, number, number, number],
          filename:     `تصدير_${exportTable}_${new Date().toISOString().split('T')[0]}.pdf`,
          image:        { type: 'jpeg' as const, quality: 1 },
          pagebreak:    { mode: ['avoid-all', 'css', 'legacy'], avoid: '.pdf-row' },
          html2canvas:  { 
            scale: 2, 
            useCORS: true, 
            logging: false,
            windowWidth: 794,
            onclone: (clonedDoc: Document) => {
              // Remove all stylesheets from the cloned document to prevent html2canvas
              // from trying to parse Tailwind's oklch colors which it doesn't support
              const styles = clonedDoc.querySelectorAll('style, link[rel="stylesheet"]');
              styles.forEach(s => {
                // Keep the styles we injected into the iframe
                if (!s.innerHTML.includes('#pdf-content')) {
                  s.remove();
                }
              });
            }
          },
          jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' as const }
        };
        
        await html2pdf().set(opt).from(container).save();
        
        document.body.removeChild(iframe);
        setIsExporting(false);
        return;
      }

      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `تصدير_${exportTable}_${new Date().toISOString().split('T')[0]}.${fileExtension}`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

    } catch (error: any) {
      console.error('Export error:', error);
      alert(`حدث خطأ أثناء التصدير: ${error.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Export Section */}
      <div className="bg-white dark:bg-slate-800 shadow-sm rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden transition-colors duration-200">
        <div className="p-5 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 flex items-center gap-2">
          <div className="bg-emerald-100 dark:bg-emerald-500/20 p-2 rounded-lg">
            <Download className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">تصدير البيانات</h2>
        </div>
        <div className="p-6">
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
            يمكنك سحب المعلومات من أي صفحة وتصديرها على شكل ملف مرتب ومقسم بشكل واضح.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">اختر الصفحة / القسم</label>
              <select
                className="block w-full border border-gray-300 dark:border-slate-600 rounded-xl shadow-sm py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                value={exportTable}
                onChange={(e) => setExportTable(e.target.value)}
              >
                <option value="products">المنتجات</option>
                <option value="subscriptions">الاشتراكات</option>
                <option value="customers">الزبائن</option>
                <option value="sales">سجل البيع</option>
                <option value="transactions">المالية (المعاملات)</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">صيغة الملف</label>
              <div className="grid grid-cols-2 gap-3">
                <label className={`flex items-center justify-center gap-2 px-3 py-2.5 border rounded-xl cursor-pointer transition-all ${exportFormat === 'excel' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400' : 'border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-600'}`}>
                  <input type="radio" name="format" value="excel" checked={exportFormat === 'excel'} onChange={() => setExportFormat('excel')} className="sr-only" />
                  <FileSpreadsheet className="w-4 h-4" />
                  <span className="text-sm font-medium">Excel</span>
                </label>
                <label className={`flex items-center justify-center gap-2 px-3 py-2.5 border rounded-xl cursor-pointer transition-all ${exportFormat === 'pdf' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400' : 'border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-600'}`}>
                  <input type="radio" name="format" value="pdf" checked={exportFormat === 'pdf'} onChange={() => setExportFormat('pdf')} className="sr-only" />
                  <FileIcon className="w-4 h-4" />
                  <span className="text-sm font-medium">PDF</span>
                </label>
                <label className={`flex items-center justify-center gap-2 px-3 py-2.5 border rounded-xl cursor-pointer transition-all ${exportFormat === 'csv' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400' : 'border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-600'}`}>
                  <input type="radio" name="format" value="csv" checked={exportFormat === 'csv'} onChange={() => setExportFormat('csv')} className="sr-only" />
                  <FileText className="w-4 h-4" />
                  <span className="text-sm font-medium">CSV</span>
                </label>
                <label className={`flex items-center justify-center gap-2 px-3 py-2.5 border rounded-xl cursor-pointer transition-all ${exportFormat === 'json' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400' : 'border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-600'}`}>
                  <input type="radio" name="format" value="json" checked={exportFormat === 'json'} onChange={() => setExportFormat('json')} className="sr-only" />
                  <FileJson className="w-4 h-4" />
                  <span className="text-sm font-medium">JSON</span>
                </label>
              </div>
            </div>
            
            <div>
              <button
                onClick={handleExport}
                disabled={isExporting}
                className="w-full inline-flex items-center justify-center px-5 py-2.5 border border-transparent text-sm font-medium rounded-xl text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isExporting ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin ml-2"></div>
                ) : (
                  <Download className="w-5 h-5 ml-2" />
                )}
                {isExporting ? 'جاري التصدير...' : 'تصدير البيانات'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Suppliers Section */}
      <div className="bg-white dark:bg-slate-800 shadow-sm rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden transition-colors duration-200">
        <div className="p-5 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-100 dark:bg-indigo-500/20 p-2 rounded-lg">
              <Store className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">إعدادات الموردين وسعر الصرف</h2>
          </div>
          <button
            onClick={() => handleOpenModal()}
            className="w-full sm:w-auto inline-flex items-center justify-center px-5 py-2.5 border border-transparent text-sm font-medium rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-all active:scale-[0.98]"
          >
            <Plus className="w-5 h-5 ml-2 -mr-1" />
            إضافة مورد جديد
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
            <thead className="bg-slate-50 dark:bg-slate-800/50">
              <tr>
                <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">اسم المورد / الموقع</th>
                <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">سعر الصرف (معامل الضرب)</th>
                <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">إجراءات</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
              {suppliers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                    <div className="flex flex-col items-center justify-center">
                      <Store className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-4" />
                      <p className="text-lg font-medium text-slate-900 dark:text-white">لا يوجد موردين</p>
                      <p className="text-sm mt-1">أضف موردين لتحديد أسعار صرف مختلفة لكل موقع.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                suppliers.map((supplier) => (
                  <tr key={supplier.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-bold text-slate-900 dark:text-white">{supplier.name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-sm font-medium bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400">
                        {supplier.multiplier.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleOpenModal(supplier)}
                          className="p-2 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg transition-colors"
                          title="تعديل"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(supplier.id)}
                          className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                          title="حذف"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* IP Logs Section */}
      <div className="bg-white dark:bg-slate-800 shadow-sm rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden transition-colors duration-200">
        <div className="p-5 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 flex items-center gap-2">
          <div className="bg-red-100 dark:bg-red-500/20 p-2 rounded-lg">
            <Shield className="w-5 h-5 text-red-600 dark:text-red-400" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">سجل الدخول والأمان (IP Logs)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
            <thead className="bg-slate-50 dark:bg-slate-800/50">
              <tr>
                <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">عنوان IP</th>
                <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">الصلاحية</th>
                <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">الجهاز / المتصفح</th>
                <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">آخر دخول</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
              {ipLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                    <div className="flex flex-col items-center justify-center">
                      <Shield className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-4" />
                      <p className="text-lg font-medium text-slate-900 dark:text-white">لا يوجد سجلات دخول</p>
                    </div>
                  </td>
                </tr>
              ) : (
                ipLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-bold text-slate-900 dark:text-white" dir="ltr">{log.ip_address}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-sm font-medium ${
                        log.user_role === 'admin' 
                          ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400'
                          : 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                      }`}>
                        {log.user_role === 'admin' ? 'مدير' : 'مشاهد'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-xs text-slate-500 dark:text-slate-400 max-w-xs truncate" title={log.device_info}>{log.device_info}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-slate-600 dark:text-slate-300" dir="ltr">
                        {new Date(log.timestamp).toLocaleString('ar-EG')}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-gray-900/40 dark:bg-slate-900/60 backdrop-blur-sm transition-opacity" aria-hidden="true" onClick={handleCloseModal}></div>
          
          <div className="relative bg-white dark:bg-slate-800 rounded-2xl text-right shadow-2xl w-full max-w-md border border-gray-100 dark:border-slate-700 flex flex-col animate-in fade-in zoom-in-95 duration-200 transition-colors">
            <div className="bg-gray-50/80 dark:bg-slate-800/80 px-6 py-4 border-b border-gray-100 dark:border-slate-700 flex justify-between items-center shrink-0 rounded-t-2xl">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2" id="modal-title">
                {editingSupplier ? <Edit2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" /> : <Plus className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
                {editingSupplier ? 'تعديل المورد' : 'إضافة مورد جديد'}
              </h3>
              <button onClick={handleCloseModal} className="text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors rounded-full p-1 hover:bg-gray-200 dark:hover:bg-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col">
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">اسم المورد / الموقع <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    id="name"
                    required
                    className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="مثال: علي إكسبرس، أمازون..."
                  />
                </div>
                <div>
                  <label htmlFor="multiplier" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">سعر الصرف (معامل الضرب) <span className="text-red-500">*</span></label>
                  <input
                    type="number"
                    id="multiplier"
                    required
                    min="0"
                    step="0.01"
                    className="block w-full border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 sm:text-sm transition-shadow bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                    value={formData.multiplier}
                    onChange={(e) => setFormData({ ...formData, multiplier: Number(e.target.value) })}
                    placeholder="مثال: 1500"
                  />
                </div>
              </div>
              
              <div className="bg-gray-50 dark:bg-slate-800/80 px-6 py-4 border-t border-gray-100 dark:border-slate-700 sm:flex sm:flex-row-reverse gap-3 shrink-0 rounded-b-2xl">
                <button
                  type="submit"
                  className="w-full inline-flex justify-center items-center rounded-lg border border-transparent shadow-sm px-5 py-2.5 bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:w-auto transition-colors"
                >
                  <CheckCircle className="w-4 h-4 ml-2" />
                  حفظ البيانات
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
    </div>
  );
}
