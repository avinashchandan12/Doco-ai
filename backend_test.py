#!/usr/bin/env python3
"""
AI Clinical Co-Pilot Backend API Testing Suite
Tests all backend endpoints for the clinical decision support system
"""

import requests
import json
import sys
import time
from datetime import datetime
from pathlib import Path

class ClinicalCoPilotTester:
    def __init__(self, base_url="https://medicalpilot.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.token = None
        self.doctor_id = None
        self.case_id = None
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def log_test(self, name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name} - {details}")
        
        self.test_results.append({
            "test": name,
            "success": success,
            "details": details
        })

    def make_request(self, method, endpoint, data=None, files=None, expected_status=200):
        """Make HTTP request with proper headers"""
        url = f"{self.api_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'
        
        if files:
            headers.pop('Content-Type', None)  # Let requests set it for multipart

        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=30)
            elif method == 'POST':
                if files:
                    response = requests.post(url, files=files, headers=headers, timeout=30)
                else:
                    response = requests.post(url, json=data, headers=headers, timeout=30)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=30)
            else:
                return False, f"Unsupported method: {method}"

            success = response.status_code == expected_status
            
            if success:
                try:
                    return True, response.json()
                except:
                    return True, {"message": "Success"}
            else:
                try:
                    error_detail = response.json().get('detail', f'Status {response.status_code}')
                except:
                    error_detail = f'Status {response.status_code}'
                return False, error_detail

        except requests.exceptions.Timeout:
            return False, "Request timeout"
        except requests.exceptions.ConnectionError:
            return False, "Connection error"
        except Exception as e:
            return False, str(e)

    def test_root_endpoint(self):
        """Test root API endpoint"""
        success, result = self.make_request('GET', '')
        self.log_test("Root API Endpoint", success, result if not success else "")
        return success

    def test_signup(self):
        """Test doctor signup"""
        timestamp = int(time.time())
        signup_data = {
            "name": f"Dr. Test User {timestamp}",
            "email": f"test.doctor.{timestamp}@hospital.com",
            "password": "TestPassword123!",
            "qualification": "MBBS, MD",
            "location": "Rural Health Center, Test District"
        }
        
        success, result = self.make_request('POST', 'auth/signup', signup_data)
        
        if success:
            self.token = result.get('access_token')
            self.doctor_id = result.get('doctor', {}).get('id')
            
        self.log_test("Doctor Signup", success, result if not success else "")
        return success

    def test_login(self):
        """Test doctor login with existing credentials"""
        # Use the same credentials from signup
        timestamp = int(time.time())
        login_data = {
            "email": f"test.doctor.{timestamp}@hospital.com",
            "password": "TestPassword123!"
        }
        
        success, result = self.make_request('POST', 'auth/login', login_data)
        
        if success:
            self.token = result.get('access_token')
            self.doctor_id = result.get('doctor', {}).get('id')
            
        self.log_test("Doctor Login", success, result if not success else "")
        return success

    def test_get_profile(self):
        """Test getting doctor profile"""
        if not self.token:
            self.log_test("Get Doctor Profile", False, "No auth token")
            return False
            
        success, result = self.make_request('GET', 'doctor/profile')
        self.log_test("Get Doctor Profile", success, result if not success else "")
        return success

    def test_create_case(self):
        """Test creating a new patient case"""
        if not self.token:
            self.log_test("Create Case", False, "No auth token")
            return False
            
        case_data = {
            "symptoms": ["fever", "cough", "headache"],
            "duration": "2_to_3_days",
            "vitals": {
                "temperature": "101°F",
                "bp": "120/80",
                "pulse": "85 bpm"
            },
            "clinical_notes": "Patient reports mild fatigue and loss of appetite",
            "prescription_data": None,
            "image_url": None
        }
        
        success, result = self.make_request('POST', 'cases/create', case_data, expected_status=200)
        
        if success:
            self.case_id = result.get('id')
            if self.case_id:
                print(f"   Created case ID: {self.case_id[:8]}...")
            else:
                success = False
                result = "No case ID returned"
            
        self.log_test("Create Case", success, result if not success else "")
        return success

    def test_list_cases(self):
        """Test listing all cases for doctor"""
        if not self.token:
            self.log_test("List Cases", False, "No auth token")
            return False
            
        success, result = self.make_request('GET', 'cases/list')
        
        if success:
            cases_count = len(result) if isinstance(result, list) else 0
            print(f"   Found {cases_count} cases")
            
        self.log_test("List Cases", success, result if not success else "")
        return success

    def test_get_case(self):
        """Test getting specific case"""
        if not self.token or not self.case_id:
            self.log_test("Get Case", False, "No auth token or case ID")
            return False
            
        success, result = self.make_request('GET', f'cases/{self.case_id}')
        self.log_test("Get Case", success, result if not success else "")
        return success

    def test_update_case(self):
        """Test updating a case"""
        if not self.token or not self.case_id:
            self.log_test("Update Case", False, "No auth token or case ID")
            return False
            
        update_data = {
            "symptoms": ["fever", "cough", "headache", "fatigue"],
            "duration": "4_to_7_days",
            "vitals": {
                "temperature": "100°F",
                "bp": "118/78",
                "pulse": "82 bpm"
            },
            "clinical_notes": "Patient reports improvement in symptoms after rest",
            "prescription_data": None,
            "image_url": None
        }
        
        success, result = self.make_request('PUT', f'cases/{self.case_id}', update_data)
        self.log_test("Update Case", success, result if not success else "")
        return success

    def test_ai_analysis(self):
        """Test AI analysis of case"""
        if not self.token or not self.case_id:
            self.log_test("AI Analysis", False, "No auth token or case ID")
            return False
            
        print("   Running AI analysis (this may take 10-15 seconds)...")
        success, result = self.make_request('POST', f'ai/analyse-case?case_id={self.case_id}')
        
        if success:
            ai_analysis = result.get('ai_analysis', {})
            if ai_analysis:
                print(f"   AI Summary: {ai_analysis.get('clinical_summary', 'N/A')[:100]}...")
                
        self.log_test("AI Analysis", success, result if not success else "")
        return success

    def test_generate_report(self):
        """Test PDF report generation"""
        if not self.token or not self.case_id:
            self.log_test("Generate Report", False, "No auth token or case ID")
            return False
            
        success, result = self.make_request('POST', f'reports/generate?case_id={self.case_id}')
        
        if success:
            pdf_url = result.get('pdf_url')
            if pdf_url:
                print(f"   PDF URL: {pdf_url}")
                
        self.log_test("Generate Report", success, result if not success else "")
        return success

    def test_prescription_upload(self):
        """Test prescription OCR upload (mock)"""
        if not self.token:
            self.log_test("Prescription Upload", False, "No auth token")
            return False
            
        # Create a dummy file for testing
        test_content = b"Mock prescription image content"
        files = {'file': ('prescription.jpg', test_content, 'image/jpeg')}
        
        success, result = self.make_request('POST', 'cases/upload-prescription', files=files)
        
        if success:
            medications = result.get('medications', [])
            print(f"   Extracted {len(medications)} medications")
            
        self.log_test("Prescription Upload", success, result if not success else "")
        return success

    def test_image_upload(self):
        """Test condition image upload"""
        if not self.token:
            self.log_test("Image Upload", False, "No auth token")
            return False
            
        # Create a dummy image file for testing
        test_content = b"Mock image content"
        files = {'file': ('condition.jpg', test_content, 'image/jpeg')}
        
        success, result = self.make_request('POST', 'cases/upload-image', files=files)
        
        if success:
            image_url = result.get('image_url')
            if image_url:
                print(f"   Image URL: {image_url}")
                
        self.log_test("Image Upload", success, result if not success else "")
        return success

    def run_all_tests(self):
        """Run complete test suite"""
        print(f"🏥 AI Clinical Co-Pilot Backend Testing")
        print(f"📡 Testing API: {self.api_url}")
        print(f"⏰ Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 60)
        
        # Test sequence
        tests = [
            self.test_root_endpoint,
            self.test_signup,
            self.test_get_profile,
            self.test_create_case,
            self.test_list_cases,
            self.test_get_case,
            self.test_update_case,
            self.test_prescription_upload,
            self.test_image_upload,
            self.test_ai_analysis,
            self.test_generate_report,
        ]
        
        for test in tests:
            try:
                test()
            except Exception as e:
                self.log_test(test.__name__, False, str(e))
            
            # Small delay between tests
            time.sleep(0.5)
        
        # Print summary
        print("=" * 60)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All tests passed!")
            return 0
        else:
            print("⚠️  Some tests failed. Check details above.")
            return 1

def main():
    """Main test runner"""
    tester = ClinicalCoPilotTester()
    return tester.run_all_tests()

if __name__ == "__main__":
    sys.exit(main())