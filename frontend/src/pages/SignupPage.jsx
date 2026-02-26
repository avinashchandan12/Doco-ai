import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { authAPI } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Stethoscope, Mail, Lock, User, MapPin, GraduationCap, Loader2 } from "lucide-react";

const SignupPage = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    qualification: "",
    location: "",
  });
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const { name, email, password, qualification, location } = formData;
    
    if (!name || !email || !password || !qualification || !location) {
      toast.error("Please fill in all fields");
      return;
    }

    setLoading(true);
    try {
      const response = await authAPI.signup(formData);
      const { access_token, doctor } = response.data;
      login(access_token, doctor);
      toast.success("Account created successfully!");
      navigate("/dashboard");
    } catch (error) {
      const message = error.response?.data?.detail || "Signup failed";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-slate-50 to-white">
      <div className="w-full max-w-md animate-fadeIn">
        {/* Logo & Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Stethoscope className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">AI Clinical Co-Pilot</h1>
          <p className="text-slate-600 mt-2">Create Your Account</p>
        </div>

        <Card className="shadow-lg border-slate-200">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl font-semibold">Sign Up</CardTitle>
            <CardDescription>Enter your details to create an account</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-medium">Full Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="name"
                    name="name"
                    type="text"
                    placeholder="Dr. John Smith"
                    value={formData.name}
                    onChange={handleChange}
                    className="pl-10"
                    data-testid="signup-name-input"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="doctor@hospital.com"
                    value={formData.email}
                    onChange={handleChange}
                    className="pl-10"
                    data-testid="signup-email-input"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    placeholder="Create a strong password"
                    value={formData.password}
                    onChange={handleChange}
                    className="pl-10"
                    data-testid="signup-password-input"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="qualification" className="text-sm font-medium">Qualification</Label>
                <div className="relative">
                  <GraduationCap className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="qualification"
                    name="qualification"
                    type="text"
                    placeholder="MBBS, MD"
                    value={formData.qualification}
                    onChange={handleChange}
                    className="pl-10"
                    data-testid="signup-qualification-input"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="location" className="text-sm font-medium">Location</Label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="location"
                    name="location"
                    type="text"
                    placeholder="Rural Health Center, District"
                    value={formData.location}
                    onChange={handleChange}
                    className="pl-10"
                    data-testid="signup-location-input"
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-11 font-medium mt-2"
                disabled={loading}
                data-testid="signup-submit-btn"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating Account...
                  </>
                ) : (
                  "Create Account"
                )}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-slate-600">
                Already have an account?{" "}
                <Link to="/login" className="text-primary font-medium hover:underline" data-testid="login-link">
                  Sign In
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Disclaimer */}
        <p className="text-xs text-slate-500 text-center mt-6 px-4">
          This system provides clinical decision support only. Final medical judgment rests with the physician.
        </p>
      </div>
    </div>
  );
};

export default SignupPage;
