import { useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { prescriptionAPI } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
    ArrowLeft,
    Printer,
    Download,
    Loader2,
    AlertTriangle,
    QrCode,
} from "lucide-react";

const PrescriptionPrintPage = () => {
    const navigate = useNavigate();
    const { state } = useLocation();
    const [generatingPdf, setGeneratingPdf] = useState(false);

    // Pull from navigation state
    const {
        patientId = "",
        patientName = "",
        patientAge = "",
        patientGender = "",
        abhaAddress = "",
        sessionId = "",
        medications = [],
        warnings = [],
        freeText = "",
        doctor = {},
    } = state || {};

    const today = new Date().toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "long",
        year: "numeric",
    });

    const handlePrint = () => {
        window.print();
    };

    const handleGeneratePdf = async () => {
        setGeneratingPdf(true);
        try {
            const response = await prescriptionAPI.print({
                patient_id: patientId || "unknown",
                session_id: sessionId || "manual",
                patient_name: patientName,
                patient_age: patientAge,
                patient_gender: patientGender,
                abha_address: abhaAddress,
                free_text_notes: freeText,
                abha_locker_url: abhaAddress
                    ? `https://abdm.gov.in/healthlocker?patient=${encodeURIComponent(abhaAddress)}`
                    : null,
            });
            const pdfUrl = response.data.pdf_url;
            window.open(
                pdfUrl.startsWith("http")
                    ? pdfUrl
                    : `${process.env.REACT_APP_BACKEND_URL}${pdfUrl}`,
                "_blank"
            );
            toast.success("Prescription PDF generated");
        } catch (error) {
            const msg = error.response?.data?.detail || "PDF generation failed";
            toast.error(msg);
        } finally {
            setGeneratingPdf(false);
        }
    };

    // QR code URL (generated client-side using a public QR API for preview link)
    const qrUrl = abhaAddress
        ? `https://abdm.gov.in/healthlocker?patient=${encodeURIComponent(abhaAddress)}`
        : `https://abdm.gov.in/healthlocker`;
    const qrImageSrc = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(
        qrUrl
    )}`;

    const validMeds = medications.filter((m) => m.name?.trim());

    return (
        <>
            {/* ── SCREEN-ONLY ACTION BAR ── */}
            <div className="print:hidden sticky top-0 z-20 bg-white border-b border-slate-200 shadow-sm">
                <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
                    <button
                        onClick={() => navigate(-1)}
                        className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Prescription
                    </button>
                    <div className="flex items-center gap-3">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleGeneratePdf}
                            disabled={generatingPdf}
                            className="gap-2"
                            data-testid="generate-pdf-btn"
                        >
                            {generatingPdf ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Download className="w-4 h-4" />
                            )}
                            {generatingPdf ? "Generating..." : "Generate PDF"}
                        </Button>
                        <Button
                            size="sm"
                            onClick={handlePrint}
                            className="gap-2 bg-teal-600 hover:bg-teal-700"
                            data-testid="print-trigger-btn"
                        >
                            <Printer className="w-4 h-4" />
                            Print
                        </Button>
                    </div>
                </div>
            </div>

            {/* ── PRINTABLE PRESCRIPTION ── */}
            <div className="min-h-screen bg-slate-100 print:bg-white py-8 print:py-0">
                <div
                    id="prescription-sheet"
                    className="
            max-w-[210mm] mx-auto bg-white shadow-2xl print:shadow-none
            print:max-w-none print:mx-0
          "
                    style={{ minHeight: "297mm" }}
                >
                    {/* INNER PADDING */}
                    <div className="px-10 py-8 print:px-12 print:py-10 flex flex-col min-h-[297mm]">
                        {/* ── LETTERHEAD ── */}
                        <div className="flex items-start justify-between border-b-2 border-teal-600 pb-4 mb-5">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    {/* Logo mark */}
                                    <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center">
                                        <span className="text-white text-xs font-bold">D</span>
                                    </div>
                                    <div>
                                        <h1 className="text-xl font-bold text-teal-700 leading-none">
                                            {doctor?.hospital_name || "DOCO AI CLINIC"}
                                        </h1>
                                        <p className="text-[10px] text-slate-400 leading-tight">
                                            {doctor?.specialization || "Clinical Co-Pilot · ABDM Compliant"}
                                            {doctor?.contact ? ` • Ph: ${doctor.contact}` : ""}
                                            {doctor?.website ? ` • Web: ${doctor.website}` : ""}
                                        </p>
                                    </div>
                                </div>
                                <div className="mt-3">
                                    <p className="text-base font-bold text-slate-900">
                                        Dr. {doctor?.name || "—"}
                                    </p>
                                    {doctor?.qualification && (
                                        <p className="text-xs text-slate-600">
                                            {doctor.qualification}
                                        </p>
                                    )}
                                    {doctor?.reg_no && (
                                        <p className="text-[10px] text-slate-500 font-medium">
                                            Reg No: {doctor.reg_no}
                                        </p>
                                    )}
                                    {doctor?.location && (
                                        <p className="text-[10px] text-slate-500">{doctor.location}</p>
                                    )}
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-xs text-slate-500">
                                    <span className="font-medium">Date:</span> {today}
                                </p>
                                <p className="text-xs text-slate-500 mt-1">
                                    <span className="font-medium">Rx No:</span>{" "}
                                    {sessionId ? sessionId.slice(0, 8).toUpperCase() : "—"}
                                </p>
                            </div>
                        </div>

                        {/* ── PATIENT INFO ── */}
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-5">
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
                                Patient Information
                            </p>
                            <div className="grid grid-cols-3 gap-x-6 gap-y-1.5 text-sm">
                                <div>
                                    <span className="text-slate-500 text-xs font-medium">
                                        Name:{" "}
                                    </span>
                                    <span className="font-semibold text-slate-800">
                                        {patientName || "—"}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-slate-500 text-xs font-medium">
                                        Age:{" "}
                                    </span>
                                    <span className="font-semibold text-slate-800">
                                        {patientAge || "—"}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-slate-500 text-xs font-medium">
                                        Gender:{" "}
                                    </span>
                                    <span className="font-semibold text-slate-800">
                                        {patientGender || "—"}
                                    </span>
                                </div>
                                {abhaAddress && (
                                    <div className="col-span-3 mt-1">
                                        <span className="text-slate-500 text-xs font-medium">
                                            ABHA Address:{" "}
                                        </span>
                                        <span className="font-semibold text-teal-700">
                                            {abhaAddress}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* ── MEDICATIONS TABLE ── */}
                        <div className="mb-5 flex-1">
                            <div className="flex items-center gap-2 mb-3">
                                <div className="w-5 h-0.5 bg-teal-600 rounded" />
                                <p className="text-xs font-bold text-teal-700 uppercase tracking-widest">
                                    Prescribed Medications
                                </p>
                            </div>

                            {validMeds.length > 0 ? (
                                <table className="w-full text-sm border-collapse">
                                    <thead>
                                        <tr className="bg-teal-600 text-white">
                                            <th className="text-left py-2 px-3 text-xs font-semibold rounded-tl-lg w-6">
                                                #
                                            </th>
                                            <th className="text-left py-2 px-3 text-xs font-semibold">
                                                Medication
                                            </th>
                                            <th className="text-left py-2 px-3 text-xs font-semibold">
                                                Dosage
                                            </th>
                                            <th className="text-left py-2 px-3 text-xs font-semibold">
                                                Frequency
                                            </th>
                                            <th className="text-left py-2 px-3 text-xs font-semibold rounded-tr-lg">
                                                Clinical Reason
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {validMeds.map((med, idx) => {
                                            const hasW = warnings.some((w) =>
                                                w.toLowerCase().includes(med.name?.toLowerCase())
                                            );
                                            return (
                                                <tr
                                                    key={idx}
                                                    className={`border-b border-slate-100 ${hasW
                                                        ? "bg-red-50"
                                                        : idx % 2 === 0
                                                            ? "bg-white"
                                                            : "bg-slate-50"
                                                        }`}
                                                    data-testid={`print-med-row-${idx}`}
                                                >
                                                    <td className="py-2.5 px-3 text-xs text-slate-500">
                                                        {idx + 1}
                                                    </td>
                                                    <td className="py-2.5 px-3 font-semibold text-slate-800">
                                                        {med.name}
                                                    </td>
                                                    <td className="py-2.5 px-3 text-slate-600">
                                                        {med.dosage || "—"}
                                                    </td>
                                                    <td className="py-2.5 px-3 text-slate-600">
                                                        {med.frequency || "—"}
                                                    </td>
                                                    <td className="py-2.5 px-3 text-slate-500 text-xs">
                                                        {med.reason || "—"}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="border-2 border-dashed border-slate-200 rounded-lg py-10 text-center">
                                    <p className="text-slate-400 text-sm">
                                        No medications prescribed.
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* ── DOCTOR'S NOTES ── */}
                        {freeText && (
                            <div className="mb-5">
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="w-5 h-0.5 bg-slate-400 rounded" />
                                    <p className="text-xs font-bold text-slate-600 uppercase tracking-widest">
                                        Doctor's Notes
                                    </p>
                                </div>
                                <p className="text-sm text-slate-700 leading-relaxed border-l-2 border-slate-200 pl-4">
                                    {freeText}
                                </p>
                            </div>
                        )}

                        {/* ── FOOTER: SIGNATURE + QR CODE ── */}
                        <div className="border-t-2 border-teal-600 mt-auto pt-5">
                            <div className="flex items-end justify-between">
                                {/* Signature box */}
                                <div className="min-w-[180px]">
                                    <div className="border-b border-slate-400 mb-1 h-12 flex items-end pb-1">
                                        {/* empty space for physical signature */}
                                    </div>
                                    <p className="text-xs font-semibold text-slate-700">
                                        Dr. {doctor?.name || "—"}
                                    </p>
                                    {doctor?.qualification && (
                                        <p className="text-[10px] text-slate-500">
                                            {doctor.qualification}
                                        </p>
                                    )}
                                    <p className="text-[10px] text-slate-400 mt-0.5">
                                        Signature / Digital Stamp
                                    </p>
                                </div>

                                {/* Center disclaimer */}
                                <div className="flex-1 mx-6 text-center">
                                    <p className="text-[9px] text-slate-400 leading-snug">
                                        This prescription is ABDM-compliant and digitally
                                        traceable via DOCO AI Clinical Co-Pilot. Final dispensing
                                        is at the pharmacist's professional discretion. Not valid
                                        without doctor's signature.
                                    </p>
                                </div>

                                {/* QR code */}
                                <div className="flex flex-col items-center gap-1">
                                    <img
                                        src={qrImageSrc}
                                        alt="ABDM Health Locker QR Code"
                                        className="w-20 h-20 border border-slate-200 rounded"
                                        data-testid="qr-code-img"
                                    />
                                    <p className="text-[9px] text-slate-400 text-center max-w-[90px]">
                                        Scan to view in ABDM Health Locker
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── PRINT STYLES ── */}
            <style>{`
        @media print {
          body { margin: 0; padding: 0; background: white; }
          .print\\:hidden { display: none !important; }
          #prescription-sheet {
            box-shadow: none !important;
            border: none !important;
          }
          @page {
            size: A4;
            margin: 0;
          }
        }
      `}</style>
        </>
    );
};

export default PrescriptionPrintPage;
