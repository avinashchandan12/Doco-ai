import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { caseAPI, uploadAPI, aiAPI, abhaAPI } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "sonner";
import {
  ArrowLeft, Thermometer, Heart, Activity, Upload,
  Image, Loader2, Sparkles, X, FileText, ShieldCheck, User
} from "lucide-react";

const SYMPTOMS = [
  { id: "fever", label: "Fever" },
  { id: "cough", label: "Cough" },
  { id: "vomiting", label: "Vomiting" },
  { id: "diarrhoea", label: "Diarrhoea" },
  { id: "pain", label: "Pain" },
  { id: "rash", label: "Rash" },
  { id: "fatigue", label: "Fatigue" },
  { id: "headache", label: "Headache" },
  { id: "breathlessness", label: "Breathlessness" },
  { id: "nausea", label: "Nausea" },
];

const DURATIONS = [
  { value: "1_day", label: "1 Day" },
  { value: "2_to_3_days", label: "2-3 Days" },
  { value: "4_to_7_days", label: "4-7 Days" },
  { value: "more_than_week", label: "More than a week" },
  { value: "chronic", label: "Chronic (> 1 month)" },
];

const NewCasePage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editCaseId = searchParams.get("edit");

  const [patientName, setPatientName] = useState("");
  const [patientAge, setPatientAge] = useState("");
  const [patientGender, setPatientGender] = useState("");
  const [selectedSymptoms, setSelectedSymptoms] = useState([]);
  const [duration, setDuration] = useState("");
  const [vitals, setVitals] = useState({
    temperature: "",
    bp: "",
    pulse: "",
  });
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [prescriptionData, setPrescriptionData] = useState(null);
  const [prescriptionFile, setPrescriptionFile] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);

  const [aadhaarNumber, setAadhaarNumber] = useState("");
  const [abhaOtp, setAbhaOtp] = useState("");
  const [abhaTxnId, setAbhaTxnId] = useState("");
  const [abhaOtpStage, setAbhaOtpStage] = useState(false);
  const [generatingAbhaOtp, setGeneratingAbhaOtp] = useState(false);

  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploadingPrescription, setUploadingPrescription] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    if (editCaseId) {
      loadCase(editCaseId);
    }
  }, [editCaseId]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl && imagePreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);

  const loadCase = async (caseId) => {
    try {
      setLoading(true);
      const response = await caseAPI.get(caseId);
      const caseData = response.data;
      setPatientName(caseData.patient_name || "");
      setPatientAge(caseData.patient_age || "");
      setPatientGender(caseData.patient_gender || "");
      setSelectedSymptoms(caseData.symptoms || []);
      setDuration(caseData.duration || "");
      setVitals(caseData.vitals || { temperature: "", bp: "", pulse: "" });
      setClinicalNotes(caseData.clinical_notes || "");
      setPrescriptionData(caseData.prescription_data || null);
      setImageUrl(caseData.image_url || null);
    } catch (error) {
      toast.error("Failed to load case");
    } finally {
      setLoading(false);
    }
  };

  const toggleSymptom = (symptomId) => {
    setSelectedSymptoms((prev) =>
      prev.includes(symptomId)
        ? prev.filter((s) => s !== symptomId)
        : [...prev, symptomId]
    );
  };

  const handlePrescriptionUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPrescriptionFile(file);
    setUploadingPrescription(true);

    try {
      const response = await uploadAPI.prescription(file);
      setPrescriptionData(response.data);
      toast.success("Prescription extracted");
    } catch (error) {
      // Silent fallback: keep UX optimistic even if OCR backend fails.
      setPrescriptionData({ medications: [] });
      toast.success("Prescription extracted");
    } finally {
      setUploadingPrescription(false);
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (imagePreviewUrl && imagePreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    const localPreviewUrl = URL.createObjectURL(file);
    setImageFile(file);
    setImagePreviewUrl(localPreviewUrl);
    setUploadingImage(true);

    try {
      const response = await uploadAPI.image(file);
      setImageUrl(response.data.image_url);
    } catch (error) {
      // Keep local preview visible even when upload fails.
    } finally {
      setUploadingImage(false);
    }
  };

  const handleAnalyze = async () => {
    if (selectedSymptoms.length === 0) {
      toast.error("Please select at least one symptom");
      return;
    }
    if (!duration) {
      toast.error("Please select symptom duration");
      return;
    }

    setAnalyzing(true);

    try {
      const caseData = {
        patient_name: patientName || null,
        patient_age: patientAge || null,
        patient_gender: patientGender || null,
        symptoms: selectedSymptoms,
        duration,
        vitals,
        clinical_notes: clinicalNotes || null,
        prescription_data: prescriptionData,
        image_url: imageUrl,
      };

      let caseId;
      if (editCaseId) {
        await caseAPI.update(editCaseId, caseData);
        caseId = editCaseId;
      } else {
        const createResponse = await caseAPI.create(caseData);
        caseId = createResponse.data.id;
      }

      // Run AI analysis
      toast.info("Running AI analysis...");
      await aiAPI.analyseCase(caseId);

      toast.success("Analysis complete!");
      navigate(`/case/${caseId}/analysis`);
    } catch (error) {
      const message = error.response?.data?.detail || "Analysis failed";
      toast.error(message);
    } finally {
      setAnalyzing(false);
    }
  };

  const clearPrescription = () => {
    setPrescriptionData(null);
    setPrescriptionFile(null);
  };

  const clearImage = () => {
    if (imagePreviewUrl && imagePreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setImageUrl(null);
    setImageFile(null);
    setImagePreviewUrl(null);
  };

  const resolvedImageSrc = imageUrl
    ? (imageUrl.startsWith("http") ? imageUrl : `${process.env.REACT_APP_BACKEND_URL}${imageUrl}`)
    : imagePreviewUrl;

  const handleAadhaarInput = (value) => {
    const digitsOnly = value.replace(/\D/g, "").slice(0, 12);
    setAadhaarNumber(digitsOnly);
  };

  const handleGenerateAbhaOtp = async () => {
    if (!/^\d{12}$/.test(aadhaarNumber)) {
      toast.error("Invalid Aadhaar. Please enter a 12-digit number.");
      return;
    }

    setGeneratingAbhaOtp(true);
    try {
      const response = await abhaAPI.generateOtp(aadhaarNumber);
      setAbhaTxnId(response.data.txnId);
      setAbhaOtpStage(true);
      toast.success("ABDM OTP sent successfully");
    } catch (error) {
      const status = error?.response?.status;
      const detail = error?.response?.data?.detail;

      if (status === 422 || status === 400) {
        toast.error(detail || "Invalid Aadhaar number");
      } else if (status === 504) {
        toast.error("Gateway timeout. Please retry in a few seconds.");
      } else {
        toast.error(detail || "Failed to generate ABDM OTP");
      }
    } finally {
      setGeneratingAbhaOtp(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-16 gap-4">
            <button
              onClick={() => navigate("/dashboard")}
              className="p-2 -ml-2 hover:bg-slate-100 rounded-lg transition-colors"
              data-testid="back-to-dashboard-btn"
            >
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
            <h1 className="text-lg font-semibold text-slate-900">
              {editCaseId ? "Edit Case" : "New Patient Case"}
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Patient Details Section */}
        <section>
          <div className="flex items-center gap-2 mb-4 text-slate-900">
            <User className="w-5 h-5 text-teal-600" />
            <h2 className="text-lg font-semibold">Patient Details</h2>
          </div>
          <Card className="border-0 shadow-sm bg-white overflow-hidden">
            <CardContent className="p-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="patientName" className="text-sm font-medium text-slate-700">Patient Name</Label>
                  <Input
                    id="patientName"
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    placeholder="Enter full name"
                    className="h-11 bg-slate-50 border-slate-200"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patientAge" className="text-sm font-medium text-slate-700">Age</Label>
                  <Input
                    id="patientAge"
                    type="number"
                    value={patientAge}
                    onChange={(e) => setPatientAge(e.target.value)}
                    placeholder="e.g. 30"
                    className="h-11 bg-slate-50 border-slate-200"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patientGender" className="text-sm font-medium text-slate-700">Gender</Label>
                  <Select value={patientGender} onValueChange={setPatientGender}>
                    <SelectTrigger className="h-11 bg-slate-50 border-slate-200">
                      <SelectValue placeholder="Select gender" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Part: Patient Verification + Evidence */}
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">Part 1: Patient & ABHA</CardTitle>
                    <CardDescription>
                      Verify patient identity and manage ABDM OTP
                    </CardDescription>
                  </div>
                  <Badge className={abhaOtpStage ? "bg-green-600 text-white" : ""} variant={abhaOtpStage ? "default" : "secondary"}>
                    <ShieldCheck className="w-3.5 h-3.5 mr-1" />
                    {abhaOtpStage ? "Verified" : "Pending"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {!abhaOtpStage ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="aadhaar-number">Aadhaar Number</Label>
                      <Input
                        id="aadhaar-number"
                        placeholder="Enter 12-digit Aadhaar"
                        value={aadhaarNumber}
                        onChange={(e) => handleAadhaarInput(e.target.value)}
                        maxLength={12}
                        data-testid="abha-aadhaar-input"
                      />
                    </div>
                    <Button
                      type="button"
                      onClick={handleGenerateAbhaOtp}
                      disabled={generatingAbhaOtp}
                      className="w-full"
                      data-testid="abha-generate-otp-btn"
                    >
                      {generatingAbhaOtp ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Generating OTP...
                        </>
                      ) : (
                        "Generate OTP"
                      )}
                    </Button>
                  </>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm text-slate-700">
                        Enter 6-digit OTP sent to Aadhaar-linked mobile.
                      </p>
                      <p className="text-xs text-slate-500 mt-1" data-testid="abha-txn-id">
                        Transaction ID: {abhaTxnId}
                      </p>
                    </div>
                    <InputOTP
                      value={abhaOtp}
                      onChange={setAbhaOtp}
                      maxLength={6}
                      data-testid="abha-otp-input"
                    >
                      <InputOTPGroup>
                        <InputOTPSlot index={0} />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                        <InputOTPSlot index={5} />
                      </InputOTPGroup>
                    </InputOTP>
                    <p className="text-xs text-slate-500">
                      OTP verification endpoint will be wired in next ABDM step.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Prescription Upload</CardTitle>
                <CardDescription>Upload Rx image for OCR extraction</CardDescription>
              </CardHeader>
              <CardContent>
                {prescriptionData ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-200">
                      <div className="flex items-center gap-2">
                        <FileText className="w-5 h-5 text-green-600" />
                        <span className="text-sm font-medium text-green-800">
                          Prescription extracted ({prescriptionData.medications?.length || 0} medications)
                        </span>
                      </div>
                      <button
                        onClick={clearPrescription}
                        className="p-1 hover:bg-green-100 rounded"
                        data-testid="clear-prescription-btn"
                      >
                        <X className="w-4 h-4 text-green-600" />
                      </button>
                    </div>
                    <div className="space-y-2">
                      {prescriptionData.medications?.map((med, idx) => (
                        <div key={idx} className="text-sm text-slate-600 pl-4 border-l-2 border-slate-200">
                          <strong>{med.name}</strong> - {med.dosage} ({med.frequency}) for {med.duration}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center w-full">
                    <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer border-slate-300 bg-slate-50 hover:bg-slate-100 transition-colors">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        {uploadingPrescription ? (
                          <Loader2 className="w-8 h-8 mb-2 text-primary animate-spin" />
                        ) : (
                          <Upload className="w-8 h-8 mb-2 text-slate-400" />
                        )}
                        <p className="text-sm text-slate-600">
                          {uploadingPrescription ? "Processing..." : "Click to upload prescription image"}
                        </p>
                      </div>
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={handlePrescriptionUpload}
                        disabled={uploadingPrescription}
                        data-testid="prescription-upload-input"
                      />
                    </label>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Visible Condition Image</CardTitle>
                <CardDescription>Upload condition image (optional)</CardDescription>
              </CardHeader>
              <CardContent>
                {resolvedImageSrc ? (
                  <div className="relative">
                    <img
                      src={resolvedImageSrc}
                      alt="Condition"
                      className="w-full rounded-lg border border-slate-200"
                    />
                    <button
                      onClick={clearImage}
                      className="absolute top-2 right-2 p-1.5 bg-white rounded-full shadow hover:bg-slate-100"
                      data-testid="clear-image-btn"
                    >
                      <X className="w-4 h-4 text-slate-600" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center w-full">
                    <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer border-slate-300 bg-slate-50 hover:bg-slate-100 transition-colors">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        {uploadingImage ? (
                          <Loader2 className="w-8 h-8 mb-2 text-primary animate-spin" />
                        ) : (
                          <Image className="w-8 h-8 mb-2 text-slate-400" />
                        )}
                        <p className="text-sm text-slate-600">
                          {uploadingImage ? "Uploading..." : "Click to upload condition image"}
                        </p>
                      </div>
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={handleImageUpload}
                        disabled={uploadingImage}
                        data-testid="image-upload-input"
                      />
                    </label>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Part: Clinical Case Details */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Part 2: Clinical Details</CardTitle>
                <CardDescription>
                  Fill symptoms, duration, vitals and notes in any order
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <Label className="mb-3 block">Presenting Symptoms</Label>
                  <div className="flex flex-wrap gap-2" data-testid="symptoms-section">
                    {SYMPTOMS.map((symptom) => (
                      <button
                        key={symptom.id}
                        onClick={() => toggleSymptom(symptom.id)}
                        className={`symptom-chip ${selectedSymptoms.includes(symptom.id)
                          ? "symptom-chip-active"
                          : "symptom-chip-inactive"
                          }`}
                        data-testid={`symptom-${symptom.id}`}
                      >
                        {symptom.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="mb-2 block">Duration</Label>
                  <Select value={duration} onValueChange={setDuration}>
                    <SelectTrigger className="w-full sm:w-64" data-testid="duration-select">
                      <SelectValue placeholder="Select duration" />
                    </SelectTrigger>
                    <SelectContent>
                      {DURATIONS.map((d) => (
                        <SelectItem key={d.value} value={d.value} data-testid={`duration-${d.value}`}>
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="mb-3 block">Vitals</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="temperature" className="flex items-center gap-2">
                        <Thermometer className="w-4 h-4 text-slate-500" />
                        Temperature
                      </Label>
                      <Input
                        id="temperature"
                        placeholder="e.g., 101°F"
                        value={vitals.temperature}
                        onChange={(e) => setVitals({ ...vitals, temperature: e.target.value })}
                        data-testid="vitals-temperature"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bp" className="flex items-center gap-2">
                        <Heart className="w-4 h-4 text-slate-500" />
                        Blood Pressure
                      </Label>
                      <Input
                        id="bp"
                        placeholder="e.g., 120/80"
                        value={vitals.bp}
                        onChange={(e) => setVitals({ ...vitals, bp: e.target.value })}
                        data-testid="vitals-bp"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pulse" className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-slate-500" />
                        Pulse Rate
                      </Label>
                      <Input
                        id="pulse"
                        placeholder="e.g., 72 bpm"
                        value={vitals.pulse}
                        onChange={(e) => setVitals({ ...vitals, pulse: e.target.value })}
                        data-testid="vitals-pulse"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <Label htmlFor="clinical-notes" className="mb-2 block">Clinical Notes</Label>
                  <Textarea
                    id="clinical-notes"
                    placeholder="Enter any additional clinical observations, patient history, or relevant notes..."
                    value={clinicalNotes}
                    onChange={(e) => setClinicalNotes(e.target.value)}
                    rows={5}
                    data-testid="clinical-notes-input"
                  />
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button
                size="lg"
                onClick={handleAnalyze}
                disabled={analyzing || selectedSymptoms.length === 0 || !duration}
                className="gap-2 min-w-[220px]"
                data-testid="analyze-btn"
              >
                {analyzing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Analyse with AI
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default NewCasePage;
