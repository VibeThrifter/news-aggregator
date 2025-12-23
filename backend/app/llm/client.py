"""LLM client implementations for generating event insights."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Dict, Optional

import httpx

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.llm.schemas import CriticalPayload, FactualPayload, InsightsPayload
from typing import TypeVar, Type
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)
import json
import re

logger = get_logger(__name__)


class LLMClientError(RuntimeError):
    """Base exception for LLM client failures."""


class LLMAuthenticationError(LLMClientError):
    """Raised when credentials are missing or rejected by the provider."""


class LLMTimeoutError(LLMClientError):
    """Raised when the provider request exceeds the configured timeout."""


class LLMResponseError(LLMClientError):
    """Raised when the provider returns an invalid or unexpected response."""

    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


@dataclass(slots=True)
class LLMResult:
    """Structured result returned by an LLM client."""

    provider: str
    model: str
    payload: InsightsPayload
    raw_content: str
    usage: Dict[str, Any] | None = None


@dataclass(slots=True)
class LLMGenericResult:
    """Generic structured result with any Pydantic model."""

    provider: str
    model: str
    payload: Any  # Will be the actual Pydantic model instance
    raw_content: str
    usage: Dict[str, Any] | None = None


@dataclass(slots=True)
class LLMResponse:
    """Simple text response from LLM without structured validation."""

    provider: str
    model: str
    content: str
    usage: Dict[str, Any] | None = None


class BaseLLMClient:
    """Protocol-style base class for LLM clients."""

    provider: str

    async def generate(self, prompt: str, *, correlation_id: str | None = None) -> LLMResult:
        raise NotImplementedError

    async def generate_text(
        self,
        prompt: str,
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
        correlation_id: str | None = None
    ) -> LLMResponse:
        """Generate simple text response without structured validation."""
        raise NotImplementedError

    async def generate_json(
        self,
        prompt: str,
        schema_class: Type[T],
        *,
        correlation_id: str | None = None
    ) -> LLMGenericResult:
        """Generate structured JSON response validated against a Pydantic schema."""
        raise NotImplementedError


def _strip_markdown_fences(content: str) -> str:
    """Remove optional markdown code fences from LLM responses."""

    stripped = content.strip()
    if not stripped.startswith("```"):
        return stripped

    without_ticks = stripped[3:]
    if without_ticks.lower().startswith("json"):
        without_ticks = without_ticks[4:]
    without_ticks = without_ticks.strip()
    if without_ticks.endswith("```"):
        without_ticks = without_ticks[:-3]
    return without_ticks.strip()


def _normalize_spectrum_values(json_str: str) -> str:
    """Normalize English spectrum values to Dutch equivalents."""

    # Mapping of common English values to Dutch
    spectrum_map = {
        "center": "mainstream",
        "centre": "mainstream",
        "center-right": "mainstream",
        "center-left": "mainstream",
        "centre-right": "mainstream",
        "centre-left": "mainstream",
        "left": "links",
        "left-wing": "links",
        "right": "rechts",
        "right-wing": "rechts",
        "alternative": "alternatief",
        "government": "overheid",
        "social media": "sociale_media",
        "social_media": "sociale_media",
    }

    # Parse JSON to normalize spectrum fields
    try:
        data = json.loads(json_str)

        def normalize_obj(obj):
            if isinstance(obj, dict):
                for key, value in obj.items():
                    if key == "spectrum" and isinstance(value, str):
                        # Normalize the spectrum value
                        normalized = spectrum_map.get(value.lower(), value)
                        obj[key] = normalized
                    elif isinstance(value, (dict, list)):
                        normalize_obj(value)
            elif isinstance(obj, list):
                for item in obj:
                    normalize_obj(item)

        normalize_obj(data)
        return json.dumps(data, ensure_ascii=False)
    except Exception:
        # If normalization fails, return original
        return json_str


class DeepSeekClient(BaseLLMClient):
    """Async client for the DeepSeek chat completion API (OpenAI-compatible)."""

    provider = "deepseek"

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        use_reasoner: bool = False,
    ) -> None:
        self.settings = settings or get_settings()
        self.transport = transport
        self.use_reasoner = use_reasoner

    @property
    def model_name(self) -> str:
        """Get the model name based on reasoner setting."""
        if self.use_reasoner:
            return self.settings.deepseek_reasoner_model_name
        return self.settings.deepseek_model_name

    async def generate(self, prompt: str, *, correlation_id: str | None = None) -> LLMResult:
        api_key = self.settings.deepseek_api_key
        if not api_key:
            raise LLMAuthenticationError("DeepSeek API key ontbreekt; configureer DEEPSEEK_API_KEY in .env")

        timeout = self.settings.llm_api_timeout_seconds
        max_retries = self.settings.llm_api_max_retries
        backoff = self.settings.llm_api_retry_backoff_seconds or 0.0
        base_url = self.settings.deepseek_api_base_url.rstrip("/")

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload: Dict[str, Any] = {
            "model": self.model_name,
            "temperature": self.settings.llm_temperature,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": "Je bent een pluriformiteitsanalist die Nederlandstalige nieuwsgebeurtenissen objectief duidt.",
                },
                {"role": "user", "content": prompt},
            ],
        }

        attempt = 0
        last_exception: Optional[Exception] = None
        while attempt <= max_retries:
            attempt += 1
            try:
                async with httpx.AsyncClient(
                    base_url=base_url,
                    timeout=timeout,
                    transport=self.transport,
                ) as client:
                    response = await client.post(
                        "/chat/completions",
                        headers=headers,
                        json=payload,
                    )
                if response.status_code == 401:
                    raise LLMAuthenticationError("DeepSeek API key ongeldig of ontbreekt toegangsrechten")
                if response.status_code in {429} or response.status_code >= 500:
                    raise LLMResponseError(
                        f"DeepSeek gaf status {response.status_code}", retryable=True
                    )
                if response.status_code >= 400:
                    raise LLMResponseError(
                        f"DeepSeek gaf status {response.status_code}: {response.text[:200]}", retryable=False
                    )

                try:
                    data = response.json()
                except ValueError as exc:
                    raise LLMResponseError("DeepSeek antwoordde met ongeldige JSON", retryable=True) from exc
                try:
                    choice = data["choices"][0]["message"]["content"]
                except (KeyError, IndexError) as exc:
                    raise LLMResponseError("Onvolledige respons van DeepSeek", retryable=False) from exc

                json_content = _strip_markdown_fences(choice)
                json_content = _normalize_spectrum_values(json_content)
                try:
                    payload_model = InsightsPayload.model_validate_json(json_content)
                except Exception as exc:
                    logger.error(
                        "json_validation_failed",
                        json_content=json_content[:500],
                        error=str(exc),
                        correlation_id=correlation_id,
                    )
                    raise LLMResponseError(f"JSON-respons kon niet worden gevalideerd: {str(exc)[:200]}", retryable=False) from exc

                usage = data.get("usage") if isinstance(data, dict) else None
                model_name = data.get("model", self.model_name)

                logger.info(
                    "llm_call_succeeded",
                    provider=self.provider,
                    model=model_name,
                    correlation_id=correlation_id,
                    prompt_length=len(prompt),
                    attempt=attempt,
                )
                return LLMResult(
                    provider=self.provider,
                    model=model_name,
                    payload=payload_model,
                    raw_content=json_content,
                    usage=usage if isinstance(usage, dict) else None,
                )
            except LLMAuthenticationError:
                raise
            except LLMTimeoutError as exc:
                last_exception = exc
            except httpx.TimeoutException:
                last_exception = LLMTimeoutError("DeepSeek verzoek time-out")
            except httpx.RequestError as exc:
                last_exception = LLMResponseError(str(exc), retryable=True)
            except LLMResponseError as exc:
                if not exc.retryable or attempt > max_retries:
                    raise
                last_exception = exc
            except Exception as exc:
                last_exception = LLMResponseError(str(exc), retryable=False)

            if attempt > max_retries:
                break
            sleep_for = backoff * attempt if backoff else 0
            if sleep_for:
                await asyncio.sleep(sleep_for)
            logger.warning(
                "llm_call_retry",
                provider=self.provider,
                attempt=attempt,
                correlation_id=correlation_id,
                error=str(last_exception) if last_exception else "onbekend",
            )

        if last_exception:
            raise last_exception
        raise LLMResponseError("Onbekende fout bij het aanroepen van DeepSeek", retryable=False)

    async def generate_text(
        self,
        prompt: str,
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
        correlation_id: str | None = None
    ) -> LLMResponse:
        """Generate simple text response without structured validation."""
        api_key = self.settings.deepseek_api_key
        if not api_key:
            raise LLMAuthenticationError("DeepSeek API key ontbreekt; configureer DEEPSEEK_API_KEY in .env")

        timeout = self.settings.llm_api_timeout_seconds
        max_retries = self.settings.llm_api_max_retries
        backoff = self.settings.llm_api_retry_backoff_seconds or 0.0
        base_url = self.settings.deepseek_api_base_url.rstrip("/")

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload: Dict[str, Any] = {
            "model": self.model_name,
            "temperature": temperature if temperature is not None else self.settings.llm_temperature,
            "messages": [
                {"role": "user", "content": prompt},
            ],
        }
        if max_tokens:
            payload["max_tokens"] = max_tokens

        attempt = 0
        last_exception: Optional[Exception] = None
        while attempt <= max_retries:
            attempt += 1
            try:
                async with httpx.AsyncClient(
                    base_url=base_url,
                    timeout=timeout,
                    transport=self.transport,
                ) as client:
                    response = await client.post(
                        "/chat/completions",
                        headers=headers,
                        json=payload,
                    )
                if response.status_code == 401:
                    raise LLMAuthenticationError("DeepSeek API key ongeldig of ontbreekt toegangsrechten")
                if response.status_code in {429} or response.status_code >= 500:
                    raise LLMResponseError(
                        f"DeepSeek gaf status {response.status_code}", retryable=True
                    )
                if response.status_code >= 400:
                    raise LLMResponseError(
                        f"DeepSeek gaf status {response.status_code}: {response.text[:200]}", retryable=False
                    )

                try:
                    data = response.json()
                except ValueError as exc:
                    raise LLMResponseError("DeepSeek antwoordde met ongeldige JSON", retryable=True) from exc
                try:
                    choice = data["choices"][0]["message"]["content"]
                except (KeyError, IndexError) as exc:
                    raise LLMResponseError("Onvolledige respons van DeepSeek", retryable=False) from exc

                usage = data.get("usage") if isinstance(data, dict) else None
                model_name = data.get("model", self.model_name)

                logger.info(
                    "llm_text_call_succeeded",
                    provider=self.provider,
                    model=model_name,
                    correlation_id=correlation_id,
                    prompt_length=len(prompt),
                    attempt=attempt,
                )
                return LLMResponse(
                    provider=self.provider,
                    model=model_name,
                    content=choice,
                    usage=usage if isinstance(usage, dict) else None,
                )
            except LLMAuthenticationError:
                raise
            except LLMTimeoutError as exc:
                last_exception = exc
            except httpx.TimeoutException:
                last_exception = LLMTimeoutError("DeepSeek verzoek time-out")
            except httpx.RequestError as exc:
                last_exception = LLMResponseError(str(exc), retryable=True)
            except LLMResponseError as exc:
                if not exc.retryable or attempt > max_retries:
                    raise
                last_exception = exc
            except Exception as exc:
                last_exception = LLMResponseError(str(exc), retryable=False)

            if attempt > max_retries:
                break
            sleep_for = backoff * attempt if backoff else 0
            if sleep_for:
                await asyncio.sleep(sleep_for)
            logger.warning(
                "llm_text_call_retry",
                provider=self.provider,
                attempt=attempt,
                correlation_id=correlation_id,
                error=str(last_exception) if last_exception else "onbekend",
            )

        if last_exception:
            raise last_exception
        raise LLMResponseError("Onbekende fout bij het aanroepen van DeepSeek", retryable=False)

    async def generate_json(
        self,
        prompt: str,
        schema_class: Type[T],
        *,
        correlation_id: str | None = None
    ) -> LLMGenericResult:
        """Generate structured JSON response validated against a Pydantic schema."""
        api_key = self.settings.deepseek_api_key
        if not api_key:
            raise LLMAuthenticationError("DeepSeek API key ontbreekt; configureer DEEPSEEK_API_KEY in .env")

        timeout = self.settings.llm_api_timeout_seconds
        max_retries = self.settings.llm_api_max_retries
        backoff = self.settings.llm_api_retry_backoff_seconds or 0.0
        base_url = self.settings.deepseek_api_base_url.rstrip("/")

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload: Dict[str, Any] = {
            "model": self.model_name,
            "temperature": self.settings.llm_temperature,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": "Je bent een pluriformiteitsanalist die Nederlandstalige nieuwsgebeurtenissen objectief duidt.",
                },
                {"role": "user", "content": prompt},
            ],
        }

        attempt = 0
        last_exception: Optional[Exception] = None
        while attempt <= max_retries:
            attempt += 1
            try:
                async with httpx.AsyncClient(
                    base_url=base_url,
                    timeout=timeout,
                    transport=self.transport,
                ) as client:
                    response = await client.post(
                        "/chat/completions",
                        headers=headers,
                        json=payload,
                    )
                if response.status_code == 401:
                    raise LLMAuthenticationError("DeepSeek API key ongeldig of ontbreekt toegangsrechten")
                if response.status_code in {429} or response.status_code >= 500:
                    raise LLMResponseError(
                        f"DeepSeek gaf status {response.status_code}", retryable=True
                    )
                if response.status_code >= 400:
                    raise LLMResponseError(
                        f"DeepSeek gaf status {response.status_code}: {response.text[:200]}", retryable=False
                    )

                try:
                    data = response.json()
                except ValueError as exc:
                    raise LLMResponseError("DeepSeek antwoordde met ongeldige JSON", retryable=True) from exc
                try:
                    choice = data["choices"][0]["message"]["content"]
                except (KeyError, IndexError) as exc:
                    raise LLMResponseError("Onvolledige respons van DeepSeek", retryable=False) from exc

                json_content = _strip_markdown_fences(choice)
                json_content = _normalize_spectrum_values(json_content)
                try:
                    payload_model = schema_class.model_validate_json(json_content)
                except Exception as exc:
                    logger.error(
                        "json_validation_failed",
                        schema=schema_class.__name__,
                        json_content=json_content[:500],
                        error=str(exc),
                        correlation_id=correlation_id,
                    )
                    raise LLMResponseError(f"JSON-respons kon niet worden gevalideerd: {str(exc)[:200]}", retryable=False) from exc

                usage = data.get("usage") if isinstance(data, dict) else None
                model_name = data.get("model", self.model_name)

                logger.info(
                    "llm_json_call_succeeded",
                    provider=self.provider,
                    model=model_name,
                    schema=schema_class.__name__,
                    correlation_id=correlation_id,
                    prompt_length=len(prompt),
                    attempt=attempt,
                )
                return LLMGenericResult(
                    provider=self.provider,
                    model=model_name,
                    payload=payload_model,
                    raw_content=json_content,
                    usage=usage if isinstance(usage, dict) else None,
                )
            except LLMAuthenticationError:
                raise
            except LLMTimeoutError as exc:
                last_exception = exc
            except httpx.TimeoutException:
                last_exception = LLMTimeoutError("DeepSeek verzoek time-out")
            except httpx.RequestError as exc:
                last_exception = LLMResponseError(str(exc), retryable=True)
            except LLMResponseError as exc:
                if not exc.retryable or attempt > max_retries:
                    raise
                last_exception = exc
            except Exception as exc:
                last_exception = LLMResponseError(str(exc), retryable=False)

            if attempt > max_retries:
                break
            sleep_for = backoff * attempt if backoff else 0
            if sleep_for:
                await asyncio.sleep(sleep_for)
            logger.warning(
                "llm_json_call_retry",
                provider=self.provider,
                schema=schema_class.__name__,
                attempt=attempt,
                correlation_id=correlation_id,
                error=str(last_exception) if last_exception else "onbekend",
            )

        if last_exception:
            raise last_exception
        raise LLMResponseError("Onbekende fout bij het aanroepen van DeepSeek", retryable=False)


class MistralClient(BaseLLMClient):
    """Async client for the Mistral chat completion API."""

    provider = "mistral"

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.transport = transport

    async def generate(self, prompt: str, *, correlation_id: str | None = None) -> LLMResult:
        api_key = self.settings.mistral_api_key
        if not api_key:
            raise LLMAuthenticationError("Mistral API key ontbreekt; configureer MISTRAL_API_KEY in .env")

        timeout = self.settings.llm_api_timeout_seconds
        max_retries = self.settings.llm_api_max_retries
        backoff = self.settings.llm_api_retry_backoff_seconds or 0.0
        base_url = self.settings.llm_api_base_url.rstrip("/")

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload: Dict[str, Any] = {
            "model": self.settings.llm_model_name,
            "temperature": self.settings.llm_temperature,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": "Je bent een pluriformiteitsanalist die Nederlandstalige nieuwsgebeurtenissen objectief duidt.",
                },
                {"role": "user", "content": prompt},
            ],
        }

        attempt = 0
        last_exception: Optional[Exception] = None
        while attempt <= max_retries:
            attempt += 1
            try:
                async with httpx.AsyncClient(
                    base_url=base_url,
                    timeout=timeout,
                    transport=self.transport,
                ) as client:
                    response = await client.post(
                        "/chat/completions",
                        headers=headers,
                        json=payload,
                    )
                if response.status_code == 401:
                    raise LLMAuthenticationError("Mistral API key ongeldig of ontbreekt toegangsrechten")
                if response.status_code in {429} or response.status_code >= 500:
                    raise LLMResponseError(
                        f"Mistral gaf status {response.status_code}", retryable=True
                    )
                if response.status_code >= 400:
                    raise LLMResponseError(
                        f"Mistral gaf status {response.status_code}: {response.text[:200]}", retryable=False
                    )

                try:
                    data = response.json()
                except ValueError as exc:
                    raise LLMResponseError("Mistral antwoordde met ongeldige JSON", retryable=True) from exc
                try:
                    choice = data["choices"][0]["message"]["content"]
                except (KeyError, IndexError) as exc:
                    raise LLMResponseError("Onvolledige respons van Mistral", retryable=False) from exc

                json_content = _strip_markdown_fences(choice)
                # Normalize spectrum values before validation
                json_content = _normalize_spectrum_values(json_content)
                try:
                    payload_model = InsightsPayload.model_validate_json(json_content)
                except Exception as exc:  # pragma: no cover - validation detail surfaced to caller
                    logger.error(
                        "json_validation_failed",
                        json_content=json_content[:500],
                        error=str(exc),
                        correlation_id=correlation_id,
                    )
                    raise LLMResponseError(f"JSON-respons kon niet worden gevalideerd: {str(exc)[:200]}", retryable=False) from exc

                usage = data.get("usage") if isinstance(data, dict) else None
                model_name = data.get("model", self.settings.llm_model_name)

                logger.info(
                    "llm_call_succeeded",
                    provider=self.provider,
                    model=model_name,
                    correlation_id=correlation_id,
                    prompt_length=len(prompt),
                    attempt=attempt,
                )
                return LLMResult(
                    provider=self.provider,
                    model=model_name,
                    payload=payload_model,
                    raw_content=json_content,
                    usage=usage if isinstance(usage, dict) else None,
                )
            except LLMAuthenticationError:
                raise
            except LLMTimeoutError as exc:
                last_exception = exc
            except httpx.TimeoutException as exc:
                last_exception = LLMTimeoutError("Mistral verzoek time-out")
            except httpx.RequestError as exc:
                last_exception = LLMResponseError(str(exc), retryable=True)
            except LLMResponseError as exc:
                if not exc.retryable or attempt > max_retries:
                    raise
                last_exception = exc
            except Exception as exc:  # pragma: no cover - unexpected runtime errors
                last_exception = LLMResponseError(str(exc), retryable=False)

            if attempt > max_retries:
                break
            sleep_for = backoff * attempt if backoff else 0
            if sleep_for:
                await asyncio.sleep(sleep_for)
            logger.warning(
                "llm_call_retry",
                provider=self.provider,
                attempt=attempt,
                correlation_id=correlation_id,
                error=str(last_exception) if last_exception else "onbekend",
            )

        if last_exception:
            raise last_exception
        raise LLMResponseError("Onbekende fout bij het aanroepen van Mistral", retryable=False)

    async def generate_text(
        self,
        prompt: str,
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
        correlation_id: str | None = None
    ) -> LLMResponse:
        """Generate simple text response without structured validation."""
        api_key = self.settings.mistral_api_key
        if not api_key:
            raise LLMAuthenticationError("Mistral API key ontbreekt; configureer MISTRAL_API_KEY in .env")

        timeout = self.settings.llm_api_timeout_seconds
        max_retries = self.settings.llm_api_max_retries
        backoff = self.settings.llm_api_retry_backoff_seconds or 0.0
        base_url = self.settings.llm_api_base_url.rstrip("/")

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload: Dict[str, Any] = {
            "model": self.settings.llm_model_name,
            "temperature": temperature if temperature is not None else self.settings.llm_temperature,
            "messages": [
                {"role": "user", "content": prompt},
            ],
        }
        if max_tokens:
            payload["max_tokens"] = max_tokens

        attempt = 0
        last_exception: Optional[Exception] = None
        while attempt <= max_retries:
            attempt += 1
            try:
                async with httpx.AsyncClient(
                    base_url=base_url,
                    timeout=timeout,
                    transport=self.transport,
                ) as client:
                    response = await client.post(
                        "/chat/completions",
                        headers=headers,
                        json=payload,
                    )
                if response.status_code == 401:
                    raise LLMAuthenticationError("Mistral API key ongeldig of ontbreekt toegangsrechten")
                if response.status_code in {429} or response.status_code >= 500:
                    raise LLMResponseError(
                        f"Mistral gaf status {response.status_code}", retryable=True
                    )
                if response.status_code >= 400:
                    raise LLMResponseError(
                        f"Mistral gaf status {response.status_code}: {response.text[:200]}", retryable=False
                    )

                try:
                    data = response.json()
                except ValueError as exc:
                    raise LLMResponseError("Mistral antwoordde met ongeldige JSON", retryable=True) from exc
                try:
                    choice = data["choices"][0]["message"]["content"]
                except (KeyError, IndexError) as exc:
                    raise LLMResponseError("Onvolledige respons van Mistral", retryable=False) from exc

                usage = data.get("usage") if isinstance(data, dict) else None
                model_name = data.get("model", self.settings.llm_model_name)

                logger.info(
                    "llm_text_call_succeeded",
                    provider=self.provider,
                    model=model_name,
                    correlation_id=correlation_id,
                    prompt_length=len(prompt),
                    attempt=attempt,
                )
                return LLMResponse(
                    provider=self.provider,
                    model=model_name,
                    content=choice,
                    usage=usage if isinstance(usage, dict) else None,
                )
            except LLMAuthenticationError:
                raise
            except LLMTimeoutError as exc:
                last_exception = exc
            except httpx.TimeoutException as exc:
                last_exception = LLMTimeoutError("Mistral verzoek time-out")
            except httpx.RequestError as exc:
                last_exception = LLMResponseError(str(exc), retryable=True)
            except LLMResponseError as exc:
                if not exc.retryable or attempt > max_retries:
                    raise
                last_exception = exc
            except Exception as exc:  # pragma: no cover - unexpected runtime errors
                last_exception = LLMResponseError(str(exc), retryable=False)

            if attempt > max_retries:
                break
            sleep_for = backoff * attempt if backoff else 0
            if sleep_for:
                await asyncio.sleep(sleep_for)
            logger.warning(
                "llm_text_call_retry",
                provider=self.provider,
                attempt=attempt,
                correlation_id=correlation_id,
                error=str(last_exception) if last_exception else "onbekend",
            )

        if last_exception:
            raise last_exception
        raise LLMResponseError("Onbekende fout bij het aanroepen van Mistral", retryable=False)

    async def generate_json(
        self,
        prompt: str,
        schema_class: Type[T],
        *,
        correlation_id: str | None = None
    ) -> LLMGenericResult:
        """Generate structured JSON response validated against a Pydantic schema."""
        api_key = self.settings.mistral_api_key
        if not api_key:
            raise LLMAuthenticationError("Mistral API key ontbreekt; configureer MISTRAL_API_KEY in .env")

        timeout = self.settings.llm_api_timeout_seconds
        max_retries = self.settings.llm_api_max_retries
        backoff = self.settings.llm_api_retry_backoff_seconds or 0.0
        base_url = self.settings.llm_api_base_url.rstrip("/")

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload: Dict[str, Any] = {
            "model": self.settings.llm_model_name,
            "temperature": self.settings.llm_temperature,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": "Je bent een pluriformiteitsanalist die Nederlandstalige nieuwsgebeurtenissen objectief duidt.",
                },
                {"role": "user", "content": prompt},
            ],
        }

        attempt = 0
        last_exception: Optional[Exception] = None
        while attempt <= max_retries:
            attempt += 1
            try:
                async with httpx.AsyncClient(
                    base_url=base_url,
                    timeout=timeout,
                    transport=self.transport,
                ) as client:
                    response = await client.post(
                        "/chat/completions",
                        headers=headers,
                        json=payload,
                    )
                if response.status_code == 401:
                    raise LLMAuthenticationError("Mistral API key ongeldig of ontbreekt toegangsrechten")
                if response.status_code in {429} or response.status_code >= 500:
                    raise LLMResponseError(
                        f"Mistral gaf status {response.status_code}", retryable=True
                    )
                if response.status_code >= 400:
                    raise LLMResponseError(
                        f"Mistral gaf status {response.status_code}: {response.text[:200]}", retryable=False
                    )

                try:
                    data = response.json()
                except ValueError as exc:
                    raise LLMResponseError("Mistral antwoordde met ongeldige JSON", retryable=True) from exc
                try:
                    choice = data["choices"][0]["message"]["content"]
                except (KeyError, IndexError) as exc:
                    raise LLMResponseError("Onvolledige respons van Mistral", retryable=False) from exc

                json_content = _strip_markdown_fences(choice)
                json_content = _normalize_spectrum_values(json_content)
                try:
                    payload_model = schema_class.model_validate_json(json_content)
                except Exception as exc:
                    logger.error(
                        "json_validation_failed",
                        schema=schema_class.__name__,
                        json_content=json_content[:500],
                        error=str(exc),
                        correlation_id=correlation_id,
                    )
                    raise LLMResponseError(f"JSON-respons kon niet worden gevalideerd: {str(exc)[:200]}", retryable=False) from exc

                usage = data.get("usage") if isinstance(data, dict) else None
                model_name = data.get("model", self.settings.llm_model_name)

                logger.info(
                    "llm_json_call_succeeded",
                    provider=self.provider,
                    model=model_name,
                    schema=schema_class.__name__,
                    correlation_id=correlation_id,
                    prompt_length=len(prompt),
                    attempt=attempt,
                )
                return LLMGenericResult(
                    provider=self.provider,
                    model=model_name,
                    payload=payload_model,
                    raw_content=json_content,
                    usage=usage if isinstance(usage, dict) else None,
                )
            except LLMAuthenticationError:
                raise
            except LLMTimeoutError as exc:
                last_exception = exc
            except httpx.TimeoutException:
                last_exception = LLMTimeoutError("Mistral verzoek time-out")
            except httpx.RequestError as exc:
                last_exception = LLMResponseError(str(exc), retryable=True)
            except LLMResponseError as exc:
                if not exc.retryable or attempt > max_retries:
                    raise
                last_exception = exc
            except Exception as exc:
                last_exception = LLMResponseError(str(exc), retryable=False)

            if attempt > max_retries:
                break
            sleep_for = backoff * attempt if backoff else 0
            if sleep_for:
                await asyncio.sleep(sleep_for)
            logger.warning(
                "llm_json_call_retry",
                provider=self.provider,
                schema=schema_class.__name__,
                attempt=attempt,
                correlation_id=correlation_id,
                error=str(last_exception) if last_exception else "onbekend",
            )

        if last_exception:
            raise last_exception
        raise LLMResponseError("Onbekende fout bij het aanroepen van Mistral", retryable=False)


__all__ = [
    "BaseLLMClient",
    "DeepSeekClient",
    "LLMAuthenticationError",
    "LLMClientError",
    "LLMGenericResult",
    "LLMResponse",
    "LLMResponseError",
    "LLMResult",
    "LLMTimeoutError",
    "MistralClient",
]
