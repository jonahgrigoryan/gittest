# Implementing a Smooth & Efficient Web‑Automation Agent on macOS

### LangChain × Playwright – v1.1 (May 2025)

---

## Table of Contents

1. [Why LangChain + Playwright?](#1-why-langchain--playwright)
2. [Project Bootstrap](#2-project-bootstrap)
3. [macOS Prerequisites](#3-macos-prerequisites)
4. [Virtual Environment & Dependency Pinning](#4-virtual-environment--dependency-pinning)
5. [Secret Management](#5-secret-management)
6. [Playwright Helper Layer](#6-playwright-helper-layer)
7. [LangChain Tools Layer](#7-langchain-tools-layer)
8. [Agent Construction](#8-agent-construction)
9. [Demo CLI](#9-demo-cli)
10. [Testing & CI Pipeline](#10-testing--ci-pipeline)
11. [Debugging & Profiling](#11-debugging--profiling)
12. [Scaling & Deployment](#12-scaling--deployment)
13. [Common Pitfalls & Remedies](#13-common-pitfalls--remedies)
14. [Roadmap / Next Steps](#14-roadmap--next-steps)

---

## 1  Why LangChain + Playwright?

LangChain gives you a batteries‑included framework for building LLM‑driven agents, while Playwright provides a deterministic, cross‑browser automation API. Used together, you can:

* **Plan** high‑level browsing flows in natural language (LangChain prompts)
* **Act** via strictly typed tools that wrap Playwright page actions
* **Observe** the DOM and feed structured state back to the LLM for the next stepr

The combo delivers a robust ReAct loop that can tackle login flows, form filling, data scraping, and even self‑healing selector discovery—all from Python.

---

## 2  Project Bootstrap

> **Recommended tooling:** Poetry for packaging & venv management, Ruff + Black for formatting, Pytest for tests, and GitHub Actions for CI.
bash
# 1. Create project skeleton
poetry new web‑agent && cd web‑agent

# 2. Initial repo hygiene
git init
cat <<'EOF' > .gitignore
.env
__pycache__/
*.log
trace.zip
EOF

# 3. Create boilerplate dirs
mkdir prompts playwright_helpers tools
Add a minimal **README.md**, **LICENSE** (MIT or Apache‑2), and **tests/** folder now so they don’t get forgotten later.

---

## 3  macOS Prerequisites

* **Homebrew** – package manager
* **Python ≥ 3.11** – `brew install python@3.11`
* **Git & VS Code** – dev essentials

Optional but handy:

* `gh` (GitHub CLI) for repo onboarding
* iTerm 2 + Oh My Zsh for a nicer terminal

---

## 4  Virtual Environment & Dependency Pinning

Using Poetry keeps your dependencies reproducible across machines and CI.
bash
# Activate the new env
poetry env use 3.11

# Add runtime deps
poetry add langchain langchain-openai playwright \
           python‑dotenv tenacity structlog typer

# Optional: local LLM via Ollama
poetry add langchain-community ollama

# Install Playwright browsers
poetry run playwright install chromium

# Add dev‑only deps
poetry add --group dev black ruff pytest pytest-playwright mypy

# Freeze exact versions
poetry lock
For pip/venv users, translate the above into a `requirements.txt` plus `pip-tools`.

---

## 5  Secret Management

| Context                 | Recommended store                                                            |
| ----------------------- | ---------------------------------------------------------------------------- |
| **Local dev**           | `.env` + `python‑dotenv` or macOS **Keychain** via the `keyring` lib         |
| **CI / GitHub Actions** | Masked **Repository Secrets**                                                |
| **Docker / k8s**        | Runtime env vars orchestrated by your secret manager (e.g., HashiCorp Vault) |

Create a *sample* file so newcomers know what keys to supply:
text
# .env.example
OPENAI_API_KEY=
Commit `.env.example`; never commit real secrets.

---

## 6  Playwright Helper Layer

File: **playwright\_helpers/**************init**************.py**
python
from contextlib import asynccontextmanager, contextmanager
from typing import AsyncIterator, Iterator

from playwright.sync_api import sync_playwright
from playwright.async_api import async_playwright
from tenacity import retry, wait_fixed, stop_after_attempt

@retry(wait=wait_fixed(1), stop=stop_after_attempt(3))
def _launch_sync() -> Iterator:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=["--disable-blink-features=AutomationControlled"])
        page = browser.new_page()
        try:
            yield page
        finally:
            browser.close()

@contextmanager
def get_sync_page():
    with _launch_sync() as page:
        yield page

@asynccontextmanager
async def get_async_page() -> AsyncIterator:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page()
        try:
            yield page
        finally:
            await browser.close()
Key points:

* **Retries** wrap transient network/selector errors.
* Separate **sync** and **async** contexts so you can benchmark which suits your agent.
* Headless Chromium for CI; flip `headless=False` locally when debugging.

---

## 7  LangChain Tools Layer

File: **tools/web\_tools.py**
python
from langchain.tools import BaseTool
from playwright.sync_api import Page
from pydantic import BaseModel

from playwright_helpers import get_sync_page

class NavigateURLInput(BaseModel):
    url: str

class NavigateURLTool(BaseTool):
    name = "navigate_url"
    description = "Open the given URL in the active browser tab."
    args_schema = NavigateURLInput

    def _run(self, url: str) -> str:  # type: ignore[override]
        with get_sync_page() as page:
            page.goto(url, wait_until="domcontentloaded")
            return page.title()

    async def _arun(self, url: str):  # type: ignore[override]
        raise NotImplementedError("Use the sync version for now")
Add complementary tools (`click_element`, `type_text`, `get_text_content`, `get_simplified_html`) following the same pattern. Each tool should:

1. Accept a **Pydantic schema** for strong typing.
2. Return **only** what the LLM needs (e.g., a trimmed string, JSON, or a boolean).

---

## 8  Agent Construction

File: **agent.py**
python
from langchain.agents import create_react_agent
from langchain_openai import ChatOpenAI
from tools.web_tools import NavigateURLTool, ClickElementTool, TypeTextTool

llm = ChatOpenAI(model_name="gpt-4o-mini", temperature=0.2)

TOOLS = [
    NavigateURLTool(),
    ClickElementTool(),
    TypeTextTool(),
]

AGENT = create_react_agent(
    llm=llm,
    tools=TOOLS,
    prompt="""You are a web‑automation assistant. Plan what to do, then act.
Steps:
1. Think step‑by‑step.
2. Use the tools to interact with the browser.
3. Conclude with a short answer.""",
)
For advanced users, switch to **Structured Chat Agent** + OpenAI function‑calling to eliminate prompt parsing errors.

---

## 9  Demo CLI

File: **main.py**
python
import json
import typer
from agent import AGENT

app = typer.Typer()

@app.command()
def fill_form(url: str, payload_path: str):
    """Fill an online form with JSON payload."""
    payload = json.loads(open(payload_path).read())
    prompt = f"""Go to {url} and submit the following form data:\n{json.dumps(payload, indent=2)}"""
    result = AGENT.run(prompt)
    typer.echo(result)

if __name__ == "__main__":
    app()
Usage:
bash
poetry run python main.py fill-form --url "https://example.com/contact" --payload-path data/form.json
---

## 10  Testing & CI Pipeline

### 10.1  Local tests
bash
# Run linter & unit tests
poetry run ruff check .
poetry run pytest -q
Create a minimal **tests/test\_title.py**:
python
from playwright.sync_api import expect
from playwright_helpers import get_sync_page

def test_example_dot_com_title():
    with get_sync_page() as page:
        page.goto("https://example.com")
        expect(page).to_have_title("Example Domain")
### 10.2  GitHub Actions workflow

File: **.github/workflows/ci.yml**
yaml
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - name: Install Poetry
        run: pip install poetry
      - name: Install deps
        run: |
          poetry install --with dev
          poetry run playwright install chromium
      - name: Lint & Test
        run: |
          poetry run ruff check .
          poetry run pytest -q
---

## 11  Debugging & Profiling

| Tool                     | When to use                | How                                                      |
| ------------------------ | -------------------------- | -------------------------------------------------------- |
| **Playwright Inspector** | Step through actions       | `PWDEBUG=1 poetry run python main.py …`                  |
| **Trace Viewer**         | Post‑mortem timeline       | Add `context.tracing.start()` / `stop(path="trace.zip")` |
| **playwright‑codegen**   | Generate selectors quickly | `poetry run playwright codegen https://target.com`       |
| **Browser DevTools**     | Inspect live DOM/CSS       | `page.pause()` then open the browser                     |

---

## 12  Scaling & Deployment

* **Concurrency** – launch multiple browser **contexts** under a single Chromium instance, or outsource to a *browserless* SaaS when you hit CPU/ram limits.
* **Docker** – package everything, including Playwright, into a slim image:
dockerfile
FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy
WORKDIR /app
COPY pyproject.toml poetry.lock /app/
RUN poetry install --no-dev --no-interaction --no-ansi
COPY . /app
ENTRYPOINT ["python", "main.py"]
* **Kubernetes** – treat each agent run as a short‑lived Job for easier autoscaling.

---

## 13  Common Pitfalls & Remedies

| Symptom                     | Likely Cause                   | Fix                                                                                                        |
| --------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| **CAPTCHA appears**         | Bot detection                  | Switch to residential proxy, introduce realistic delays, or integrate a third‑party solving API.           |
| **Selectors break**         | Page redesign                  | Adopt *data‑test* attributes, or build an LLM “selector‑healing” tool that tries multiple strategies.      |
| **Pages load slowly in CI** | Missing fonts / slower network | Increase `timeout`, disable asset downloads (`route.fulfill`), or use Playwright’s `HAR` mode for caching. |
| **Memory leaks**            | Browser not closing            | Ensure each context is closed; consider watchdog that kills stale Chromium instances.                      |

---

## 14  Roadmap / Next Steps

1. **Vector‑store memory** – let the agent remember visited pages for smarter navigation.
2. **Self‑healing selectors** – generate alternative XPaths/CSS via the LLM on failure.
3. **Embeddings‑driven planning** – match new tasks to past successful trajectories.
4. **Distributed task queue** – push jobs to Celery or Redis Queues for horizontal scaling.
5. **UI Dashboard** – surface run history, traces, and errors via a small FastAPI + React frontend.

---