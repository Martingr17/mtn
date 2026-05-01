import importlib.util
import json
import logging
import os
import sys
import traceback

from mangum import Mangum

logger = logging.getLogger(__name__)
_code_root = os.path.dirname(os.path.abspath(__file__))
if _code_root not in sys.path:
    sys.path.insert(0, _code_root)

_app_package_root = os.path.join(_code_root, "app")
_app_init_file = os.path.join(_app_package_root, "__init__.py")
if os.path.isdir(_app_package_root) and os.path.exists(_app_init_file) and "app" not in sys.modules:
    app_spec = importlib.util.spec_from_file_location(
        "app",
        _app_init_file,
        submodule_search_locations=[_app_package_root],
    )
    if app_spec and app_spec.loader:
        app_module = importlib.util.module_from_spec(app_spec)
        sys.modules["app"] = app_module
        app_spec.loader.exec_module(app_module)

_mangum_handler = None
_settings = None


def _ensure_runtime_handler(context):
    global _mangum_handler, _settings

    database_backend = os.getenv("DATABASE_BACKEND", "postgres")
    ydb_token = getattr(context, "access_token", None) if context else None

    if _mangum_handler is None and database_backend == "ydb" and ydb_token:
        os.environ["YDB_ACCESS_TOKEN"] = ydb_token
        os.environ["YDB_CREDENTIALS_MODE"] = "access-token"

    if _mangum_handler is None:
        from app.config import settings
        from app.main import app

        _settings = settings
        _mangum_handler = Mangum(app, lifespan="auto")

    return _mangum_handler


def _normalize_yandex_gateway_event(event, context):
    if not isinstance(event, dict):
        return event

    if "httpMethod" not in event or "requestContext" not in event or "resource" in event:
        return event

    headers = event.get("headers") or {}
    original_path = (
        headers.get("X-Envoy-Original-Path")
        or headers.get("x-envoy-original-path")
        or str(event.get("url") or "").split("?", 1)[0]
        or event.get("path")
        or "/"
    )
    resource_path = event.get("path") or original_path
    request_context = event.get("requestContext") or {}

    return {
        "resource": resource_path,
        "path": original_path,
        "httpMethod": event.get("httpMethod", "GET"),
        "headers": headers,
        "multiValueHeaders": event.get("multiValueHeaders") or {},
        "queryStringParameters": event.get("queryStringParameters") or {},
        "multiValueQueryStringParameters": event.get("multiValueQueryStringParameters") or {},
        "pathParameters": event.get("pathParams") or event.get("pathParameters") or {},
        "stageVariables": None,
        "requestContext": {
            **request_context,
            "resourcePath": resource_path,
            "path": original_path,
            "httpMethod": event.get("httpMethod", "GET"),
            "stage": request_context.get("stage", "$default"),
            "requestId": request_context.get("requestId", context.aws_request_id if context else "serverless"),
        },
        "body": event.get("body"),
        "isBase64Encoded": event.get("isBase64Encoded", False),
    }


def handler(event, context):
    try:
        runtime_handler = _ensure_runtime_handler(context)
        normalized_event = _normalize_yandex_gateway_event(event, context)
        debug_path = None
        debug_header = None
        debug_response_header = None
        if isinstance(event, dict):
            debug_path = event.get("path")
            headers = event.get("headers") or {}
            if isinstance(headers, dict):
                debug_header = headers.get("x-debug-event") or headers.get("X-Debug-Event")
                debug_response_header = headers.get("x-debug-response") or headers.get("X-Debug-Response")
        if _settings and _settings.debug and (
            debug_path == "/api/__event" or str(debug_header).lower() in {"1", "true", "yes"}
        ):
            return {
                "statusCode": 200,
                "headers": {"content-type": "application/json"},
                "body": json.dumps(
                    {
                        "raw_event": event,
                        "normalized_event": normalized_event,
                    },
                    ensure_ascii=False,
                ),
            }
        response = runtime_handler(normalized_event, context)
        if _settings and _settings.debug and str(debug_response_header).lower() in {"1", "true", "yes"}:
            return {
                "statusCode": 200,
                "headers": {"content-type": "application/json"},
                "body": json.dumps(
                    {
                        "normalized_event": normalized_event,
                        "handler_response": response,
                    },
                    ensure_ascii=False,
                ),
            }
        return response
    except Exception as exc:  # pragma: no cover - used in serverless runtime only
        logger.exception("Unhandled serverless execution error")
        payload = {
            "error": str(exc),
        }
        if "No module named 'app'" in str(exc):
            payload["cwd"] = os.getcwd()
            payload["code_root"] = _code_root
            payload["code_root_entries"] = sorted(os.listdir(_code_root))
            payload["sys_path"] = sys.path

        if _settings and _settings.debug:
            payload["traceback"] = traceback.format_exc()
            if isinstance(event, dict):
                payload["event_keys"] = list(event.keys())
                request_context = event.get("requestContext")
                if isinstance(request_context, dict):
                    payload["request_context_keys"] = list(request_context.keys())

        return {
            "statusCode": 500,
            "headers": {"content-type": "application/json"},
            "body": json.dumps(payload, ensure_ascii=False),
        }
