import React, { createContext, useContext, useState, useEffect } from 'react';

type Role = 'admin' | 'viewer' | null;

interface AuthContextType {
  role: Role;
  token: string | null;
  login: (token: string, role: Role) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [role, setRole] = useState<Role>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const savedToken = localStorage.getItem('authToken');
    const savedRole = localStorage.getItem('authRole') as Role;
    if (savedToken && savedRole) {
      setToken(savedToken);
      setRole(savedRole);
    }
  }, []);

  const login = (newToken: string, newRole: Role) => {
    setToken(newToken);
    setRole(newRole);
    localStorage.setItem('authToken', newToken);
    localStorage.setItem('authRole', newRole || '');
  };

  const logout = () => {
    setToken(null);
    setRole(null);
    localStorage.removeItem('authToken');
    localStorage.removeItem('authRole');
  };

  return (
    <AuthContext.Provider value={{ role, token, login, logout }}>
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
