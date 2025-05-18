 # web-agent

 A smooth & efficient web-automation agent using LangChain and Playwright.

 ## Setup

 1. Install [Poetry](https://python-poetry.org/).
 2. Run `poetry install --with dev`.
 3. Install Playwright browsers: `poetry run playwright install chromium`.
 4. Copy `.env.example` to `.env` and set `OPENAI_API_KEY`.

 ## Usage

 Fill an online form:
 ```bash
 poetry run python main.py fill-form --url "https://example.com/contact" --payload-path data/form.json
 ```