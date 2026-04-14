import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';

type Role = 'admin' | 'viewer' | 'pending' | null;

interface AuthContextType {
  role: Role;
  token: string | null;
  isApproved: boolean;
  login: (token: string, role: Role) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [role, setRole] = useState<Role>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isApproved, setIsApproved] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true);
  const sessionCreationInProgress = useRef(false);
  const currentTokenRef = useRef<string | null>(null);

  useEffect(() => {
    const getDeviceInfo = () => {
      const ua = navigator.userAgent;
      if (/mobile/i.test(ua)) {
        if (/iPhone/i.test(ua)) return 'iPhone';
        if (/iPad/i.test(ua)) return 'iPad';
        if (/Android/i.test(ua)) return 'Android Mobile';
        return 'Mobile Device';
      }
      if (/Macintosh/i.test(ua)) return 'Mac';
      if (/Windows/i.test(ua)) return 'Windows PC';
      if (/Linux/i.test(ua)) return 'Linux PC';
      return 'Unknown Device';
    };

    const checkUser = async (session: any) => {
      if (session?.user) {
        setToken(session.access_token);
        currentTokenRef.current = session.access_token;
        const userEmail = session.user.email;
        
        // Bootstrap Admin: Automatically approve this specific email
        const ADMIN_EMAIL = 'abutrabali40@gmail.com';
        const isSuperAdmin = userEmail === ADMIN_EMAIL;

        if (isSuperAdmin) {
          console.log("Super Admin detected, bypassing checks...");
          setRole('admin');
          setIsApproved(true);
          
          // Try to ensure the record exists in DB as admin
          await supabase.from('app_users').upsert({
            id: session.user.id,
            email: userEmail,
            role: 'admin',
            is_approved: true
          });
          
          // Session Tracking
          try {
            let sid = sessionStorage.getItem('current_session_id');
            if (!sid && !sessionCreationInProgress.current) {
              sessionCreationInProgress.current = true;
              const { data: sessionData } = await supabase.from('user_sessions').insert([{ 
                user_id: session.user.id,
                device_info: getDeviceInfo()
              }]).select().single();
              if (sessionData) sessionStorage.setItem('current_session_id', sessionData.id);
              sessionCreationInProgress.current = false;
            }
          } catch (e) {
            sessionCreationInProgress.current = false;
          }
          
          setIsLoading(false);
          return;
        }
        
        // Check if user exists in app_users
        const { data: userRecord, error } = await supabase
          .from('app_users')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (error) {
          console.log("Supabase fetch error:", error.code, error.message);
        }

        if (error && (error.code === 'PGRST116' || error.code === '42P01' || error.code === '42501')) {
          // User doesn't exist, table doesn't exist, or RLS blocked read. Try creating them.
          console.log("Attempting to create new user record...");
          const { data: newUser, error: insertError } = await supabase
            .from('app_users')
            .insert([
              { 
                id: session.user.id, 
                email: session.user.email, 
                role: 'pending', 
                is_approved: false 
              }
            ])
            .select()
            .single();
            
          if (!insertError && newUser) {
            console.log("New user created successfully:", newUser);
            setRole(newUser.role as Role);
            setIsApproved(newUser.is_approved);
          } else {
            console.error("Could not create user record. Insert error:", insertError?.code, insertError?.message);
            // If error is 23505 (duplicate key), it means the user exists but RLS blocked the SELECT.
            if (insertError?.code === '23505') {
              console.error("CRITICAL: User exists in database but RLS policies are blocking read access!");
            }
            setRole('pending');
            setIsApproved(false);
          }
        } else if (userRecord) {
          console.log("User record found:", userRecord);
          setRole(userRecord.role as Role);
          setIsApproved(userRecord.is_approved);
          
          if (userRecord.is_approved) {
            // Session Tracking
            try {
              let sid = sessionStorage.getItem('current_session_id');
              if (!sid && !sessionCreationInProgress.current) {
                sessionCreationInProgress.current = true;
                const { data: sessionData } = await supabase.from('user_sessions').insert([{ 
                  user_id: session.user.id,
                  device_info: getDeviceInfo()
                }]).select().single();
                if (sessionData) sessionStorage.setItem('current_session_id', sessionData.id);
                sessionCreationInProgress.current = false;
              }
            } catch (e) {
              sessionCreationInProgress.current = false;
            }
          }
        }
      } else {
        setToken(null);
        currentTokenRef.current = null;
        setRole(null);
        setIsApproved(false);
      }
      setIsLoading(false);
    };

    // Initial check
    supabase.auth.getSession().then(({ data: { session } }) => {
      checkUser(session);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      checkUser(session);
    });

    // Track window close for session logout
    const handleUnload = () => {
      const sid = sessionStorage.getItem('current_session_id');
      if (sid && currentTokenRef.current) {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        if (supabaseUrl && supabaseKey) {
          const url = `${supabaseUrl}/rest/v1/user_sessions?id=eq.${sid}`;
          fetch(url, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'apikey': supabaseKey,
              'Authorization': `Bearer ${currentTokenRef.current}`,
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ logout_time: new Date().toISOString() }),
            keepalive: true
          }).catch(() => {});
        }
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        handleUnload();
      }
    });

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('visibilitychange', handleUnload);
    };
  }, []);

  const login = (newToken: string, newRole: Role) => {
    // This is kept for backward compatibility if needed, but Supabase handles real login
    setToken(newToken);
    setRole(newRole);
  };

  const logout = async () => {
    try {
      const sid = sessionStorage.getItem('current_session_id');
      if (sid) {
        await supabase.from('user_sessions').update({ logout_time: new Date().toISOString() }).eq('id', sid);
        sessionStorage.removeItem('current_session_id');
      }
    } catch (e) {}
    
    await supabase.auth.signOut();
    setToken(null);
    setRole(null);
    setIsApproved(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400"></div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ role, token, isApproved, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
