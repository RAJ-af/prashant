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
    # Fallback prompt if file not found
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
    print("DEBUG: Received request for /api/process-pdf")
    current_config = load_config()
    api_key = current_config.get("api_key")
    model_name = current_config.get("model_name")

    if not api_key:
        print("DEBUG ERROR: API key is missing in config.json")
        raise HTTPException(status_code=500, detail="OpenRouter API key not configured. Please set it in the admin panel.")

    prompt_template = load_prompt()
    prompt = prompt_template.format(text=request.text[:4000])

    async with httpx.AsyncClient() as client:
        try:
            print(f"DEBUG: Sending request to OpenRouter with model {model_name}")
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
                timeout=60.0
            )

            print(f"DEBUG: OpenRouter status code: {response.status_code}")
            if response.status_code != 200:
                print(f"DEBUG ERROR from OpenRouter: {response.text}")
                raise HTTPException(status_code=response.status_code, detail=f"OpenRouter API error: {response.text}")

            data = response.json()
            raw_ai_message = data['choices'][0]['message']['content']
            print(f"DEBUG: Raw AI Response: {raw_ai_message}")

            # Robust JSON cleaning and extraction
            cleaned_message = raw_ai_message.strip()

            # Remove markdown code blocks if present
            if "```" in cleaned_message:
                match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned_message)
                if match:
                    cleaned_message = match.group(1).strip()

            highlights_list = []
            try:
                # Try strict JSON parsing
                highlights_list = json.loads(cleaned_message)
                if not isinstance(highlights_list, list):
                    # If it's a JSON object but not a list, it's unexpected
                    raise ValueError("JSON response is not a list")
                print("DEBUG: Successfully parsed JSON list")
            except (json.JSONDecodeError, ValueError) as e:
                print(f"DEBUG ERROR: JSON parsing failed ({e}). Attempting robust extraction...")

                # Fallback: Extract strings between quotes or lines
                # Pattern to match anything inside double quotes that is at least 10 chars
                fallback_matches = re.findall(r'"([^"]{10,})"', cleaned_message)
                if fallback_matches:
                    highlights_list = fallback_matches
                    print(f"DEBUG: Extracted {len(highlights_list)} sentences using quote extraction")
                else:
                    # Last resort: Split by lines and clean numbering
                    lines = cleaned_message.split('\n')
                    for line in lines:
                        clean_line = re.sub(r'^[-\d.\s\*]+', '', line).strip()
                        if len(clean_line) > 10:
                            highlights_list.append(clean_line)
                    print(f"DEBUG: Extracted {len(highlights_list)} sentences using line split")

            return {"highlights": json.dumps(highlights_list)}
        except Exception as e:
            print(f"DEBUG EXCEPTION: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")

@app.post("/api/config")
async def update_config(data: dict = Body(...)):
    password = data.get("password")
    if password != "6699":
        raise HTTPException(status_code=403, detail="Invalid password")

    new_config = {
        "api_key": data.get("api_key"),
        "model_name": data.get("model_name")
    }
    save_config(new_config)
    print("DEBUG: Config updated via /admin")
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
