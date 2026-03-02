import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { caseAPI, aiAPI } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ArrowLeft, Search, Calendar, ChevronRight,
  RefreshCw, Edit, Eye, Loader2, FileText,
  Stethoscope, Filter
} from "lucide-react";

const CaseHistoryPage = () => {
  const navigate = useNavigate();
  const [cases, setCases] = useState([]);
  const [filteredCases, setFilteredCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [rerunningId, setRerunningId] = useState(null);

  useEffect(() => {
    fetchCases();
  }, []);

  useEffect(() => {
    filterCases();
  }, [searchQuery, cases]);

  const fetchCases = async () => {
    try {
      const response = await caseAPI.list();
      setCases(response.data);
      setFilteredCases(response.data);
    } catch (error) {
      toast.error("Failed to load cases");
    } finally {
      setLoading(false);
    }
  };

  const filterCases = () => {
    if (!searchQuery.trim()) {
      setFilteredCases(cases);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = cases.filter((c) => {
      const symptoms = c.symptoms.join(" ").toLowerCase();
      const id = c.id.toLowerCase();
      const pName = c.patient_name ? c.patient_name.toLowerCase() : "";
      return symptoms.includes(query) || id.includes(query) || pName.includes(query);
    });
    setFilteredCases(filtered);
  };

  const handleRerunAnalysis = async (caseId, e) => {
    e.stopPropagation();
    setRerunningId(caseId);
    try {
      await aiAPI.analyseCase(caseId);
      toast.success("Analysis updated!");
      fetchCases();
    } catch (error) {
      toast.error("Failed to re-run analysis");
    } finally {
      setRerunningId(null);
    }
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatTime = (dateStr) => {
    return new Date(dateStr).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-16 gap-4">
            <button
              onClick={() => navigate("/dashboard")}
              className="p-2 -ml-2 hover:bg-slate-100 rounded-lg transition-colors"
              data-testid="back-to-dashboard-btn"
            >
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
            <h1 className="text-lg font-semibold text-slate-900">Case History</h1>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search & Filter */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search by patient name, symptoms, or case ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 max-w-md"
              data-testid="search-cases-input"
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-slate-900">{cases.length}</p>
              <p className="text-sm text-slate-600">Total Cases</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-green-600">
                {cases.filter((c) => c.ai_analysis).length}
              </p>
              <p className="text-sm text-slate-600">Analyzed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-amber-600">
                {cases.filter((c) => !c.ai_analysis).length}
              </p>
              <p className="text-sm text-slate-600">Pending</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-slate-900">{filteredCases.length}</p>
              <p className="text-sm text-slate-600">Showing</p>
            </CardContent>
          </Card>
        </div>

        {/* Cases List */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle>All Cases</CardTitle>
            <CardDescription>Click on a case to view details</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : filteredCases.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                  <FileText className="w-8 h-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-medium text-slate-900 mb-1">
                  {searchQuery ? "No matching cases" : "No cases yet"}
                </h3>
                <p className="text-slate-600">
                  {searchQuery
                    ? "Try a different search term"
                    : "Start by creating a new patient case"}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredCases.map((caseItem) => (
                  <div
                    key={caseItem.id}
                    className="flex items-center justify-between p-4 rounded-lg border border-slate-200 hover:border-primary/30 hover:bg-slate-50 transition-all cursor-pointer group"
                    onClick={() =>
                      navigate(
                        caseItem.ai_analysis
                          ? `/case/${caseItem.id}/analysis`
                          : `/new-case?edit=${caseItem.id}`
                      )
                    }
                    data-testid={`history-case-${caseItem.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <Stethoscope className="w-4 h-4 text-primary" />
                        <span className="font-medium text-slate-900">
                          {caseItem.patient_name ? `${caseItem.patient_name} (Case #${caseItem.id.slice(0, 8)})` : `Case #${caseItem.id.slice(0, 8)}`}
                        </span>
                        {caseItem.ai_analysis ? (
                          <Badge
                            variant="secondary"
                            className="bg-green-100 text-green-700 border-0"
                          >
                            Analyzed
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-600 border-amber-300">
                            Pending
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {caseItem.symptoms.slice(0, 4).map((s) => (
                          <span
                            key={s}
                            className="inline-block px-2 py-0.5 bg-slate-100 rounded text-xs text-slate-600 capitalize"
                          >
                            {s}
                          </span>
                        ))}
                        {caseItem.symptoms.length > 4 && (
                          <span className="text-xs text-slate-500">
                            +{caseItem.symptoms.length - 4} more
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatDate(caseItem.created_at)}
                        </span>
                        <span>{formatTime(caseItem.created_at)}</span>
                        <span>Duration: {caseItem.duration.replace(/_/g, " ")}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/new-case?edit=${caseItem.id}`);
                        }}
                        data-testid={`edit-case-${caseItem.id}`}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => handleRerunAnalysis(caseItem.id, e)}
                        disabled={rerunningId === caseItem.id}
                        data-testid={`rerun-case-${caseItem.id}`}
                      >
                        {rerunningId === caseItem.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                      </Button>
                      <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-primary transition-colors" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default CaseHistoryPage;
