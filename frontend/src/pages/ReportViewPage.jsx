import { useState, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { caseAPI, reportAPI } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { 
  ArrowLeft, Download, FileText, Stethoscope, 
  Calendar, Thermometer, Heart, Activity, 
  AlertTriangle, Loader2, ExternalLink
} from "lucide-react";

const ReportViewPage = () => {
  const { caseId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [caseData, setCaseData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pdfUrl, setPdfUrl] = useState(location.state?.pdfUrl || null);
  const [downloading, setDownloading] = useState(false);

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

  const handleDownload = async () => {
    if (!pdfUrl) {
      setDownloading(true);
      try {
        const response = await reportAPI.generate(caseId);
        setPdfUrl(response.data.pdf_url);
        window.open(`${process.env.REACT_APP_BACKEND_URL}${response.data.pdf_url}`, "_blank");
      } catch (error) {
        toast.error("Failed to generate PDF");
      } finally {
        setDownloading(false);
      }
    } else {
      window.open(`${process.env.REACT_APP_BACKEND_URL}${pdfUrl}`, "_blank");
    }
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!caseData) return null;

  const analysis = caseData.ai_analysis;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 print:hidden">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate(`/case/${caseId}/analysis`)}
                className="p-2 -ml-2 hover:bg-slate-100 rounded-lg transition-colors"
                data-testid="back-to-analysis"
              >
                <ArrowLeft className="w-5 h-5 text-slate-600" />
              </button>
              <h1 className="text-lg font-semibold text-slate-900">Case Report</h1>
            </div>
            <Button onClick={handleDownload} disabled={downloading} data-testid="download-pdf-btn">
              {downloading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              Download PDF
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Report Preview */}
        <Card className="bg-white shadow-lg">
          {/* Report Header */}
          <div className="bg-primary text-white p-6 rounded-t-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-white/20 flex items-center justify-center">
                  <Stethoscope className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold">AI Clinical Co-Pilot</h2>
                  <p className="text-primary-foreground/80 text-sm">Case Report</p>
                </div>
              </div>
              <div className="text-right text-sm">
                <p className="font-medium">Case #{caseData.id.slice(0, 8)}</p>
                <p className="text-primary-foreground/80">{formatDate(caseData.created_at)}</p>
              </div>
            </div>
          </div>

          <CardContent className="p-6 space-y-6">
            {/* Patient Presentation */}
            <div>
              <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                Patient Presentation
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Symptoms</p>
                    <div className="flex flex-wrap gap-1.5">
                      {caseData.symptoms.map((s) => (
                        <Badge key={s} variant="secondary" className="capitalize">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Duration</p>
                    <p className="text-slate-700">{caseData.duration.replace(/_/g, " ")}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">Vitals</p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Thermometer className="w-4 h-4 text-slate-400" />
                      <span className="text-slate-600">Temperature:</span>
                      <span className="font-medium">{caseData.vitals?.temperature || "N/A"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Heart className="w-4 h-4 text-slate-400" />
                      <span className="text-slate-600">Blood Pressure:</span>
                      <span className="font-medium">{caseData.vitals?.bp || "N/A"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Activity className="w-4 h-4 text-slate-400" />
                      <span className="text-slate-600">Pulse:</span>
                      <span className="font-medium">{caseData.vitals?.pulse || "N/A"}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Clinical Notes */}
            {caseData.clinical_notes && (
              <>
                <Separator />
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-3">Clinical Notes</h3>
                  <p className="text-slate-700 bg-slate-50 p-4 rounded-lg">{caseData.clinical_notes}</p>
                </div>
              </>
            )}

            {/* Prescription */}
            {caseData.prescription_data?.medications?.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-3">Prescription Information</h3>
                  <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                    {caseData.prescription_data.medications.map((med, idx) => (
                      <div key={idx} className="text-sm text-slate-700">
                        <strong>{med.name}</strong> - {med.dosage} ({med.frequency}) for {med.duration}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* AI Analysis */}
            {analysis && (
              <>
                <Separator />
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">AI Clinical Decision Support</h3>
                  
                  {/* Summary */}
                  <div className="mb-4">
                    <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">Clinical Summary</p>
                    <p className="text-slate-700">{analysis.clinical_summary}</p>
                  </div>

                  {/* Considerations */}
                  {analysis.considerations?.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">Considerations</p>
                      <ul className="list-disc list-inside text-slate-700 space-y-1">
                        {analysis.considerations.map((c, idx) => (
                          <li key={idx}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Red Flags */}
                  {analysis.red_flags?.length > 0 && (
                    <div className="mb-4 p-4 bg-red-50 rounded-lg border border-red-200">
                      <p className="text-xs uppercase tracking-wide text-red-600 mb-2 font-medium">Red Flags</p>
                      <ul className="list-disc list-inside text-red-800 space-y-1">
                        {analysis.red_flags.map((rf, idx) => (
                          <li key={idx}>{rf}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Next Steps */}
                  {analysis.next_steps?.length > 0 && (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">Recommended Next Steps</p>
                      <ol className="list-decimal list-inside text-slate-700 space-y-1">
                        {analysis.next_steps.map((ns, idx) => (
                          <li key={idx}>{ns}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Disclaimer */}
            <Separator />
            <div className="text-center py-4">
              <div className="inline-flex items-center gap-2 text-amber-700 bg-amber-50 px-4 py-2 rounded-lg text-sm">
                <AlertTriangle className="w-4 h-4" />
                <span>
                  This report is for clinical decision support only. Final medical judgment rests with the physician.
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default ReportViewPage;
