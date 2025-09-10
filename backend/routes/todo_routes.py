from datetime import datetime, timedelta
from typing import List

from flask import Blueprint, jsonify, request, g

from routes.auth_routes import require_auth
from utils.summarizer import summarize_todos
from models.todo import Todo


todo_bp = Blueprint("todos", __name__)


def _normalize_date_str(value):
    if not value:
        return None
    # Accept 'YYYY-MM-DD' or ISO datetime; always return 'YYYY-MM-DD'
    try:
        s = str(value).strip()
        if len(s) >= 10:
            core = s[:10]
            # Handle dd/mm/yyyy or dd-mm-yyyy and convert to yyyy-mm-dd
            if ("/" in core or "-" in core) and core[2] in "-/" and core[5] in "-/":
                sep = core[2]
                d, m, y = core.split(sep)
                if len(y) == 4:
                    return f"{y}-{m.zfill(2)}-{d.zfill(2)}"
            # Assume it's already yyyy-mm-dd
            return core
        return None
    except Exception:
        return None


def _normalize_time_str(value):
    if not value:
        return None


def _is_missed(todo: Todo) -> bool:
    def parse_any(date_str: str):
        if not date_str:
            return None
        s = str(date_str).strip()
        try:
            # yyyy-mm-dd
            if len(s) >= 10 and s[4] == '-' and s[7] == '-':
                return datetime(int(s[0:4]), int(s[5:7]), int(s[8:10]))
            # dd/mm/yyyy or dd-mm-yyyy
            if len(s) >= 10 and s[2] in '-/' and s[5] in '-/':
                d, m, y = s[:10].split(s[2])
                return datetime(int(y), int(m), int(d))
        except Exception:
            return None
        return None

    try:
        if todo.completed:
            return False
        due_dt = parse_any(todo.due_date)
        if not due_dt:
            return False
        today = datetime.utcnow()
        today_midnight = datetime(today.year, today.month, today.day)
        return due_dt < today_midnight
    except Exception:
        return False
    # Expect 'HH:MM' or 'HH:MM:SS'; return 'HH:MM'
    try:
        s = str(value)
        return s[:5]
    except Exception:
        return None


@todo_bp.get("")
@require_auth
def list_todos():
    session = g.db
    user_id = int(request.user_id)
    items = (
        session.query(Todo)
        .filter(Todo.user_id == user_id)
        .order_by(Todo.created_at.desc())
        .all()
    )
    docs = [
        {
            "id": str(t.id),
            "user_id": str(t.user_id),
            "title": t.title,
            "description": t.description,
            "completed": t.completed,
            "due_date": t.due_date,
            "due_time": t.due_time,
            "created_at": t.created_at.isoformat(),
            "updated_at": t.updated_at.isoformat() if t.updated_at else None,
            "missed": _is_missed(t),
        }
        for t in items
    ]
    return jsonify(docs)


@todo_bp.post("")
@require_auth
def create_todo():
    session = g.db
    user_id = int(request.user_id)
    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "").strip()
    description = (body.get("description") or "").strip()
    due_date = _normalize_date_str(body.get("due_date"))  # ISO string or None
    due_time = _normalize_time_str(body.get("due_time"))

    if not title:
        return jsonify({"error": "Title is required"}), 400

    todo = Todo(
        user_id=user_id,
        title=title,
        description=description,
        completed=False,
        due_date=due_date,
        due_time=due_time,
    )
    session.add(todo)
    session.commit()

    doc = {
        "id": str(todo.id),
        "user_id": str(todo.user_id),
        "title": todo.title,
        "description": todo.description,
        "completed": todo.completed,
        "due_date": todo.due_date,
        "due_time": todo.due_time,
        "created_at": todo.created_at.isoformat(),
        "updated_at": todo.updated_at.isoformat() if todo.updated_at else None,
        "missed": _is_missed(todo),
    }
    return jsonify(doc), 201


@todo_bp.put("/<todo_id>")
@require_auth
def update_todo(todo_id: str):
    session = g.db
    user_id = int(request.user_id)
    body = request.get_json(silent=True) or {}
    updates = {k: v for k, v in body.items() if k in {"title", "description", "completed", "due_date", "due_time"}}
    if not updates:
        return jsonify({"error": "No fields to update"}), 400

    todo = session.query(Todo).filter(Todo.id == int(todo_id), Todo.user_id == user_id).first()
    if not todo:
        return jsonify({"error": "Not found"}), 404

    for k, v in updates.items():
        if k == "due_date":
            setattr(todo, k, _normalize_date_str(v))
        elif k == "due_time":
            setattr(todo, k, _normalize_time_str(v))
        else:
            setattr(todo, k, v)
    session.commit()

    result = {
        "id": str(todo.id),
        "user_id": str(todo.user_id),
        "title": todo.title,
        "description": todo.description,
        "completed": todo.completed,
        "due_date": todo.due_date,
        "due_time": todo.due_time,
        "created_at": todo.created_at.isoformat(),
        "updated_at": todo.updated_at.isoformat() if todo.updated_at else None,
        "missed": _is_missed(todo),
    }
    return jsonify(result)


@todo_bp.delete("/<todo_id>")
@require_auth
def delete_todo(todo_id: str):
    session = g.db
    user_id = int(request.user_id)
    todo = session.query(Todo).filter(Todo.id == int(todo_id), Todo.user_id == user_id).first()
    if not todo:
        return ("", 204)
    session.delete(todo)
    session.commit()
    return ("", 204)


@todo_bp.get("/summary/today")
@require_auth
def summary_today():
    session = g.db
    user_id = int(request.user_id)
    start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    items = (
        session.query(Todo)
        .filter(Todo.user_id == user_id, Todo.created_at >= start, Todo.created_at < end)
        .all()
    )
    docs = [
        {
            "id": str(t.id),
            "title": t.title,
            "description": t.description,
            "completed": t.completed,
            "due_date": t.due_date,
            "due_time": t.due_time,
            "created_at": t.created_at.isoformat(),
            "missed": _is_missed(t),
        }
        for t in items
    ]
    summary = summarize_todos(docs)
    return jsonify({"summary": summary, "count": len(docs)})


@todo_bp.get("/date/<date_str>")
@require_auth
def todos_by_date(date_str: str):
    session = g.db
    user_id = int(request.user_id)
    items = (
        session.query(Todo)
        .filter(Todo.user_id == user_id)
        .all()
    )
    def is_match(t: Todo):
        d = (t.due_date or t.created_at.date().isoformat())[:10]
        return d == date_str[:10]
    filtered = [t for t in items if is_match(t)]
    docs = [
        {
            "id": str(t.id),
            "title": t.title,
            "description": t.description,
            "completed": t.completed,
            "due_date": t.due_date,
            "due_time": t.due_time,
            "created_at": t.created_at.isoformat(),
            "missed": _is_missed(t),
        }
        for t in filtered
    ]
    return jsonify(docs)


@todo_bp.get("/range/<start>/<end>")
@require_auth
def todos_by_date_range(start: str, end: str):
    session = g.db
    user_id = int(request.user_id)
    items = (
        session.query(Todo)
        .filter(Todo.user_id == user_id)
        .all()
    )
    def in_range(t: Todo):
        d = (t.due_date or t.created_at.date().isoformat())[:10]
        return d >= start[:10] and d <= end[:10]
    filtered = [t for t in items if in_range(t)]
    docs = [
        {
            "id": str(t.id),
            "title": t.title,
            "description": t.description,
            "completed": t.completed,
            "due_date": t.due_date,
            "due_time": t.due_time,
            "created_at": t.created_at.isoformat(),
            "missed": _is_missed(t),
        }
        for t in filtered
    ]
    return jsonify(docs)





