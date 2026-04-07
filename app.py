import os
import json
import re
from fastapi import FastAPI, Request, HTTPException, Body
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import httpx
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

CONFIG_FILE = "config.json"
PROMPT_FILE = "prompt.txt"

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                return json.load(f)
        except Exception as e:
            print(f"DEBUG: Error loading config file: {e}")
    return {
        "api_key": os.getenv("OPENROUTER_API_KEY", ""),
        "model_name": "qwen/qwen-2.5-72b-instruct:free"
    }

def save_config(config):
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=4)

def load_prompt():
    if os.path.exists(PROMPT_FILE):
        with open(PROMPT_FILE, "r") as f:
            return f.read()
    return "Identify key sentences in this text for study highlights. Return a JSON array of strings: {text}"

# Initialize config
config = load_config()

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def read_index():
    return FileResponse('static/index.html')

@app.get("/admin")
async def read_admin():
    return FileResponse('static/admin.html')

class HighlightRequest(BaseModel):
    text: str

@app.post("/api/process-pdf")
async def process_pdf(request: HighlightRequest):
    print("DEBUG: Processing PDF request...")
    current_config = load_config()
    api_key = current_config.get("api_key")
    model_name = current_config.get("model_name")

    if not api_key:
        print("DEBUG ERROR: API key is missing")
        raise HTTPException(status_code=500, detail="OpenRouter API key not configured.")

    prompt_template = load_prompt()
    text_content = request.text[:4000]
    prompt = prompt_template.replace("{text}", text_content)

    async with httpx.AsyncClient() as client:
        try:
            print(f"DEBUG: Calling OpenRouter with model {model_name}")
            response = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model_name,
                    "messages": [
                        {"role": "user", "content": prompt}
                    ]
                },
                timeout=90.0
            )

            print(f"DEBUG: OpenRouter status: {response.status_code}")
            if response.status_code != 200:
                print(f"DEBUG ERROR: {response.text}")
                raise HTTPException(status_code=response.status_code, detail=f"OpenRouter error: {response.text}")

            data = response.json()
            raw_content = data['choices'][0]['message']['content']
            print(f"DEBUG: Raw AI Output length: {len(raw_content)}")

            # Robust extraction logic
            cleaned = raw_content.strip()
            if '```' in cleaned:
                match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', cleaned)
                if match:
                    cleaned = match.group(1).strip()

            try:
                highlights = json.loads(cleaned)
                if not isinstance(highlights, list):
                    highlights = []
            except (json.JSONDecodeError, ValueError):
                highlights = re.findall(r'"([^"]{10,})"', cleaned)
                if not highlights:
                    highlights = [line.strip('"-* 123456789. ') for line in re.split(r'\. |\n', cleaned) if len(line.strip()) > 15]

            print(f"DEBUG: Final highlights count: {len(highlights)}")
            return {"highlights": json.dumps(highlights)}
        except Exception as e:
            print(f"DEBUG EXCEPTION: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/config")
async def update_config(data: dict = Body(...)):
    if data.get("password") != "6699":
        raise HTTPException(status_code=403, detail="Invalid password")

    new_config = {
        "api_key": data.get("api_key"),
        "model_name": data.get("model_name")
    }
    save_config(new_config)
    return {"status": "success"}

@app.get("/api/config")
async def get_config(password: str):
    if password != "6699":
        raise HTTPException(status_code=403, detail="Invalid password")
    return load_config()

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
