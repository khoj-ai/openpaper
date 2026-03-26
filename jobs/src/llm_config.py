import logging
import os
from dataclasses import dataclass
from enum import Enum
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional

import yaml


class LLMProvider(str, Enum):
    GEMINI = "gemini"
    OPENAI = "openai"
    GROQ = "groq"
    CEREBRAS = "cerebras"


class RoutingTask(str, Enum):
    GENERIC = "generic"
    METADATA_EXTRACTION = "metadata_extraction"
    DATA_TABLE_EXTRACTION = "data_table_extraction"


@dataclass(frozen=True)
class ProviderRouteConfig:
    key: str
    enabled: bool
    default_model: str
    fast_model: str
    provider_type: str
    base_url: Optional[str] = None
    api_key_env: Optional[str] = None


@dataclass(frozen=True)
class TaskRouteConfig:
    primary: str
    failover: List[str]


@dataclass(frozen=True)
class RetryRouteConfig:
    max_attempts_per_provider: int
    failover_on: List[str]
    no_failover_on: List[str]


@dataclass(frozen=True)
class LLMRoutingConfig:
    default_provider: str
    providers: Dict[str, ProviderRouteConfig]
    routing: Dict[RoutingTask, TaskRouteConfig]
    retry: RetryRouteConfig


logger = logging.getLogger(__name__)

DEFAULT_PROVIDER_MODELS: dict[str, tuple[str, str]] = {
    LLMProvider.GEMINI.value: ("gemini-3.1-pro-preview", "gemini-3-flash-preview"),
    LLMProvider.OPENAI.value: ("gpt-4.1", "gpt-4.1-mini"),
    LLMProvider.GROQ.value: ("openai/gpt-oss-120b", "moonshotai/kimi-k2-instruct-0905"),
    LLMProvider.CEREBRAS.value: ("gpt-oss-120b", "zai-glm-4.7"),
}

DEFAULT_TASK_PRIMARY: dict[RoutingTask, str] = {
    RoutingTask.GENERIC: LLMProvider.GEMINI.value,
    RoutingTask.METADATA_EXTRACTION: LLMProvider.GEMINI.value,
    RoutingTask.DATA_TABLE_EXTRACTION: LLMProvider.GEMINI.value,
}

BUILTIN_PROVIDER_ENV_KEYS: dict[str, str] = {
    LLMProvider.GEMINI.value: "GEMINI_API_KEY",
    LLMProvider.OPENAI.value: "OPENAI_API_KEY",
    LLMProvider.GROQ.value: "GROQ_API_KEY",
    LLMProvider.CEREBRAS.value: "CEREBRAS_API_KEY",
}

BUILTIN_PROVIDER_BASE_URL_ENV_KEYS: dict[str, Optional[str]] = {
    LLMProvider.GEMINI.value: None,
    LLMProvider.OPENAI.value: "OPENAI_BASE_URL",
    LLMProvider.GROQ.value: "GROQ_BASE_URL",
    LLMProvider.CEREBRAS.value: "CEREBRAS_BASE_URL",
}

BUILTIN_PROVIDER_DEFAULT_BASE_URLS: dict[str, Optional[str]] = {
    LLMProvider.GEMINI.value: None,
    LLMProvider.OPENAI.value: None,
    LLMProvider.GROQ.value: "https://api.groq.com/openai/v1",
    LLMProvider.CEREBRAS.value: "https://api.cerebras.ai/v1",
}


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _config_path() -> Path:
    custom = os.getenv("LLM_CONFIG_PATH")
    if custom:
        return Path(custom)
    return _repo_root() / "config" / "llm.yaml"


def _load_yaml_data() -> dict:
    path = _config_path()
    if not path.exists():
        logger.warning("LLM config file %s not found. Falling back to defaults.", path)
        return {}

    with open(path, "r", encoding="utf-8") as f:
        loaded = yaml.safe_load(f) or {}

    if not isinstance(loaded, dict):
        raise ValueError(f"Invalid LLM config format in {path}")

    return loaded


def _build_builtin_provider_configs(providers_data: dict) -> Dict[str, ProviderRouteConfig]:
    providers: Dict[str, ProviderRouteConfig] = {}
    for provider_key, (default_model, fast_model) in DEFAULT_PROVIDER_MODELS.items():
        provider_data = providers_data.get(provider_key, {})
        base_url_env = BUILTIN_PROVIDER_BASE_URL_ENV_KEYS[provider_key]
        base_url = (
            os.getenv(base_url_env) if base_url_env else None
        ) or provider_data.get("base_url") or BUILTIN_PROVIDER_DEFAULT_BASE_URLS[provider_key]
        providers[provider_key] = ProviderRouteConfig(
            key=provider_key,
            enabled=bool(
                provider_data.get(
                    "enabled",
                    provider_key == LLMProvider.GEMINI.value,
                )
            ),
            default_model=str(provider_data.get("default_model", default_model)),
            fast_model=str(provider_data.get("fast_model", fast_model)),
            provider_type="builtin",
            base_url=str(base_url) if base_url else None,
            api_key_env=BUILTIN_PROVIDER_ENV_KEYS[provider_key],
        )
    return providers


def _build_custom_provider_configs(custom_providers_data: dict) -> Dict[str, ProviderRouteConfig]:
    providers: Dict[str, ProviderRouteConfig] = {}
    for provider_key, provider_data in custom_providers_data.items():
        if not isinstance(provider_data, dict):
            raise ValueError(f"Invalid config for custom provider {provider_key}")

        providers[provider_key] = ProviderRouteConfig(
            key=provider_key,
            enabled=bool(provider_data.get("enabled", False)),
            default_model=str(provider_data["default_model"]),
            fast_model=str(provider_data.get("fast_model", provider_data["default_model"])),
            provider_type=str(provider_data.get("provider_type", "openai_compatible")),
            base_url=str(provider_data["base_url"]),
            api_key_env=str(provider_data["api_key_env"]),
        )
    return providers


@lru_cache(maxsize=1)
def get_llm_routing_config() -> LLMRoutingConfig:
    data = _load_yaml_data()

    builtin_providers = _build_builtin_provider_configs(data.get("providers", {}))
    custom_providers = _build_custom_provider_configs(data.get("custom_providers", {}))
    providers = {**builtin_providers, **custom_providers}

    default_provider = str(data.get("default_provider", LLMProvider.GEMINI.value))
    if default_provider not in providers:
        raise ValueError(f"Unknown default provider: {default_provider}")

    routing_data = data.get("routing", {})
    routing: Dict[RoutingTask, TaskRouteConfig] = {}
    for task in RoutingTask:
        task_data = routing_data.get(task.value, {})
        primary = str(task_data.get("primary", DEFAULT_TASK_PRIMARY[task]))
        if primary not in providers:
            raise ValueError(f"Unknown primary provider '{primary}' for task '{task.value}'")
        failover = [str(value) for value in task_data.get("failover", [])]
        unknown_failovers = [value for value in failover if value not in providers]
        if unknown_failovers:
            raise ValueError(
                f"Unknown failover providers for task '{task.value}': {', '.join(unknown_failovers)}"
            )
        routing[task] = TaskRouteConfig(primary=primary, failover=failover)

    retry_data = data.get("retry", {})
    retry = RetryRouteConfig(
        max_attempts_per_provider=int(retry_data.get("max_attempts_per_provider", 2)),
        failover_on=[str(item) for item in retry_data.get("failover_on", [])],
        no_failover_on=[str(item) for item in retry_data.get("no_failover_on", [])],
    )

    return LLMRoutingConfig(
        default_provider=default_provider,
        providers=providers,
        routing=routing,
        retry=retry,
    )
