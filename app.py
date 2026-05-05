import os
import json
from pathlib import Path
from flask import Flask, render_template, jsonify, request, session, redirect, url_for
from dotenv import load_dotenv
from MyMcdAPI import MyMcdAPI
from datetime import datetime
from functools import wraps

load_dotenv()

app = Flask(__name__)

app.secret_key = os.urandom(24).hex()

def requires_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        app_pass = os.getenv("APP_PASSWORD")
        if not app_pass:
            return f(*args, **kwargs) # Allowed by default if no password set
            
        if not session.get('logged_in'):
            if request.path.startswith('/api/'):
                return jsonify({"error": "Unauthorized"}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated

@app.route("/login", methods=["GET", "POST"])
def login():
    app_pass = os.getenv("APP_PASSWORD")
    if not app_pass:
        return redirect(url_for('index'))
        
    error = None
    if request.method == "POST":
        if request.form.get("password") == app_pass:
            session['logged_in'] = True
            return redirect(url_for('index'))
        else:
            error = "Nesprávné heslo."
            
    return render_template("login.html", error=error)

@app.route("/logout")
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login'))

# Persistence for tables
DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)
TABLES_DATA_FILE = DATA_DIR / "app_data.json"

def get_tables_data():
    if TABLES_DATA_FILE.exists():
        try:
            with open(TABLES_DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"cells": {}, "hidden": [], "nocni": []}

def save_tables_data(data):
    with open(TABLES_DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

# In-memory cache
cache = {
    "verifications": [],
    "employees": [],
    "last_sync": None,
    "is_syncing": False
}

def sync_data():
    cache["is_syncing"] = True
    try:
        user = os.getenv("MYMCD_EMAIL")
        password = os.getenv("MYMCD_PASSWORD")
        
        print("Starting API login...")
        api = MyMcdAPI(user, password)
        api.login()
        
        print("Fetching verifications for all employees...")
        # get_all_employees_verification_summaries defaults to rate_limit=0.15s, include_unverified=False
        data = api.get_all_employees_verification_summaries(include_unverified=False)
        
        cache["verifications"] = data
        cache["last_sync"] = datetime.now().isoformat()
        print(f"Sync complete. Found {len(data)} completed verifications.")
    except Exception as e:
        print(f"Sync error: {e}")
        # In a robust app, we'd persist the error to send back to the client.
    finally:
        cache["is_syncing"] = False

@app.route("/")
@requires_auth
def index():
    return render_template("dashboard.html")

@app.route("/log")
@requires_auth
def log_view():
    return render_template("log.html")

@app.route("/tables")
@requires_auth
def tables():
    return render_template("tables.html")

@app.route("/api/employees_raw")
@requires_auth
def employees_raw():
    if not cache.get("employees"):
        user = os.getenv("MYMCD_EMAIL")
        password = os.getenv("MYMCD_PASSWORD")
        api = MyMcdAPI(user, password)
        api.login()
        cache["employees"] = api._get_all_employees()
    return jsonify(cache["employees"])

@app.route("/api/tables_data", methods=["GET", "POST"])
@requires_auth
def tables_data():
    if request.method == "POST":
        data = request.json
        save_tables_data(data)
        return jsonify({"status": "ok"})
    return jsonify(get_tables_data())

@app.route("/api/data")
@requires_auth
def get_data():
    return jsonify({
        "verifications": cache["verifications"],
        "last_sync": cache["last_sync"],
        "is_syncing": cache["is_syncing"]
    })

@app.route("/api/sync", methods=["POST"])
@requires_auth
def trigger_sync():
    # If a sync is already running, we won't trigger another one concurrently,
    # but since this blocks, we'll just wait for ours to finish.
    if not cache["is_syncing"]:
        sync_data()
    
    return jsonify({
        "verifications": cache["verifications"],
        "last_sync": cache["last_sync"],
        "is_syncing": cache["is_syncing"]
    })

@app.route("/api/sync_verifications", methods=["POST"])
@requires_auth
def sync_verifications():
    """Fetch per-employee verified verification names for auto-fill on tables."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    user = os.getenv("MYMCD_EMAIL")
    password = os.getenv("MYMCD_PASSWORD")
    api = MyMcdAPI(user, password)
    api.login()

    # Get all CT-level employees
    all_emps = cache.get("employees") or api._get_all_employees()
    cache["employees"] = all_emps

    # Only Crew (2), Crew v tréninku (1), and LPOH (16) have these verifications
    sync_emps = [e for e in all_emps if e.get("positionId") in (1, 2, 16)]

    result = {}  # { employee_id: [list of verified verification names] }

    def process_emp(emp):
        emp_id = emp["id"]
        emp_name = f"{emp.get('surname', '')} {emp.get('name', '')}".strip()
        try:
            profile = api.get_profile_verifications(emp_id)
            verified_names = []
            for v in profile.get("verifications", []):
                if v.get("is_verified"):
                    verified_names.append(v.get("name", ""))
            return emp_id, verified_names
        except Exception as e:
            print(f"  [WARN] Error fetching verifications for {emp_name} ({emp_id}): {e}")
            return emp_id, []

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(process_emp, emp) for emp in sync_emps]
        for future in as_completed(futures):
            try:
                emp_id, names = future.result()
                if names:
                    result[str(emp_id)] = names
            except Exception as e:
                print(f"  [WARN] Future failed: {e}")

    return jsonify(result)


if __name__ == "__main__":
    app.run(port=4335, debug=True)
