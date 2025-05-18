import json
import typer

from agent import AGENT

app = typer.Typer()

@app.command()
def fill_form(url: str, payload_path: str):
    """Fill an online form with JSON payload."""
    with open(payload_path) as f:
        payload = json.load(f)
    prompt = f"""Go to {url} and submit the following form data:
{json.dumps(payload, indent=2)}"""
    result = AGENT.run(prompt)
    typer.echo(result)

if __name__ == "__main__":
    app()