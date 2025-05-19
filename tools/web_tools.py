from langchain.tools import BaseTool
from pydantic import BaseModel
from typing import Type

from playwright_helpers import get_shared_page

class NavigateURLInput(BaseModel):
    url: str

class NavigateURLTool(BaseTool):
    name: str = "navigate_url"
    description: str = "Open the given URL in the active browser tab."
    args_schema: Type[BaseModel] = NavigateURLInput

    def _run(self, url: str) -> str:
        page = get_shared_page()
        page.goto(url, wait_until="domcontentloaded")
        return page.title()

    async def _arun(self, url: str):
        raise NotImplementedError("Use the sync version for now")

class ClickElementInput(BaseModel):
    selector: str

class ClickElementTool(BaseTool):
    name: str = "click_element"
    description: str = "Click the element specified by selector."
    args_schema: Type[BaseModel] = ClickElementInput

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
    name: str = "type_text"
    description: str = "Type text into the element specified by selector."
    args_schema: Type[BaseModel] = TypeTextInput

    def _run(self, selector: str, text: str) -> str:
        page = get_shared_page()
        page.fill(selector, text)
        return f"Typed text into element with selector: {selector}"

    async def _arun(self, selector: str, text: str):
        raise NotImplementedError("Use the sync version for now")

class GetTextContentInput(BaseModel):
    selector: str

class GetTextContentTool(BaseTool):
    name: str = "get_text_content"
    description: str = "Get text content of the element specified by selector."
    args_schema: Type[BaseModel] = GetTextContentInput

    def _run(self, selector: str) -> str:
        page = get_shared_page()
        return page.inner_text(selector)

    async def _arun(self, selector: str):
        raise NotImplementedError("Use the sync version for now")

class GetSimplifiedHTMLInput(BaseModel):
    selector: str

class GetSimplifiedHTMLTool(BaseTool):
    name: str = "get_simplified_html"
    description: str = "Get inner HTML of the element specified by selector."
    args_schema: Type[BaseModel] = GetSimplifiedHTMLInput

    def _run(self, selector: str) -> str:
        page = get_shared_page()
        return page.inner_html(selector).strip()

    async def _arun(self, selector: str):
        raise NotImplementedError("Use the sync version for now")