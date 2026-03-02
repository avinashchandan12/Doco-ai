import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { caseAPI } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Stethoscope, Plus, LogOut, User, Calendar,
  ChevronRight, FileText, History, Loader2, AlertCircle
} from "lucide-react";

const DashboardPage = () => {
  const { doctor, logout } = useAuth();
  const navigate = useNavigate();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCases();
  }, []);

  const fetchCases = async () => {
    try {
      const response = await caseAPI.list();
      setCases(response.data);
    } catch (error) {
      toast.error("Failed to load cases");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
    toast.success("Logged out successfully");
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const recentCases = cases.slice(0, 5);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Stethoscope className="w-5 h-5 text-primary" />
              </div>
              <span className="font-semibold text-lg text-slate-900">Clinical Co-Pilot</span>
            </div>
            <div className="flex items-center gap-4">
              <Link to="/settings" className="text-slate-600 hover:text-slate-900 flex items-center gap-1.5" data-testid="settings-nav-link">
                <User className="w-4 h-4" />
                <span className="hidden sm:inline text-sm">Profile</span>
              </Link>
              <Link to="/history" className="text-slate-600 hover:text-slate-900 flex items-center gap-1.5" data-testid="history-nav-link">
                <History className="w-4 h-4" />
                <span className="hidden sm:inline text-sm">History</span>
              </Link>
              <button
                onClick={handleLogout}
                className="text-slate-600 hover:text-slate-900 flex items-center gap-1.5"
                data-testid="logout-btn"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline text-sm">Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Section */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900" data-testid="dashboard-welcome">
                Welcome, Dr. {doctor?.name}
              </h1>
              <p className="text-slate-600 mt-1 flex items-center gap-2">
                <User className="w-4 h-4" />
                {doctor?.qualification} • {doctor?.location}
              </p>
            </div>
            <Button
              onClick={() => navigate("/new-case")}
              size="lg"
              className="gap-2"
              data-testid="new-case-btn"
            >
              <Plus className="w-5 h-5" />
              New Patient Case
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <Card className="bg-white">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <FileText className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{cases.length}</p>
                  <p className="text-sm text-slate-600">Total Cases</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-green-100 flex items-center justify-center">
                  <Stethoscope className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">
                    {cases.filter(c => c.ai_analysis).length}
                  </p>
                  <p className="text-sm text-slate-600">AI Analyzed</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-amber-100 flex items-center justify-center">
                  <Calendar className="w-6 h-6 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">
                    {cases.filter(c => {
                      const today = new Date().toDateString();
                      return new Date(c.created_at).toDateString() === today;
                    }).length}
                  </p>
                  <p className="text-sm text-slate-600">Today</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Cases */}
        <Card className="bg-white">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl">Recent Cases</CardTitle>
                <CardDescription>Your latest patient cases</CardDescription>
              </div>
              {cases.length > 5 && (
                <Link to="/history" className="text-primary text-sm font-medium hover:underline" data-testid="view-all-cases-link">
                  View All
                </Link>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : recentCases.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                  <FileText className="w-8 h-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-medium text-slate-900 mb-1">No cases yet</h3>
                <p className="text-slate-600 mb-4">Start by creating a new patient case</p>
                <Button onClick={() => navigate("/new-case")} data-testid="empty-new-case-btn">
                  <Plus className="w-4 h-4 mr-2" />
                  Create First Case
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {recentCases.map((caseItem) => (
                  <div
                    key={caseItem.id}
                    className="flex items-center justify-between p-4 rounded-lg border border-slate-200 hover:border-primary/30 hover:bg-slate-50 transition-all cursor-pointer group"
                    onClick={() => navigate(caseItem.ai_analysis ? `/case/${caseItem.id}/analysis` : `/new-case?edit=${caseItem.id}`)}
                    data-testid={`case-card-${caseItem.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-slate-900 truncate">
                          {caseItem.patient_name ? `${caseItem.patient_name} (Case #${caseItem.id.slice(0, 8)})` : `Case #${caseItem.id.slice(0, 8)}`}
                        </span>
                        {caseItem.ai_analysis ? (
                          <Badge variant="secondary" className="bg-green-100 text-green-700 border-0">
                            Analyzed
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-600 border-amber-300">
                            Pending
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-slate-600">
                        <span className="truncate max-w-[200px]">
                          {caseItem.symptoms.slice(0, 3).join(", ")}
                          {caseItem.symptoms.length > 3 && "..."}
                        </span>
                        <span className="text-slate-400">•</span>
                        <span>{formatDate(caseItem.created_at)}</span>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-primary transition-colors" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Disclaimer */}
        <div className="mt-8 p-4 rounded-lg bg-amber-50 border border-amber-200">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              <strong>Disclaimer:</strong> This system provides clinical decision support only.
              Final medical judgment rests with the physician.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default DashboardPage;
