import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { Package, LogIn, AlertCircle, Clock } from 'lucide-react';
import { supabase } from '../supabaseClient';

export default function Login() {
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { role, isApproved, logout } = useAuth();

  const handleGoogleLogin = async () => {
    setError('');
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google'
      });
      if (error) throw error;
    } catch (err: any) {
      console.error('Login error:', err);
      setError(`حدث خطأ أثناء تسجيل الدخول: ${err.message}`);
      setIsLoading(false);
    }
  };

  // If user is logged in but not approved
  if (role === 'pending' || (role && !isApproved)) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8 transition-colors duration-200" dir="rtl">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="flex justify-center">
            <div className="bg-amber-500 p-3 rounded-2xl shadow-lg">
              <Clock className="w-10 h-10 text-white" />
            </div>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-slate-900 dark:text-white">
            في انتظار الموافقة
          </h2>
          <p className="mt-2 text-center text-sm text-slate-600 dark:text-slate-400 px-4">
            تم تسجيل دخولك بنجاح، ولكن حسابك يحتاج إلى موافقة من الإدارة قبل أن تتمكن من استخدام النظام. يرجى الانتظار حتى يتم تفعيل حسابك.
          </p>
          <div className="mt-8 flex justify-center">
            <button
              onClick={logout}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-slate-700 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 transition-colors"
            >
              تسجيل الخروج
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8 transition-colors duration-200" dir="rtl">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="flex flex-col items-center leading-none" dir="ltr">
            <span className="text-6xl font-black text-blue-600 dark:text-blue-500 tracking-tighter" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>Pixel</span>
            <span className="text-2xl font-bold text-amber-500 tracking-widest mt-1">store</span>
          </div>
        </div>
        <p className="mt-2 text-center text-sm text-slate-600 dark:text-slate-400">
          تسجيل الدخول للنظام
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-slate-800 py-8 px-4 shadow sm:rounded-2xl sm:px-10 border border-slate-200 dark:border-slate-700">
          <div className="space-y-6">
            {error && (
              <div className="bg-red-50 dark:bg-red-500/10 border-l-4 border-red-500 p-4 rounded-lg flex items-start">
                <AlertCircle className="w-5 h-5 text-red-500 ml-3 shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            <div>
              <button
                onClick={handleGoogleLogin}
                disabled={isLoading}
                className="w-full flex justify-center items-center py-3 px-4 border border-gray-300 dark:border-slate-600 rounded-xl shadow-sm text-sm font-medium text-slate-700 dark:text-white bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isLoading ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 dark:border-white"></div>
                ) : (
                  <>
                    <svg className="w-5 h-5 ml-2" viewBox="0 0 24 24">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                      />
                    </svg>
                    تسجيل الدخول باستخدام Google
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
