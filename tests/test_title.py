from playwright.sync_api import expect
from playwright_helpers import get_sync_page

def test_example_dot_com_title():
    with get_sync_page() as page:
        page.goto("https://example.com")
        expect(page).to_have_title("Example Domain")