import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { useState, useEffect, createContext, useContext } from "react";

// Pages
import LoginPage from "@/pages/LoginPage";
import SignupPage from "@/pages/SignupPage";
import DashboardPage from "@/pages/DashboardPage";
import NewCasePage from "@/pages/NewCasePage";
import AIOutputPage from "@/pages/AIOutputPage";
import ReportViewPage from "@/pages/ReportViewPage";
import CaseHistoryPage from "@/pages/CaseHistoryPage";
import PrescriptionPage from "@/pages/PrescriptionPage";
import PrescriptionPrintPage from "@/pages/PrescriptionPrintPage";
import SettingsPage from "@/pages/SettingsPage";

// Auth Context
const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};

const AuthProvider = ({ children }) => {
  const [doctor, setDoctor] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem("token");
    const storedDoctor = localStorage.getItem("doctor");
    if (storedToken && storedDoctor) {
      setToken(storedToken);
      setDoctor(JSON.parse(storedDoctor));
    }
    setLoading(false);
  }, []);

  const login = (tokenData, doctorData) => {
    localStorage.setItem("token", tokenData);
    localStorage.setItem("doctor", JSON.stringify(doctorData));
    setToken(tokenData);
    setDoctor(doctorData);
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("doctor");
    setToken(null);
    setDoctor(null);
  };

  const isAuthenticated = !!token;

  return (
    <AuthContext.Provider value={{ doctor, token, login, logout, isAuthenticated, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

// Protected Route
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

// Public Route (redirect if authenticated)
const PublicRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
          <Route path="/signup" element={<PublicRoute><SignupPage /></PublicRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/new-case" element={<ProtectedRoute><NewCasePage /></ProtectedRoute>} />
          <Route path="/case/:caseId/analysis" element={<ProtectedRoute><AIOutputPage /></ProtectedRoute>} />
          <Route path="/case/:caseId/report" element={<ProtectedRoute><ReportViewPage /></ProtectedRoute>} />
          <Route path="/history" element={<ProtectedRoute><CaseHistoryPage /></ProtectedRoute>} />
          <Route path="/prescription" element={<ProtectedRoute><PrescriptionPage /></ProtectedRoute>} />
          <Route path="/prescription/print" element={<ProtectedRoute><PrescriptionPrintPage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
        </Routes>
        <Toaster position="top-right" richColors />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
