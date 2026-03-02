import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import HTTPException


class ABDMService:
    """ABDM V3 API wrapper for Aadhaar OTP initiation."""

    def __init__(
        self,
        enrol_by_aadhaar_url: str,
        gateway_token: str,
        timeout_seconds: float = 20.0,
        x_cm_id: Optional[str] = None,
    ) -> None:
        self.enrol_by_aadhaar_url = enrol_by_aadhaar_url
        self.gateway_token = gateway_token
        self.timeout_seconds = timeout_seconds
        self.x_cm_id = x_cm_id

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    def _headers(self, request_id: str) -> dict:
        headers = {
            "Authorization": f"Bearer {self.gateway_token}",
            "REQUEST-ID": request_id,
            "TIMESTAMP": self._timestamp(),
            "Content-Type": "application/json",
        }
        if self.x_cm_id:
            headers["X-CM-ID"] = self.x_cm_id
        return headers

    @staticmethod
    def _extract_upstream_error(response: httpx.Response) -> str:
        try:
            payload = response.json()
            for key in ("message", "error", "description", "details"):
                value = payload.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
        except Exception:
            pass
        return response.text[:500] if response.text else "Unknown ABDM error"

    async def enrol_by_aadhaar(self, encrypted_aadhaar: str) -> tuple[dict, str]:
        if not self.gateway_token:
            raise HTTPException(status_code=500, detail="ABDM gateway token is not configured")

        request_id = str(uuid.uuid4())
        payload = {
            "aadhaar": encrypted_aadhaar,
            "timestamp": self._timestamp(),
        }
        headers = self._headers(request_id)
        timeout = httpx.Timeout(self.timeout_seconds)

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    self.enrol_by_aadhaar_url,
                    json=payload,
                    headers=headers,
                )
        except httpx.TimeoutException as exc:
            raise HTTPException(status_code=504, detail="ABDM gateway timeout") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="ABDM gateway request failed") from exc

        if response.status_code >= 400:
            error_detail = self._extract_upstream_error(response)
            status_code = response.status_code if response.status_code < 500 else 502
            raise HTTPException(status_code=status_code, detail=error_detail)

        try:
            response_data = response.json()
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Invalid ABDM response payload") from exc

        return response_data, request_id
