from typing import List, Dict
from datetime import datetime


def _is_missed_dict(t: Dict) -> bool:
    if t.get("completed"):
        return False
    # If backend provided 'missed', trust it
    if "missed" in t:
        return bool(t.get("missed"))
    # Fallback: compare due_date to today if present
    due_date = (t.get("due_date") or "")[:10]
    if not due_date:
        return False
    try:
        today = datetime.utcnow().date().isoformat()
        return due_date < today
    except Exception:
        return False


def summarize_todos(todos: List[Dict]) -> str:
    if not todos:
        return "No tasks for today. Enjoy your free time!"

    completed = [t for t in todos if t.get("completed")]
    pending = [t for t in todos if not t.get("completed")]
    missed = [t for t in pending if _is_missed_dict(t)]

    top_titles = [t.get("title", "") for t in pending[:3] if t.get("title")]
    completed_count = len(completed)
    pending_count = len(pending)
    missed_count = len(missed)

    parts = []
    if pending_count:
        parts.append(f"Pending: {pending_count}")
    if missed_count:
        parts.append(f"Missed: {missed_count}")
    if top_titles:
        parts.append("Top focus: " + ", ".join(top_titles))
    if completed_count:
        parts.append(f"Completed: {completed_count}")

    return ". ".join(parts)





