import React, { createContext, useContext, useState, useEffect } from 'react';
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

  useEffect(() => {
    const checkUser = async (session: any) => {
      if (session?.user) {
        setToken(session.access_token);
        
        // Check if user exists in app_users
        const { data: userRecord, error } = await supabase
          .from('app_users')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (error && (error.code === 'PGRST116' || error.code === '42P01' || error.code === '42501')) {
          // User doesn't exist, table doesn't exist, or RLS blocked read. Try creating them.
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
            setRole(newUser.role as Role);
            setIsApproved(newUser.is_approved);
          } else {
            // Fallback if table doesn't exist yet
            console.error("Could not create user record, table might not exist:", insertError);
            setRole('pending');
            setIsApproved(false);
          }
        } else if (userRecord) {
          setRole(userRecord.role as Role);
          setIsApproved(userRecord.is_approved);
        }
      } else {
        setToken(null);
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

    return () => subscription.unsubscribe();
  }, []);

  const login = (newToken: string, newRole: Role) => {
    // This is kept for backward compatibility if needed, but Supabase handles real login
    setToken(newToken);
    setRole(newRole);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setToken(null);
    setRole(null);
    setIsApproved(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 dark:border-indigo-400"></div>
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
