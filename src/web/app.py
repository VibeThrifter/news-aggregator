from __future__ import annotations

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from src.pipeline import run_aggregation

app = FastAPI(title="News Pluriformity POC")
app.mount("/static", StaticFiles(directory="src/web/static"), name="static")
templates = Jinja2Templates(directory="src/web/templates")


def _default_query() -> str:
    return "boerenprotest"


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    query = _default_query()
    clusters = run_aggregation(query, mode="algorithm")
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "query": query,
            "clusters": clusters,
            "mode": "algorithm",
        },
    )


@app.post("/", response_class=HTMLResponse)
async def search(request: Request, query: str = Form(...), mode: str = Form("algorithm")):
    clusters = run_aggregation(query, mode=mode)
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "query": query,
            "clusters": clusters,
            "mode": mode,
        },
    )
