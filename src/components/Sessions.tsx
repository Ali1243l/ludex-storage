import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { Activity, Clock, LogIn, LogOut, Timer, Smartphone, Monitor, Laptop, Trash2 } from 'lucide-react';
import ConfirmDeleteModal from './ConfirmDeleteModal';

interface UserSession {
  id: string;
  user_id: string;
  login_time: string;
  logout_time: string | null;
  device_info: string | null;
  app_users: {
    email: string;
  };
}

export default function Sessions() {
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('user_sessions')
      .select('*, app_users(email)')
      .order('login_time', { ascending: false })
      .limit(100);
      
    if (data) setSessions(data as any);
    setIsLoading(false);
  };

  const formatTime = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('ar-IQ', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  };

  const calculateDuration = (login: string, logout: string | null) => {
    const start = new Date(login).getTime();
    const end = logout ? new Date(logout).getTime() : new Date().getTime();
    const diffInSeconds = Math.floor((end - start) / 1000);
    
    if (diffInSeconds < 60) return `${diffInSeconds} ثانية`;
    const minutes = Math.floor(diffInSeconds / 60);
    if (minutes < 60) return `${minutes} دقيقة`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours} ساعة و ${remainingMinutes} دقيقة`;
  };

  const getDeviceIcon = (device: string | null) => {
    if (!device) return <Monitor className="w-4 h-4 text-slate-400" />;
    if (device.includes('iPhone') || device.includes('Android Mobile') || device.includes('Mobile')) {
      return <Smartphone className="w-4 h-4 text-blue-500" />;
    }
    if (device.includes('iPad')) {
      return <Laptop className="w-4 h-4 text-indigo-500" />;
    }
    return <Monitor className="w-4 h-4 text-slate-500" />;
  };

  const handleClearSessions = async () => {
    setIsClearing(true);
    try {
      // Delete all sessions except the current active one (optional, but let's just delete all for simplicity as requested)
      const { error } = await supabase
        .from('user_sessions')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Dummy condition to delete all rows
      
      if (!error) {
        setSessions([]);
      }
    } catch (error) {
      console.error('Error clearing sessions:', error);
    } finally {
      setIsClearing(false);
      setIsClearModalOpen(false);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            سجل الجلسات والدخول
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            مراقبة أوقات دخول وخروج المستخدمين والمدة التي قضوها في النظام
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsClearModalOpen(true)}
            disabled={sessions.length === 0 || isClearing}
            className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden sm:inline">مسح السجل</span>
          </button>
          <button
            onClick={fetchSessions}
            className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
          >
            تحديث السجل
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 shadow-sm rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
            <thead className="bg-slate-50 dark:bg-slate-800/50">
              <tr>
                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  المستخدم
                </th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  الجهاز
                </th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  وقت الدخول
                </th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  وقت الخروج
                </th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  المدة المقضية
                </th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  الحالة
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400"></div>
                      <span className="mt-2 text-sm text-slate-500 dark:text-slate-400">جاري تحميل السجل...</span>
                    </div>
                  </td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                    لا توجد جلسات مسجلة حتى الآن.
                  </td>
                </tr>
              ) : (
                sessions.map((session) => (
                  <tr key={session.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold ml-3">
                          {session.app_users?.email?.charAt(0).toUpperCase() || '?'}
                        </div>
                        <span className="text-sm font-medium text-slate-900 dark:text-white">
                          {session.app_users?.email || 'مستخدم غير معروف'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center text-sm text-slate-600 dark:text-slate-300">
                        {getDeviceIcon(session.device_info)}
                        <span className="mr-2">{session.device_info || 'غير معروف'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center text-sm text-slate-600 dark:text-slate-300">
                        <LogIn className="w-4 h-4 ml-1.5 text-emerald-500" />
                        <span dir="ltr">{formatTime(session.login_time)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center text-sm text-slate-600 dark:text-slate-300">
                        <LogOut className="w-4 h-4 ml-1.5 text-rose-500" />
                        <span dir="ltr">{formatTime(session.logout_time)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center text-sm font-medium text-slate-900 dark:text-white">
                        <Timer className="w-4 h-4 ml-1.5 text-blue-500" />
                        {calculateDuration(session.login_time, session.logout_time)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {session.logout_time ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-300">
                          منتهية
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 ml-1.5 animate-pulse"></span>
                          نشط الآن
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDeleteModal
        isOpen={isClearModalOpen}
        onClose={() => setIsClearModalOpen(false)}
        onConfirm={handleClearSessions}
        title="مسح سجل الدخول بالكامل"
        message="هل أنت متأكد من مسح جميع بيانات سجل الدخول؟ هذا الإجراء سيحذف جميع الجلسات السابقة ولا يمكن التراجع عنه."
      />
    </div>
  );
}
