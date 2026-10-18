from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.auth_routes import router as auth_router
from app.api.capture_routes import router as capture_router
from app.api.feed_routes import router as feed_router
from app.api.routes import router
from app.core.config import get_settings
from app.core.logging import configure_logging

settings = get_settings()
configure_logging(settings.log_level)


@asynccontextmanager
async def lifespan(app: FastAPI):
    del app
    settings.validate_runtime()
    yield


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Environmental hazard monitoring API. EIA plants are reference locations, not verified active job sites.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Last-Event-ID",
    ],
)
app.include_router(auth_router)
app.include_router(feed_router)
app.include_router(capture_router)
app.include_router(router)


@app.exception_handler(HTTPException)
async def problem_details(request: Request, exc):
    return JSONResponse(
        status_code=exc.status_code,
        media_type="application/problem+json",
        content={
            "type": "about:blank",
            "title": str(exc.detail),
            "status": exc.status_code,
            "detail": str(exc.detail),
            "instance": str(request.url.path),
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_problem_details(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        media_type="application/problem+json",
        content={
            "type": "https://planit-control.local/problems/validation",
            "title": "Request validation failed",
            "status": 422,
            "detail": "One or more request values are invalid.",
            "instance": str(request.url.path),
            "errors": jsonable_encoder(exc.errors()),
        },
    )
