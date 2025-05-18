from langchain.tools import BaseTool
from pydantic import BaseModel

from playwright_helpers import get_shared_page

class NavigateURLInput(BaseModel):
    url: str

class NavigateURLTool(BaseTool):
    name = "navigate_url"
    description = "Open the given URL in the active browser tab."
    args_schema = NavigateURLInput

    def _run(self, url: str) -> str:
        page = get_shared_page()
        page.goto(url, wait_until="domcontentloaded")
        return page.title()

    async def _arun(self, url: str):
        raise NotImplementedError("Use the sync version for now")

class ClickElementInput(BaseModel):
    selector: str

class ClickElementTool(BaseTool):
    name = "click_element"
    description = "Click the element specified by selector."
    args_schema = ClickElementInput

    def _run(self, selector: str) -> str:
        page = get_shared_page()
        page.click(selector)
        return f"Clicked element with selector: {selector}"

    async def _arun(self, selector: str):
        raise NotImplementedError("Use the sync version for now")

class TypeTextInput(BaseModel):
    selector: str
    text: str

class TypeTextTool(BaseTool):
    name = "type_text"
    description = "Type text into the element specified by selector."
    args_schema = TypeTextInput

    def _run(self, selector: str, text: str) -> str:
        page = get_shared_page()
        page.fill(selector, text)
        return f"Typed text into element with selector: {selector}"

    async def _arun(self, selector: str, text: str):
        raise NotImplementedError("Use the sync version for now")

class GetTextContentInput(BaseModel):
    selector: str

class GetTextContentTool(BaseTool):
    name = "get_text_content"
    description = "Get text content of the element specified by selector."
    args_schema = GetTextContentInput

    def _run(self, selector: str) -> str:
        page = get_shared_page()
        return page.inner_text(selector)

    async def _arun(self, selector: str):
        raise NotImplementedError("Use the sync version for now")

class GetSimplifiedHTMLInput(BaseModel):
    selector: str

class GetSimplifiedHTMLTool(BaseTool):
    name = "get_simplified_html"
    description = "Get inner HTML of the element specified by selector."
    args_schema = GetSimplifiedHTMLInput

    def _run(self, selector: str) -> str:
        page = get_shared_page()
        return page.inner_html(selector).strip()

    async def _arun(self, selector: str):
        raise NotImplementedError("Use the sync version for now")