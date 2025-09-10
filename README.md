DoHive - AngularJS + Flask + MongoDB Todo app with daily AI summary

Prerequisites
- Python 3.10+
- MongoDB running locally (defaults to mongodb://localhost:27017/dohive)

Backend setup (Windows PowerShell)
```
cd backend
python -m venv .venv
. .venv/Scripts/Activate.ps1
pip install -r requirements.txt
$env:MONGO_URI="mongodb://localhost:27017/dohive"  # optional
$env:JWT_SECRET="your-secret"  # optional
python app.py
```

API base: http://localhost:5000/api

Frontend
- Open frontend/login.html, frontend/signup.html, or frontend/main.html in your browser
- Optionally set API base: in DevTools console run: `window.API_BASE = 'http://127.0.0.1:5000'`

Key endpoints
- GET /api/health
- POST /api/auth/signup { name, email, password }
- POST /api/auth/login { email, password }
- CRUD /api/todos
- GET /api/todos/summary/today

Summary logic
- See backend/utils/summarizer.py. Replace with an LLM call if desired.






