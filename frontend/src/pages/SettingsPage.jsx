import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { doctorAPI } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, Save, Loader2, Hospital, Stethoscope, User, MapPin, GraduationCap, Phone, Globe, FileDiff } from "lucide-react";

const SettingsPage = () => {
    const { doctor, login } = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(true);

    const [formData, setFormData] = useState({
        name: "",
        qualification: "",
        location: "",
        hospital_name: "",
        specialization: "",
        contact: "",
        reg_no: "",
        website: "",
    });

    useEffect(() => {
        fetchProfile();
    }, []);

    const fetchProfile = async () => {
        try {
            setFetching(true);
            const res = await doctorAPI.getProfile();
            const profile = res.data;
            setFormData({
                name: profile.name || "",
                qualification: profile.qualification || "",
                location: profile.location || "",
                hospital_name: profile.hospital_name || "",
                specialization: profile.specialization || "",
                contact: profile.contact || "",
                reg_no: profile.reg_no || "",
                website: profile.website || "",
            });
        } catch (err) {
            toast.error("Failed to load profile details");
        } finally {
            setFetching(false);
        }
    };

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await doctorAPI.updateProfile(formData);
            const updatedDoctor = res.data;
            // Update local storage via auth context
            const token = localStorage.getItem("token");
            login(token, updatedDoctor);
            toast.success("Profile settings updated successfully");
        } catch (error) {
            const msg = error.response?.data?.detail || "Update failed";
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-16">
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => navigate("/dashboard")}
                                className="p-2 -ml-2 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                <ArrowLeft className="w-5 h-5 text-slate-600" />
                            </button>
                            <h1 className="text-lg font-semibold text-slate-900">Doctor Profile & Settings</h1>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {fetching ? (
                    <div className="flex justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
                    </div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                            {/* Personal Info */}
                            <Card>
                                <CardHeader className="pb-4">
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <User className="w-5 h-5 text-teal-600" />
                                        Personal Details
                                    </CardTitle>
                                    <CardDescription>Your personal medical credentials</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label className="text-sm font-medium">Full Name</Label>
                                        <div className="relative">
                                            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <Input name="name" value={formData.name} onChange={handleChange} className="pl-10 text-sm" />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-sm font-medium">Qualification (e.g., MBBS, MD)</Label>
                                        <div className="relative">
                                            <GraduationCap className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <Input name="qualification" value={formData.qualification} onChange={handleChange} className="pl-10 text-sm" />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-sm font-medium">Registration No.</Label>
                                        <div className="relative">
                                            <FileDiff className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <Input name="reg_no" value={formData.reg_no} onChange={handleChange} placeholder="e.g. MCI-12345" className="pl-10 text-sm" />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Clinic / Hospital Info */}
                            <Card>
                                <CardHeader className="pb-4">
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <Hospital className="w-5 h-5 text-teal-600" />
                                        Clinic / Hospital Details
                                    </CardTitle>
                                    <CardDescription>This information prints on your prescriptions</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label className="text-sm font-medium">Hospital/Clinic Name</Label>
                                        <div className="relative">
                                            <Hospital className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <Input name="hospital_name" value={formData.hospital_name} onChange={handleChange} placeholder="DOCO AI Clinic" className="pl-10 text-sm" />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-sm font-medium">Specialization</Label>
                                        <div className="relative">
                                            <Stethoscope className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <Input name="specialization" value={formData.specialization} onChange={handleChange} placeholder="General Medicine" className="pl-10 text-sm" />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-sm font-medium">Location / Address</Label>
                                        <div className="relative">
                                            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <Input name="location" value={formData.location} onChange={handleChange} placeholder="City, State" className="pl-10 text-sm" />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-sm font-medium">Contact Number</Label>
                                        <div className="relative">
                                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <Input name="contact" value={formData.contact} onChange={handleChange} placeholder="+91 XXXXXXXXXX" className="pl-10 text-sm" />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-sm font-medium">Website</Label>
                                        <div className="relative">
                                            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <Input name="website" value={formData.website} onChange={handleChange} placeholder="www.yourclinic.com" className="pl-10 text-sm" />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                        </div>

                        <div className="mt-8 flex justify-end">
                            <Button type="submit" disabled={loading} className="gap-2 bg-teal-600 hover:bg-teal-700 w-full sm:w-auto px-8">
                                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Save Changes
                            </Button>
                        </div>
                    </form>
                )}
            </main>
        </div>
    );
};

export default SettingsPage;
