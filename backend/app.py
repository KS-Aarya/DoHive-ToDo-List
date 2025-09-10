from datetime import timedelta
import os

from flask import Flask, jsonify, g
from flask_cors import CORS
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, scoped_session

from models import Base
from models.user import User  # ensure model is registered before create_all
from models.todo import Todo  # ensure model is registered before create_all

def create_app():
    app = Flask(__name__)

    # Config
    app.config["SECRET_KEY"] = os.environ.get("JWT_SECRET", "change-me-in-prod")
    app.config["DATABASE_URL"] = os.environ.get("DATABASE_URL", "sqlite:///dohive.db")
    app.config["JWT_EXPIRES_MINUTES"] = int(os.environ.get("JWT_EXPIRES_MINUTES", "60"))

    # Enable CORS
    CORS(app)

    # Initialize SQLAlchemy (SQLite by default)
    engine = create_engine(app.config["DATABASE_URL"], echo=False, future=True)
    Base.metadata.create_all(engine)

    # Lightweight migration: ensure new columns exist if DB was created earlier
    with engine.connect() as conn:
        try:
            res = conn.exec_driver_sql("PRAGMA table_info('todos')")
            cols = {row[1] for row in res}  # row[1] is column name
            if "due_time" not in cols:
                conn.exec_driver_sql("ALTER TABLE todos ADD COLUMN due_time VARCHAR(16)")
        except Exception:
            # Safe to ignore; app will still start, and errors will surface in logs
            pass
    SessionLocal = scoped_session(sessionmaker(bind=engine, autoflush=False, autocommit=False))

    @app.before_request
    def create_session():
        g.db = SessionLocal()

    @app.teardown_request
    def shutdown_session(exception=None):
        db_session = getattr(g, "db", None)
        if db_session is not None:
            if exception:
                db_session.rollback()
            db_session.close()

    # Health check
    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok", "database": app.config["DATABASE_URL"]})

    # Blueprints
    from routes.auth_routes import auth_bp
    from routes.todo_routes import todo_bp

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(todo_bp, url_prefix="/api/todos")

    return app

if __name__ == "__main__":
    application = create_app()
    application.run(host="0.0.0.0", port=5000, debug=True)
