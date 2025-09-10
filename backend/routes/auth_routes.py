import datetime
import bcrypt
import jwt
from flask import Blueprint, current_app, jsonify, request, g

from models.user import User

auth_bp = Blueprint("auth", __name__)


def generate_token(user_id: str):
    payload = {
        "sub": user_id,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(minutes=current_app.config["JWT_EXPIRES_MINUTES"])
    }
    return jwt.encode(payload, current_app.config["SECRET_KEY"], algorithm="HS256")


def require_auth(fn):
    from functools import wraps

    @wraps(fn)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return jsonify({"error": "Missing token"}), 401
        token = header.split(" ", 1)[1]
        try:
            payload = jwt.decode(token, current_app.config["SECRET_KEY"], algorithms=["HS256"])
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Invalid token"}), 401
        request.user_id = str(payload.get("sub"))
        return fn(*args, **kwargs)

    return wrapper


@auth_bp.post("/signup")
def signup():
    body = request.get_json(force=True) or {}
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    name = (body.get("name") or "").strip()

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    session = g.db
    existing = session.query(User).filter(User.email == email).first()
    if existing:
        return jsonify({"error": "Email already registered"}), 409

    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode()
    user = User(email=email, name=name, password_hash=password_hash)
    session.add(user)
    session.commit()

    token = generate_token(str(user.id))
    return jsonify({"token": token, "user": {"id": str(user.id), "email": user.email, "name": user.name}})


@auth_bp.post("/login")
def login():
    body = request.get_json(force=True) or {}
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    session = g.db
    user = session.query(User).filter(User.email == email).first()
    if not user or not bcrypt.checkpw(password.encode("utf-8"), user.password_hash.encode("utf-8")):
        return jsonify({"error": "Invalid credentials"}), 401

    token = generate_token(str(user.id))
    return jsonify({"token": token, "user": {"id": str(user.id), "email": user.email, "name": user.name}})
