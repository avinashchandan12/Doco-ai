import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { caseAPI, aiAPI, reportAPI } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { 
  ArrowLeft, FileText, Edit, Download, RefreshCw, 
  AlertTriangle, CheckCircle, Lightbulb, Pill, 
  ChevronRight, Loader2, Stethoscope, Calendar, Clock
} from "lucide-react";

const AIOutputPage = () => {
  const { caseId } = useParams();
  const navigate = useNavigate();
  const [caseData, setCaseData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rerunning, setRerunning] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);

  useEffect(() => {
    fetchCase();
  }, [caseId]);

  const fetchCase = async () => {
    try {
      const response = await caseAPI.get(caseId);
      setCaseData(response.data);
    } catch (error) {
      toast.error("Failed to load case");
      navigate("/dashboard");
    } finally {
      setLoading(false);
    }
  };

  const handleRerunAnalysis = async () => {
    setRerunning(true);
    try {
      await aiAPI.analyseCase(caseId);
      toast.success("Analysis updated!");
      fetchCase();
    } catch (error) {
      toast.error("Failed to re-run analysis");
    } finally {
      setRerunning(false);
    }
  };

  const handleGenerateReport = async () => {
    setGeneratingReport(true);
    try {
      const response = await reportAPI.generate(caseId);
      const pdfUrl = response.data.pdf_url;
      navigate(`/case/${caseId}/report`, { state: { pdfUrl } });
    } catch (error) {
      toast.error("Failed to generate report");
    } finally {
      setGeneratingReport(false);
    }
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!caseData) {
    return null;
  }

  const analysis = caseData.ai_analysis;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate("/dashboard")}
                className="p-2 -ml-2 hover:bg-slate-100 rounded-lg transition-colors"
                data-testid="back-to-dashboard"
              >
                <ArrowLeft className="w-5 h-5 text-slate-600" />
              </button>
              <h1 className="text-lg font-semibold text-slate-900">AI Clinical Analysis</h1>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/new-case?edit=${caseId}`)}
                data-testid="edit-case-btn"
              >
                <Edit className="w-4 h-4 mr-1.5" />
                Edit
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Case Overview - Sidebar */}
          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Stethoscope className="w-4 h-4 text-primary" />
                  Case Overview
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Case ID</p>
                  <p className="text-sm font-medium text-slate-900">{caseData.id.slice(0, 8)}</p>
                </div>
                <Separator />
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Symptoms</p>
                  <div className="flex flex-wrap gap-1.5">
                    {caseData.symptoms.map((s) => (
                      <Badge key={s} variant="secondary" className="capitalize text-xs">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Separator />
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Duration</p>
                  <p className="text-sm text-slate-700">{caseData.duration.replace(/_/g, " ")}</p>
                </div>
                <Separator />
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Vitals</p>
                  <div className="space-y-1 text-sm text-slate-700">
                    <p>Temp: {caseData.vitals?.temperature || "N/A"}</p>
                    <p>BP: {caseData.vitals?.bp || "N/A"}</p>
                    <p>Pulse: {caseData.vitals?.pulse || "N/A"}</p>
                  </div>
                </div>
                <Separator />
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Calendar className="w-3.5 h-3.5" />
                  {formatDate(caseData.created_at)}
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <Button
                  className="w-full"
                  onClick={handleGenerateReport}
                  disabled={generatingReport}
                  data-testid="generate-report-btn"
                >
                  {generatingReport ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 mr-2" />
                  )}
                  Generate Report
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleRerunAnalysis}
                  disabled={rerunning}
                  data-testid="rerun-analysis-btn"
                >
                  {rerunning ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  Re-run Analysis
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* AI Analysis - Main Content */}
          <div className="lg:col-span-2 space-y-4">
            {!analysis ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="text-slate-600">No AI analysis available yet.</p>
                  <Button className="mt-4" onClick={handleRerunAnalysis} data-testid="run-analysis-btn">
                    Run Analysis
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Clinical Summary */}
                <Card className="overflow-hidden">
                  <CardHeader className="bg-primary/5 pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="w-4 h-4 text-primary" />
                      Clinical Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <p className="text-slate-700 leading-relaxed" data-testid="clinical-summary">
                      {analysis.clinical_summary}
                    </p>
                  </CardContent>
                </Card>

                {/* Considerations */}
                {analysis.considerations?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Lightbulb className="w-4 h-4 text-amber-500" />
                        Possible Considerations
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2" data-testid="considerations-list">
                        {analysis.considerations.map((item, idx) => (
                          <li key={idx} className="flex items-start gap-3">
                            <ChevronRight className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                            <span className="text-slate-700">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Red Flags */}
                {analysis.red_flags?.length > 0 && (
                  <Card className="border-destructive/30">
                    <CardHeader className="pb-3 bg-red-50">
                      <CardTitle className="text-base flex items-center gap-2 text-destructive">
                        <AlertTriangle className="w-4 h-4" />
                        Red Flags
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                      <ul className="space-y-3" data-testid="red-flags-list">
                        {analysis.red_flags.map((item, idx) => (
                          <li key={idx} className="red-flag-item">
                            <span className="text-red-800">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Prescription Review */}
                {analysis.prescription_review?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Pill className="w-4 h-4 text-purple-500" />
                        Prescription Review
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2" data-testid="prescription-review-list">
                        {analysis.prescription_review.map((item, idx) => (
                          <li key={idx} className="flex items-start gap-3">
                            <ChevronRight className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
                            <span className="text-slate-700">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Next Steps */}
                {analysis.next_steps?.length > 0 && (
                  <Card className="border-primary/30">
                    <CardHeader className="pb-3 bg-teal-50">
                      <CardTitle className="text-base flex items-center gap-2 text-primary">
                        <CheckCircle className="w-4 h-4" />
                        Suggested Next Steps
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                      <ul className="space-y-2" data-testid="next-steps-list">
                        {analysis.next_steps.map((item, idx) => (
                          <li key={idx} className="flex items-start gap-3">
                            <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                              {idx + 1}
                            </span>
                            <span className="text-slate-700">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            {/* Disclaimer */}
            <div className="p-4 rounded-lg bg-amber-50 border border-amber-200">
              <div className="flex gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <p className="text-sm text-amber-800">
                  <strong>Disclaimer:</strong> This AI analysis provides clinical decision support only. 
                  It does not constitute a diagnosis. Final medical judgment rests with the treating physician.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AIOutputPage;
