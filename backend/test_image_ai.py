import asyncio
import os
from dotenv import load_dotenv

# Load env vars
load_dotenv()

# We need to test the analyze_case_with_ai function
from server import analyze_case_with_ai

async def main():
    case_data = {
        "id": "test_case_123",
        "patient_id": "test_patient",
        "symptoms": ["Rash on arm"],
        "duration": "2 days",
        "clinical_notes": "Patient complains of an itchy red rash.",
        "image_url": "https://doco-ai-uploads.s3.ap-south-1.amazonaws.com/test_image.jpg"
    }

    try:
        # Note: AWS credentials must be set in .env for this to work successfully, 
        # but if the S3 bucket is public it might not need it, or we can see if it fails gracefully
        print("Running AI analysis...")
        result = await analyze_case_with_ai(case_data)
        print("Analysis completed successfully.")
        print("Image findings:", result.get("ai_analysis", {}).get("image_findings"))
    except Exception as e:
        print(f"Error during analysis: {e}")

if __name__ == "__main__":
    asyncio.run(main())
