import os
from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import httpx
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def read_index():
    return FileResponse('static/index.html')

class HighlightRequest(BaseModel):
    text: str

@app.post("/api/process-pdf")
async def process_pdf(request: HighlightRequest):
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OpenRouter API key not configured in environment variables.")

    prompt = f"""
    You are an expert study assistant. I will provide you with text extracted from a book.
    Your task is to identify the most important sentences that should be highlighted for study notes.
    Return ONLY a JSON list of strings, where each string is a sentence from the text that should be highlighted.
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
                    "model": "qwen/qwen-2.5-72b-instruct:free",
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)
