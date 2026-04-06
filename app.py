import os
import json
from fastapi import FastAPI, Request, HTTPException, Body
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import httpx
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

CONFIG_FILE = "config.json"

def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r") as f:
            return json.load(f)
    return {
        "api_key": os.getenv("OPENROUTER_API_KEY", ""),
        "model_name": "qwen/qwen-2.5-72b-instruct:free"
    }

def save_config(config):
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=4)

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
    current_config = load_config()
    api_key = current_config.get("api_key")
    model_name = current_config.get("model_name")

    if not api_key:
        raise HTTPException(status_code=500, detail="OpenRouter API key not configured. Please set it in the admin panel.")

    prompt = f"""
    You are an expert study assistant. I will provide you with text extracted from a book.
    Your task is to identify the most important sentences that should be highlighted for study notes.
    Return ONLY a JSON list of strings, where each string represent a sentence from the text that should be highlighted.
    Be selective: only highlight key definitions, main arguments, and crucial facts. Avoid common words or filler sentences.
    Do not add any explanations or other text.

    Text:
    {request.text[:4000]}
    """

    async with httpx.AsyncClient() as client:
        try:
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

            if response.status_code != 200:
                print(f"Error from OpenRouter: {response.text}")
                raise HTTPException(status_code=response.status_code, detail="Error from OpenRouter API")

            data = response.json()
            ai_message = data['choices'][0]['message']['content']

            # Basic cleanup in case AI adds markdown code blocks
            ai_message = ai_message.strip()
            if ai_message.startswith("```json"):
                ai_message = ai_message[7:]
            if ai_message.startswith("```"):
                ai_message = ai_message[3:]
            if ai_message.endswith("```"):
                ai_message = ai_message[:-3]

            return {"highlights": ai_message.strip()}
        except Exception as e:
            print(f"Exception: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))

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
