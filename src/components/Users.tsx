import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../AuthContext';
import { Users as UsersIcon, CheckCircle, XCircle, Shield, User } from 'lucide-react';

interface AppUser {
  id: string;
  email: string;
  role: string;
  is_approved: boolean;
}

export default function Users() {
  const { role } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setIsLoading(true);
    const { data, error } = await supabase.from('app_users').select('*').order('is_approved', { ascending: true });
    if (data) setUsers(data as AppUser[]);
    if (error) console.error("Error fetching users:", error);
    setIsLoading(false);
  };

  const handleApprove = async (id: string, newRole: string) => {
    const { error } = await supabase
      .from('app_users')
      .update({ is_approved: true, role: newRole })
      .eq('id', id);
      
    if (error) {
      alert(`حدث خطأ: ${error.message}`);
    } else {
      fetchUsers();
    }
  };

  const handleReject = async (id: string) => {
    const { error } = await supabase
      .from('app_users')
      .delete()
      .eq('id', id);
      
    if (error) {
      alert(`حدث خطأ: ${error.message}`);
    } else {
      fetchUsers();
    }
  };

  if (role !== 'admin') {
    return <div className="p-8 text-center text-red-500">لا تملك صلاحية للوصول إلى هذه الصفحة</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-indigo-100 dark:bg-indigo-500/20 p-2 rounded-lg">
          <UsersIcon className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">إدارة المستخدمين</h2>
      </div>

      <div className="bg-white dark:bg-slate-800 shadow-sm rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
            <thead className="bg-slate-50 dark:bg-slate-800/50">
              <tr>
                <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">البريد الإلكتروني</th>
                <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">الحالة</th>
                <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">الرتبة</th>
                <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">إجراءات</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-500">جاري التحميل...</td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-500">لا يوجد مستخدمين</td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-white">
                      {user.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {user.is_approved ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-500/10 dark:text-green-400">
                          موافق عليه
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-500/10 dark:text-yellow-400">
                          قيد الانتظار
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
                      {user.role === 'admin' ? (
                        <span className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400"><Shield className="w-4 h-4" /> أدمن</span>
                      ) : user.role === 'viewer' ? (
                        <span className="flex items-center gap-1 text-slate-600 dark:text-slate-400"><User className="w-4 h-4" /> مشاهد</span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      {!user.is_approved ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleApprove(user.id, 'viewer')}
                            className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700"
                          >
                            <CheckCircle className="w-4 h-4 ml-1" />
                            قبول كمشاهد
                          </button>
                          <button
                            onClick={() => handleApprove(user.id, 'admin')}
                            className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-lg text-white bg-emerald-600 hover:bg-emerald-700"
                          >
                            <Shield className="w-4 h-4 ml-1" />
                            قبول كأدمن
                          </button>
                          <button
                            onClick={() => handleReject(user.id)}
                            className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-lg text-white bg-red-600 hover:bg-red-700"
                          >
                            <XCircle className="w-4 h-4 ml-1" />
                            رفض
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleApprove(user.id, user.role === 'admin' ? 'viewer' : 'admin')}
                            className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300"
                          >
                            تغيير إلى {user.role === 'admin' ? 'مشاهد' : 'أدمن'}
                          </button>
                          <button
                            onClick={() => handleReject(user.id)}
                            className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 mr-4"
                          >
                            حذف
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
      </div>
    </div>
  );
}