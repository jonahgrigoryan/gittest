import logger  # configure structlog
from langchain.agents import create_react_agent
from langchain_openai import ChatOpenAI
from tools.web_tools import (
    NavigateURLTool,
    ClickElementTool,
    TypeTextTool,
)

llm = ChatOpenAI(model_name="gpt-4o-mini", temperature=0.2)

TOOLS = [
    NavigateURLTool(),
    ClickElementTool(),
    TypeTextTool(),
]

AGENT = create_react_agent(
    llm=llm,
    tools=TOOLS,
    prompt="""You are a web-automation assistant. Plan what to do, then act.
Steps:
1. Think step-by-step.
2. Use the tools to interact with the browser.
3. Conclude with a short answer.""",
)