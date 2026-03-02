import base64
import json
import time
from typing import Optional

import httpx
from Crypto.Cipher import PKCS1_OAEP
from Crypto.Hash import SHA1
from Crypto.PublicKey import RSA


class ABDMCrypto:
    """Handles ABDM V3 certificate retrieval and RSA-OAEP encryption."""

    def __init__(
        self,
        cert_url: str,
        timeout_seconds: float = 20.0,
        cert_cache_ttl_seconds: int = 900,
        auth_token: Optional[str] = None,
        x_cm_id: Optional[str] = None,
    ) -> None:
        self.cert_url = cert_url
        self.timeout_seconds = timeout_seconds
        self.cert_cache_ttl_seconds = cert_cache_ttl_seconds
        self.auth_token = auth_token
        self.x_cm_id = x_cm_id

        self._cached_cert_pem: Optional[str] = None
        self._cache_expiry_monotonic: float = 0.0

    def _auth_headers(self) -> dict:
        headers = {}
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"
        if self.x_cm_id:
            headers["X-CM-ID"] = self.x_cm_id
        return headers

    def _extract_pem_from_body(self, body_text: str) -> str:
        stripped = body_text.strip()

        # Many deployments return PEM as plain text.
        if "BEGIN PUBLIC KEY" in stripped or "BEGIN CERTIFICATE" in stripped:
            return stripped

        # Some gateways may return a JSON envelope.
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise RuntimeError("ABDM certificate response format is invalid") from exc

        for key in ("publicKey", "public_key", "certificate", "key"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        raise RuntimeError("ABDM certificate not found in response body")

    async def get_public_key(self) -> str:
        now = time.monotonic()
        if self._cached_cert_pem and now < self._cache_expiry_monotonic:
            return self._cached_cert_pem

        headers = self._auth_headers()
        timeout = httpx.Timeout(self.timeout_seconds)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.get(self.cert_url, headers=headers)
        except httpx.TimeoutException as exc:
            raise RuntimeError("Timed out while fetching ABDM certificate") from exc
        except httpx.HTTPError as exc:
            raise RuntimeError("Failed to call ABDM certificate endpoint") from exc

        if response.status_code >= 400:
            raise RuntimeError(
                f"ABDM certificate endpoint returned status {response.status_code}"
            )

        pem = self._extract_pem_from_body(response.text)
        self._cached_cert_pem = pem
        self._cache_expiry_monotonic = now + float(self.cert_cache_ttl_seconds)
        return pem

    async def encrypt(self, data: str) -> str:
        if not data:
            raise RuntimeError("No data provided for ABDM encryption")

        try:
            pub_key_pem = await self.get_public_key()
            recipient_key = RSA.import_key(pub_key_pem)
            cipher = PKCS1_OAEP.new(recipient_key, hashAlgo=SHA1)
            encrypted_data = cipher.encrypt(data.encode("utf-8"))
            return base64.b64encode(encrypted_data).decode("utf-8")
        except RuntimeError:
            raise
        except Exception as exc:
            raise RuntimeError("ABDM RSA encryption failed") from exc
