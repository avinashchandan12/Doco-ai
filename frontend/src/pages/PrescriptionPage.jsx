import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/App";
import { prescriptionAPI } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
    ArrowLeft,
    Sparkles,
    Printer,
    AlertTriangle,
    CheckCircle,
    X,
    Loader2,
    Info,
    Pill,
    Plus,
    Trash2,
    User,
    RefreshCw,
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
    { id: "chest_pain", label: "Chest Pain" },
    { id: "dizziness", label: "Dizziness" },
];

const emptyMed = () => ({ name: "", dosage: "", frequency: "", reason: "" });

const PrescriptionPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { doctor } = useAuth();

    // Patient context
    const [patientId, setPatientId] = useState("");
    const [patientName, setPatientName] = useState("");
    const [patientAge, setPatientAge] = useState("");
    const [patientGender, setPatientGender] = useState("");
    const [abhaAddress, setAbhaAddress] = useState("");
    const [sessionId, setSessionId] = useState("");

    // Prescription content
    const [freeText, setFreeText] = useState("");
    const [selectedSymptoms, setSelectedSymptoms] = useState([]);
    const [medications, setMedications] = useState([emptyMed()]);
    const [warnings, setWarnings] = useState([]);

    // Load from local storage, then overlay navigation state (from AI output page)
    useEffect(() => {
        try {
            const savedState = localStorage.getItem("prescription_state");
            if (savedState) {
                const parsed = JSON.parse(savedState);
                if (parsed.patientId) setPatientId(parsed.patientId);
                if (parsed.patientName) setPatientName(parsed.patientName);
                if (parsed.patientAge) setPatientAge(parsed.patientAge);
                if (parsed.patientGender) setPatientGender(parsed.patientGender);
                if (parsed.abhaAddress) setAbhaAddress(parsed.abhaAddress);
                if (parsed.sessionId) setSessionId(parsed.sessionId);
                if (parsed.freeText) setFreeText(parsed.freeText);
                if (parsed.selectedSymptoms) setSelectedSymptoms(parsed.selectedSymptoms);
                if (parsed.medications) setMedications(parsed.medications);
                if (parsed.warnings) setWarnings(parsed.warnings);
            }
            if (!savedState || !JSON.parse(savedState || "{}").sessionId) {
                setSessionId(crypto.randomUUID());
            }
        } catch (e) {
            setSessionId(crypto.randomUUID());
        }

        // Overlay patient data passed from the AI analysis page (takes priority over stored values)
        const navState = location.state;
        if (navState) {
            if (navState.patientName) setPatientName(navState.patientName);
            if (navState.patientAge) setPatientAge(String(navState.patientAge));
            if (navState.patientGender) setPatientGender(navState.patientGender);
            if (navState.caseId) setPatientId(navState.caseId);
        }
    }, []);

    // Save to local storage on change
    useEffect(() => {
        if (!sessionId) return;
        const stateToSave = {
            patientId, patientName, patientAge, patientGender, abhaAddress,
            sessionId, freeText, selectedSymptoms, medications, warnings
        };
        localStorage.setItem("prescription_state", JSON.stringify(stateToSave));
    }, [patientId, patientName, patientAge, patientGender, abhaAddress, sessionId, freeText, selectedSymptoms, medications, warnings]);

    // ABHA toggle
    const [useAbha, setUseAbha] = useState(true);

    // AI Suggest state
    const [suggesting, setSuggesting] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [aiSuggestion, setAiSuggestion] = useState(null);
    const [promptType, setPromptType] = useState(null);

    // Print state
    const [printing, setPrinting] = useState(false);

    const toggleSymptom = (id) => {
        setSelectedSymptoms((prev) =>
            prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
        );
    };

    const handleAiSuggest = async () => {
        if (!patientId.trim()) {
            toast.error("Please enter a Patient ID to identify the patient.");
            return;
        }
        if (selectedSymptoms.length === 0) {
            toast.error("Please select at least one symptom.");
            return;
        }

        setSuggesting(true);
        try {
            const response = await prescriptionAPI.suggest({
                patient_id: patientId.trim(),
                session_id: sessionId,
                symptoms: selectedSymptoms,
                use_abha: useAbha,
                current_draft:
                    medications.filter((m) => m.name.trim()).length > 0
                        ? { suggested_medications: medications.filter((m) => m.name.trim()), warnings }
                        : null,
            });

            const data = response.data;
            setAiSuggestion(data.ai_suggestion);
            setPromptType(data.prompt_type);
            setDrawerOpen(true);

            toast.success(
                data.prompt_type === "PROMPT_A_HISTORICAL_CONTEXT"
                    ? "AI suggestion based on ABHA history ✓"
                    : "AI suggestion based on current symptoms ✓"
            );
        } catch (error) {
            const msg = error.response?.data?.detail || "AI suggestion failed";
            toast.error(msg);
        } finally {
            setSuggesting(false);
        }
    };

    const handleAcceptAll = async () => {
        if (!aiSuggestion) return;
        try {
            await prescriptionAPI.accept({
                patient_id: patientId.trim(),
                session_id: sessionId,
            });
            setMedications(
                aiSuggestion.suggested_medications.length > 0
                    ? aiSuggestion.suggested_medications
                    : [emptyMed()]
            );
            setWarnings(aiSuggestion.warnings || []);
            setDrawerOpen(false);
            toast.success("AI prescription accepted");
        } catch (err) {
            toast.error("Failed to accept suggestion");
        }
    };

    const handleDismiss = () => {
        setDrawerOpen(false);
        toast.info("AI suggestion dismissed");
    };

    const updateMed = (idx, field, value) => {
        setMedications((prev) =>
            prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m))
        );
    };

    const addMedRow = () => setMedications((prev) => [...prev, emptyMed()]);

    const removeMedRow = (idx) => {
        setMedications((prev) => {
            const updated = prev.filter((_, i) => i !== idx);
            return updated.length === 0 ? [emptyMed()] : updated;
        });
    };

    const handlePrint = () => {
        navigate("/prescription/print", {
            state: {
                patientId,
                patientName,
                patientAge,
                patientGender,
                abhaAddress,
                sessionId,
                medications,
                warnings,
                freeText,
                doctor,
            },
        });
    };

    // Determine if any medication has a warning (for red highlights)
    const warnedMedNames = new Set(
        warnings
            .join(" ")
            .match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/g) || []
    );

    return (
        <TooltipProvider>
            <div className="min-h-screen bg-gradient-to-br from-slate-50 to-teal-50/30">
                {/* ── HEADER ── */}
                <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="flex items-center justify-between h-16">
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => navigate("/dashboard")}
                                    className="p-2 -ml-2 hover:bg-slate-100 rounded-lg transition-colors"
                                >
                                    <ArrowLeft className="w-5 h-5 text-slate-600" />
                                </button>
                                <div>
                                    <h1 className="text-lg font-bold text-slate-900">
                                        Prescription Writing
                                    </h1>
                                    <p className="text-xs text-slate-500">
                                        DOCO AI · Clinical Co-Pilot
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                {/* ABHA Toggle */}
                                <div className="flex items-center gap-2 bg-teal-50 border border-teal-200 rounded-xl px-3 py-1.5">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="w-3.5 h-3.5 text-teal-600 cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom" className="max-w-xs">
                                            Toggle this to let AI analyze past records before
                                            suggesting meds. Requires ABHA data to be synced.
                                        </TooltipContent>
                                    </Tooltip>
                                    <span className="text-xs font-medium text-teal-800">
                                        Include Patient History (ABHA)
                                    </span>
                                    <Switch
                                        id="abha-toggle"
                                        checked={useAbha}
                                        onCheckedChange={setUseAbha}
                                        className="data-[state=checked]:bg-teal-600"
                                    />
                                    <Badge
                                        variant={useAbha ? "default" : "secondary"}
                                        className={`text-xs ${useAbha ? "bg-teal-600 text-white" : ""}`}
                                    >
                                        {useAbha ? "ON" : "OFF"}
                                    </Badge>
                                </div>

                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handlePrint}
                                    className="gap-1.5 border-slate-300"
                                    data-testid="print-btn"
                                >
                                    <Printer className="w-4 h-4" />
                                    Print / Export PDF
                                </Button>

                                <Button
                                    size="sm"
                                    onClick={handleAiSuggest}
                                    disabled={suggesting}
                                    className="gap-2 bg-gradient-to-r from-teal-600 to-teal-700 hover:from-teal-700 hover:to-teal-800"
                                    data-testid="ai-suggest-btn"
                                >
                                    {suggesting ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Analyzing...
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="w-4 h-4" />
                                            AI Suggest
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    </div>
                </header>

                <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* ── LEFT: PATIENT INFO ── */}
                        <div className="space-y-5">
                            <Card className="border-0 shadow-md">
                                <CardHeader className="pb-3 bg-gradient-to-r from-teal-600 to-teal-700 rounded-t-xl text-white">
                                    <CardTitle className="text-sm flex items-center gap-2">
                                        <User className="w-4 h-4" />
                                        Patient Details
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-4 space-y-3">
                                    <div className="space-y-1">
                                        <Label htmlFor="patient-id" className="text-xs text-slate-500">
                                            Patient ID *
                                        </Label>
                                        <Input
                                            id="patient-id"
                                            placeholder="e.g. P-1001 or UUID"
                                            value={patientId}
                                            onChange={(e) => setPatientId(e.target.value)}
                                            className="text-sm"
                                            data-testid="patient-id-input"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="patient-name" className="text-xs text-slate-500">
                                            Name
                                        </Label>
                                        <Input
                                            id="patient-name"
                                            placeholder="Patient full name"
                                            value={patientName}
                                            onChange={(e) => setPatientName(e.target.value)}
                                            className="text-sm"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                            <Label className="text-xs text-slate-500">Age</Label>
                                            <Input
                                                placeholder="e.g. 35 yrs"
                                                value={patientAge}
                                                onChange={(e) => setPatientAge(e.target.value)}
                                                className="text-sm"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs text-slate-500">Gender</Label>
                                            <Input
                                                placeholder="M / F / Other"
                                                value={patientGender}
                                                onChange={(e) => setPatientGender(e.target.value)}
                                                className="text-sm"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="abha-address" className="text-xs text-slate-500">
                                            ABHA Address (optional)
                                        </Label>
                                        <Input
                                            id="abha-address"
                                            placeholder="e.g. abc@abdm"
                                            value={abhaAddress}
                                            onChange={(e) => setAbhaAddress(e.target.value)}
                                            className="text-sm"
                                        />
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Symptom selector for AI */}
                            <Card className="border-0 shadow-md">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm text-slate-700">
                                        Symptoms{" "}
                                        <span className="text-xs font-normal text-slate-400">
                                            (for AI context)
                                        </span>
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex flex-wrap gap-1.5" data-testid="symptom-chips">
                                        {SYMPTOMS.map((s) => (
                                            <button
                                                key={s.id}
                                                onClick={() => toggleSymptom(s.id)}
                                                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all duration-150 ${selectedSymptoms.includes(s.id)
                                                    ? "bg-teal-600 text-white border-teal-600 shadow-sm"
                                                    : "bg-white text-slate-600 border-slate-200 hover:border-teal-400 hover:text-teal-700"
                                                    }`}
                                                data-testid={`symptom-${s.id}`}
                                            >
                                                {s.label}
                                            </button>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Session info */}
                            <p className="text-xs text-slate-400 px-1">
                                Session:{" "}
                                <span className="font-mono">{sessionId.slice(0, 8)}…</span>
                            </p>
                        </div>

                        {/* ── RIGHT (2 cols): PRESCRIPTION WORKSPACE ── */}
                        <div className="lg:col-span-2 space-y-5">
                            {/* Warnings banner */}
                            {warnings.length > 0 && (
                                <div
                                    className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2 animate-in slide-in-from-top-2"
                                    data-testid="warnings-banner"
                                >
                                    <div className="flex items-center gap-2 text-red-700 font-semibold text-sm">
                                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                                        Clinical Warnings / Drug Interactions
                                    </div>
                                    {warnings.map((w, i) => (
                                        <p key={i} className="text-sm text-red-700 pl-6">
                                            ⚠ {w}
                                        </p>
                                    ))}
                                </div>
                            )}

                            {/* Free Text notes */}
                            <Card className="border-0 shadow-md">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm text-slate-700 flex justify-between items-center">
                                        Doctor's Notes
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 text-xs text-teal-600 hover:text-teal-700 hover:bg-teal-50"
                                            onClick={async () => {
                                                if (!freeText.trim()) return;
                                                // Basic simulation of structuring notes logic here
                                                toast.success("Notes structured");
                                                setFreeText(prev => prev.split('\n').map(l => l ? `- ${l}` : '').join('\n'));
                                            }}
                                        >
                                            <Sparkles className="w-3 h-3 mr-1" />
                                            Structure
                                        </Button>
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <Textarea
                                        id="free-text"
                                        placeholder="Type free-form clinical observations, patient complaints, examination findings, allergies, chronic conditions, or any relevant notes here..."
                                        value={freeText}
                                        onChange={(e) => setFreeText(e.target.value)}
                                        rows={6}
                                        className="resize-none text-sm leading-relaxed border-slate-200 focus:border-teal-400 focus:ring-teal-400/20"
                                        data-testid="free-text-area"
                                    />
                                </CardContent>
                            </Card>

                            {/* Medications Table */}
                            <Card className="border-0 shadow-md">
                                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                                    <CardTitle className="text-sm text-slate-700 flex items-center gap-2">
                                        <Pill className="w-4 h-4 text-teal-600" />
                                        Prescribed Medications
                                    </CardTitle>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={addMedRow}
                                        className="h-7 gap-1 text-xs border-teal-300 text-teal-700 hover:bg-teal-50"
                                        data-testid="add-med-btn"
                                    >
                                        <Plus className="w-3 h-3" />
                                        Add Row
                                    </Button>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-3">
                                        {/* Table header */}
                                        <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide px-1">
                                            <div className="col-span-3">Medication</div>
                                            <div className="col-span-2">Dosage</div>
                                            <div className="col-span-2">Frequency</div>
                                            <div className="col-span-4">Reason</div>
                                            <div className="col-span-1"></div>
                                        </div>
                                        <Separator />

                                        {medications.map((med, idx) => {
                                            const hasWarning =
                                                med.name &&
                                                [...warnedMedNames].some((n) =>
                                                    med.name.toLowerCase().includes(n.toLowerCase())
                                                );
                                            return (
                                                <div
                                                    key={idx}
                                                    className={`grid grid-cols-12 gap-2 items-start rounded-lg p-2 transition-colors ${hasWarning
                                                        ? "bg-red-50 border border-red-200"
                                                        : "bg-slate-50/50"
                                                        }`}
                                                    data-testid={`med-row-${idx}`}
                                                >
                                                    {hasWarning && (
                                                        <div className="col-span-12 flex items-center gap-1 text-xs text-red-600 font-medium mb-1">
                                                            <AlertTriangle className="w-3 h-3" />
                                                            Drug interaction warning
                                                        </div>
                                                    )}
                                                    <div className="col-span-3">
                                                        <Input
                                                            placeholder="e.g. Amoxicillin"
                                                            value={med.name}
                                                            onChange={(e) =>
                                                                updateMed(idx, "name", e.target.value)
                                                            }
                                                            className={`text-xs h-8 ${hasWarning ? "border-red-300 bg-red-50" : ""}`}
                                                            data-testid={`med-name-${idx}`}
                                                        />
                                                    </div>
                                                    <div className="col-span-2">
                                                        <Input
                                                            placeholder="500mg"
                                                            value={med.dosage}
                                                            onChange={(e) =>
                                                                updateMed(idx, "dosage", e.target.value)
                                                            }
                                                            className="text-xs h-8"
                                                            data-testid={`med-dosage-${idx}`}
                                                        />
                                                    </div>
                                                    <div className="col-span-2">
                                                        <Input
                                                            placeholder="TID / BD"
                                                            value={med.frequency}
                                                            onChange={(e) =>
                                                                updateMed(idx, "frequency", e.target.value)
                                                            }
                                                            className="text-xs h-8"
                                                            data-testid={`med-freq-${idx}`}
                                                        />
                                                    </div>
                                                    <div className="col-span-4">
                                                        <Input
                                                            placeholder="Clinical reason..."
                                                            value={med.reason}
                                                            onChange={(e) =>
                                                                updateMed(idx, "reason", e.target.value)
                                                            }
                                                            className="text-xs h-8"
                                                            data-testid={`med-reason-${idx}`}
                                                        />
                                                    </div>
                                                    <div className="col-span-1 flex justify-end">
                                                        <button
                                                            onClick={() => removeMedRow(idx)}
                                                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                                            data-testid={`remove-med-${idx}`}
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Bottom action */}
                            <div className="flex justify-between items-center">
                                <p className="text-xs text-slate-400">
                                    {useAbha
                                        ? "🔒 ABHA history analysis enabled — AI will check past medications"
                                        : "⚡ Symptom-only mode — AI will suggest standard of care"}
                                </p>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handlePrint}
                                        className="gap-1.5"
                                    >
                                        <Printer className="w-4 h-4" />
                                        Print Preview
                                    </Button>
                                    <Button
                                        size="sm"
                                        onClick={handleAiSuggest}
                                        disabled={suggesting}
                                        className="gap-2 bg-teal-600 hover:bg-teal-700"
                                    >
                                        {suggesting ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <Sparkles className="w-4 h-4" />
                                        )}
                                        AI Suggest
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                </main>

                {/* ── AI SUGGESTION SIDE DRAWER ── */}
                <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
                    <SheetContent
                        side="right"
                        className="w-full sm:max-w-lg overflow-y-auto"
                        data-testid="ai-suggestion-drawer"
                    >
                        <SheetHeader className="border-b pb-4">
                            <div className="flex items-center gap-2">
                                <div className="p-2 rounded-lg bg-teal-100">
                                    <Sparkles className="w-5 h-5 text-teal-600" />
                                </div>
                                <div>
                                    <SheetTitle className="text-base">AI Suggestion</SheetTitle>
                                    <SheetDescription className="text-xs">
                                        {promptType === "PROMPT_A_HISTORICAL_CONTEXT"
                                            ? "Based on ABHA longitudinal history + current symptoms"
                                            : "Based on current symptoms only (no ABHA history)"}
                                    </SheetDescription>
                                </div>
                            </div>
                        </SheetHeader>

                        {aiSuggestion && (
                            <div className="py-5 space-y-5">
                                {/* Warnings first */}
                                {aiSuggestion.warnings?.length > 0 && (
                                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2">
                                        <div className="flex items-center gap-2 text-red-700 font-semibold text-sm">
                                            <AlertTriangle className="w-4 h-4" />
                                            Drug Interaction Warnings
                                        </div>
                                        {aiSuggestion.warnings.map((w, i) => (
                                            <p key={i} className="text-sm text-red-700 pl-1">
                                                ⚠ {w}
                                            </p>
                                        ))}
                                    </div>
                                )}

                                {/* Suggested medications */}
                                <div>
                                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                                        Suggested Additions
                                    </h3>
                                    <div className="space-y-3">
                                        {aiSuggestion.suggested_medications?.map((med, idx) => {
                                            const hasW = aiSuggestion.warnings?.some((w) =>
                                                w.toLowerCase().includes(med.name?.toLowerCase())
                                            );
                                            return (
                                                <div
                                                    key={idx}
                                                    className={`rounded-xl border p-4 space-y-2 transition-all ${hasW
                                                        ? "border-red-300 bg-red-50"
                                                        : "border-slate-200 bg-white hover:border-teal-300"
                                                        }`}
                                                    data-testid={`ai-med-${idx}`}
                                                >
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div className="flex items-center gap-2">
                                                            <Pill
                                                                className={`w-4 h-4 flex-shrink-0 ${hasW ? "text-red-500" : "text-teal-600"}`}
                                                            />
                                                            <span
                                                                className={`font-semibold text-sm ${hasW ? "text-red-700" : "text-slate-800"}`}
                                                            >
                                                                {med.name}
                                                                {hasW && (
                                                                    <AlertTriangle className="inline w-3 h-3 ml-1 text-red-500" />
                                                                )}
                                                            </span>
                                                        </div>
                                                        <Badge
                                                            variant="secondary"
                                                            className="text-xs whitespace-nowrap"
                                                        >
                                                            {med.dosage}
                                                        </Badge>
                                                    </div>
                                                    <div className="pl-6 space-y-1">
                                                        <p className="text-xs text-slate-500">
                                                            <span className="font-medium">Frequency:</span>{" "}
                                                            {med.frequency}
                                                        </p>
                                                        <p className="text-xs text-slate-500">
                                                            <span className="font-medium">
                                                                Clinical Reason:
                                                            </span>{" "}
                                                            {med.reason}
                                                        </p>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Action buttons */}
                                <div className="flex gap-3 pt-2">
                                    <Button
                                        className="flex-1 gap-2 bg-teal-600 hover:bg-teal-700"
                                        onClick={handleAcceptAll}
                                        data-testid="accept-all-btn"
                                    >
                                        <CheckCircle className="w-4 h-4" />
                                        Accept All
                                    </Button>
                                    <Button
                                        variant="outline"
                                        className="flex-1 gap-2"
                                        onClick={handleDismiss}
                                        data-testid="dismiss-btn"
                                    >
                                        <X className="w-4 h-4" />
                                        Dismiss
                                    </Button>
                                </div>

                                {promptType === "PROMPT_B_SYMPTOM_ONLY" && (
                                    <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                                        <strong>Note:</strong> ABHA data was not available for this
                                        patient. Please confirm known allergies and chronic
                                        conditions before dispensing.
                                    </div>
                                )}
                            </div>
                        )}
                    </SheetContent>
                </Sheet>
            </div>
        </TooltipProvider>
    );
};

export default PrescriptionPage;
