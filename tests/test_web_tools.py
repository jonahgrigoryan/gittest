import pytest

from playwright_helpers import get_shared_page
from tools.web_tools import (
    NavigateURLTool,
    ClickElementTool,
    TypeTextTool,
    GetTextContentTool,
    GetSimplifiedHTMLTool,
)

@pytest.fixture(autouse=True)
def reset_page():
    page = get_shared_page()
    # Start from a blank document
    page.set_content("<html><body></body></html>")
    yield

def test_navigate_to_data_url():
    html = "<html><head><title>Foo</title></head><body>Bar</body></html>"
    data_url = f"data:text/html,{html}"
    title = NavigateURLTool()._run(data_url)
    assert title == "Foo"

def test_click_element():
    page = get_shared_page()
    # Add a button that toggles window.clicked
    page.set_content("""
    <html><body>
      <button id=btn>Click</button>
      <script>window.clicked = false;
        document.getElementById('btn').addEventListener('click', () => { window.clicked = true; });
      </script>
    </body></html>
    """)
    result = ClickElementTool()._run("#btn")
    assert "Clicked element with selector: #btn" in result
    assert page.evaluate("window.clicked") is True

def test_type_text():
    page = get_shared_page()
    page.set_content('<html><body><input id="input" value="" /></body></html>')
    result = TypeTextTool()._run("#input", "hello world")
    assert "Typed text into element with selector: #input" in result
    assert page.input_value("#input") == "hello world"

def test_get_text_content():
    page = get_shared_page()
    page.set_content('<html><body><div id="d">Sample Text</div></body></html>')
    text = GetTextContentTool()._run("#d")
    assert text == "Sample Text"

def test_get_simplified_html():
    page = get_shared_page()
    page.set_content('<html><body><div id="h"><span>Test</span></div></body></html>')
    html = GetSimplifiedHTMLTool()._run("#h")
    # Expect inner HTML trimmed
    assert html == '<span>Test</span>'