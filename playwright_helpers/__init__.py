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
    
# Persistent shared browser session for multi-step flows
_pw_context = sync_playwright()
_pw = _pw_context.__enter__()
_browser = _pw.chromium.launch(
    headless=True,
    args=["--disable-blink-features=AutomationControlled"],
)
_context = _browser.new_context()
_shared_page = _context.new_page()

def get_shared_page():
    """Return a persistent Playwright page across multiple tool calls."""
    return _shared_page