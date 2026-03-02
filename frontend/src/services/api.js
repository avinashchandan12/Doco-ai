import axios from "axios";

const API_URL = process.env.REACT_APP_BACKEND_URL;

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    "Content-Type": "application/json",
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("doctor");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

// Auth APIs
export const authAPI = {
  signup: (data) => api.post("/auth/signup", data),
  login: (data) => api.post("/auth/login", data),
};

// Doctor APIs
export const doctorAPI = {
  getProfile: () => api.get("/doctor/profile"),
  updateProfile: (data) => api.put("/doctor/profile", data),
};

// Case APIs
export const caseAPI = {
  create: (data) => api.post("/cases/create", data),
  list: () => api.get("/cases/list"),
  get: (caseId) => api.get(`/cases/${caseId}`),
  update: (caseId, data) => api.put(`/cases/${caseId}`, data),
};

// Upload APIs
export const uploadAPI = {
  prescription: (file) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post("/cases/upload-prescription", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  image: (file) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post("/cases/upload-image", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
};

// AI APIs
export const aiAPI = {
  analyseCase: (caseId) => api.post(`/ai/analyse-case?case_id=${caseId}`),
};

// ABHA APIs
export const abhaAPI = {
  generateOtp: (aadhaarNumber) =>
    api.post("/v3/abha/generate-otp", { aadhaar_number: aadhaarNumber }),
};

// Report APIs
export const reportAPI = {
  generate: (caseId) => api.post(`/reports/generate?case_id=${caseId}`),
  getDownloadUrl: (filename) => `${API_URL}/api/reports/download/${filename}`,
};


// Prescription AI APIs
export const prescriptionAPI = {
  suggest: (data) => api.post("/prescriptions/suggest", data),
  accept: (data) => api.post("/prescriptions/accept", data),
  getWorkspace: (patientId, sessionId) =>
    api.get(`/prescriptions/workspace/${patientId}/${sessionId}`),
  print: (data) => api.post("/prescriptions/print", data),
};

export default api;
