import json
import logging
import traceback

from mangum import Mangum

from app.config import settings
from app.main import app


mangum_handler = Mangum(app, lifespan="auto")
logger = logging.getLogger(__name__)


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
        if settings.debug and (
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
        response = mangum_handler(normalized_event, context)
        if settings.debug and str(debug_response_header).lower() in {"1", "true", "yes"}:
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

        if settings.debug:
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
