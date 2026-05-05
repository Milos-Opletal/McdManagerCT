import os
import json
import calendar
from pathlib import Path
from flask import Flask, render_template, jsonify, request, session, redirect, url_for
from dotenv import load_dotenv
from MyMcdAPI import MyMcdAPI
from datetime import datetime, date
from functools import wraps
from concurrent.futures import ThreadPoolExecutor, as_completed

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
        # rate_limit=0 for max speed – concurrent workers handle API load
        data = api.get_all_employees_verification_summaries(include_unverified=False, rate_limit=0)
        
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

@app.route("/ct-performance")
@requires_auth
def ct_performance():
    return render_template("ct_performance.html")

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

    with ThreadPoolExecutor(max_workers=12) as executor:
        futures = [executor.submit(process_emp, emp) for emp in sync_emps]
        for future in as_completed(futures):
            try:
                emp_id, names = future.result()
                if names:
                    result[str(emp_id)] = names
            except Exception as e:
                print(f"  [WARN] Future failed: {e}")

    return jsonify(result)


@app.route("/api/ct_performance", methods=["POST"])
@requires_auth
def api_ct_performance():
    """
    Fetch CT performance data for a given month.
    Optimised: uses get_restaurant_shifts (1 call) + lean verification scan.
    Returns each CT's shift count, worked hours, verification count, and percentage.
    """
    payload = request.json or {}
    now = datetime.now()
    year = payload.get("year", now.year)
    month = payload.get("month", now.month)

    user = os.getenv("MYMCD_EMAIL")
    password = os.getenv("MYMCD_PASSWORD")
    api = MyMcdAPI(user, password)
    api.login()

    # 1. Get all employees and filter to CTs (position IDs 5 and 6)
    all_emps = api._get_all_employees()
    ct_emps = [e for e in all_emps if e.get("positionId") in (5, 6)]
    cache["employees"] = all_emps

    if not ct_emps:
        return jsonify({"performers": []})

    # 2. Date range
    last_day = calendar.monthrange(year, month)[1]
    if year == now.year and month == now.month:
        last_day = min(last_day, now.day)
    from_date = f"{year}-{month:02d}-01"
    to_date = f"{year}-{month:02d}-{last_day:02d}"

    ct_ids_set = set(ct["id"] for ct in ct_emps)

    # 3. FAST: Get all shifts from restaurant endpoint (1 API call instead of 10)
    print("[CT Perf] Fetching restaurant shifts (single call)...")
    rest_shifts = api.get_restaurant_shifts(from_date, to_date)
    shift_counts = {}
    for emp_entry in rest_shifts.get("internalEmployees", []):
        eid = emp_entry.get("employeeId")
        if eid not in ct_ids_set:
            continue
        plans = emp_entry.get("shiftPlans", [])
        valid = [s for s in plans if not s.get("isCancellation") and s.get("date", "") <= to_date]
        shift_counts[eid] = len(valid)

    # 4. Fetch worked hours stats (1 API call)
    print("[CT Perf] Fetching shift stats...")
    ct_ids = list(ct_ids_set)
    shift_stats = api.get_employee_shift_stats(year, month, ct_ids)
    stats_map = {s["employeeId"]: s for s in shift_stats}

    # 5. Count verifications done BY each CT this month
    # Build name map and reverse lookup
    ct_name_map = {}  # id -> "Name Surname"
    ct_reverse_lookup = {}  # "Surname Name" -> id (for matching verified_by)
    for ct in ct_emps:
        name = f"{ct.get('name', '')} {ct.get('surname', '')}".strip()
        ct_name_map[ct["id"]] = name
        # Build reversed name for lookup
        parts = name.split()
        if len(parts) >= 2:
            reversed_name = f"{parts[-1]} {' '.join(parts[:-1])}"
            ct_reverse_lookup[reversed_name.strip()] = ct["id"]
        ct_reverse_lookup[name.strip()] = ct["id"]

    ct_verif_counts = {ct["id"]: 0 for ct in ct_emps}

    # Try cached verification data first (instant if available)
    verif_data = cache.get("verifications", [])
    if verif_data:
        print(f"[CT Perf] Using cached verification data ({len(verif_data)} entries)")
        for v in verif_data:
            vb = (v.get("verified_by") or "").strip()
            vd = v.get("verification_date", "")
            if not vb or not vd:
                continue
            try:
                vdate = datetime.strptime(vd[:10], "%Y-%m-%d")
                if vdate.year != year or vdate.month != month:
                    continue
            except (ValueError, TypeError):
                continue
            ct_id = ct_reverse_lookup.get(vb)
            if ct_id is not None:
                ct_verif_counts[ct_id] += 1
    else:
        # Lean scan: only check verifiable employees, only fetch attempts for this month
        MANAGER_POS = {8, 9, 10, 11, 13}
        CT_POS = {5, 6}
        scan_emps = [e for e in all_emps if e.get("positionId") not in MANAGER_POS
                     and e.get("positionId") not in CT_POS]
        print(f"[CT Perf] Lean scan: checking {len(scan_emps)} employees for this month's verifications...")

        def check_employee_verifs(emp):
            """Check one employee for verifications done this month, return verifier names."""
            emp_id = emp["id"]
            results = []
            try:
                profile = api.get_profile_verifications(emp_id)
                for v in profile.get("verifications", []):
                    if not v.get("is_verified"):
                        continue
                    last_date = v.get("last_verification_date")
                    if not last_date:
                        continue
                    # Quick month check before expensive attempt fetch
                    try:
                        if "." in last_date:
                            parts = last_date.split(".")
                            if len(parts) == 3:
                                d_month, d_year = int(parts[1]), int(parts[2])
                            else:
                                continue
                        else:
                            d_month = int(last_date[5:7])
                            d_year = int(last_date[0:4])
                        if d_year != year or d_month != month:
                            continue
                    except (ValueError, IndexError):
                        continue
                    # Fetch attempt details for this-month verification
                    attempt_id = v.get("attempt_id")
                    if attempt_id:
                        try:
                            attempt = api.get_verification_attempt(attempt_id)
                            created_by = (attempt.get("createdBy") or "").strip()
                            if created_by:
                                results.append(created_by)
                        except Exception:
                            pass
            except Exception:
                pass
            return results

        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(check_employee_verifs, emp) for emp in scan_emps]
            for future in as_completed(futures):
                for verifier_name in future.result():
                    ct_id = ct_reverse_lookup.get(verifier_name)
                    if ct_id is not None:
                        ct_verif_counts[ct_id] += 1

    # 6. Build result
    performers = []
    for ct in ct_emps:
        ct_id = ct["id"]
        name = ct_name_map[ct_id]
        shifts = shift_counts.get(ct_id, 0)
        verifs = ct_verif_counts.get(ct_id, 0)
        worked_hours = stats_map.get(ct_id, {}).get("workedHours", 0)
        pct = (verifs / shifts * 100) if shifts > 0 else 0.0

        performers.append({
            "id": ct_id,
            "name": name,
            "shifts": shifts,
            "worked_hours": worked_hours,
            "verifications": verifs,
            "percentage": round(pct, 1)
        })

    return jsonify({"performers": performers})

@app.route("/expiring")
@requires_auth
def expiring_page():
    return render_template("expiring.html")

@app.route("/api/expiring_verifications", methods=["POST"])
@requires_auth
def api_expiring_verifications():
    payload = request.json or {}
    to_date = payload.get("to_date")
    
    if not to_date:
        today = date.today()
        next_month = today.month % 12 + 1
        next_month_year = today.year + (1 if today.month == 12 else 0)
        _, last_day = calendar.monthrange(next_month_year, next_month)
        to_date = date(next_month_year, next_month, last_day).strftime("%Y-%m-%d")

    from_date = date.today().strftime("%Y-%m-%d")
    
    user = os.getenv("MYMCD_EMAIL")
    password = os.getenv("MYMCD_PASSWORD")
    api = MyMcdAPI(user, password)
    api.login()

    all_emps = cache.get("employees")
    if not all_emps:
        all_emps = api._get_all_employees()
        cache["employees"] = all_emps
    
    emp_ids = [e["id"] for e in all_emps]
    emp_map = {e["id"]: f"{e.get('name', '')} {e.get('surname', '')}".strip() for e in all_emps}
    
    # Get verification names
    codes = api.get_default_codes()
    verif_map = {}
    if "verifications" in codes:
        for v in codes["verifications"]:
            verif_map[v["id"]] = v.get("name", {}).get("cs") or v.get("name", {}).get("sk", "Unknown")

    # Fetch expiring
    try:
        expiring_data = api.get_expiring_verifications(from_date, to_date, emp_ids)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    results = []
    
    # Check verification status for the employees that actually have expiring verifs
    emps_to_check = list(expiring_data.keys()) if isinstance(expiring_data, dict) else []
    
    status_map = {} # {emp_id: {verif_id: is_verified}}
    
    def check_emp_status(emp_id):
        try:
            profile = api.get_profile_verifications(int(emp_id))
            status = {}
            for v in profile.get("verifications", []):
                v_id = v.get("id")
                status[v_id] = v.get("is_verified", False)
            return emp_id, status
        except:
            return emp_id, {}

    from concurrent.futures import ThreadPoolExecutor, as_completed
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(check_emp_status, emp_id) for emp_id in emps_to_check]
        for future in as_completed(futures):
            eid, st = future.result()
            status_map[eid] = st

    if isinstance(expiring_data, dict):
        for str_emp_id, exp_list in expiring_data.items():
            emp_id = int(str_emp_id)
            emp_name = emp_map.get(emp_id, f"Unknown ({emp_id})")
            emp_statuses = status_map.get(str_emp_id, {})
            
            for item in exp_list:
                v_id = item.get("verificationId")
                v_name = verif_map.get(v_id, f"Verification ID {v_id}")
                date_to = item.get("dateTo", "")
                is_verified = emp_statuses.get(v_id, False)
                
                results.append({
                    "employee_id": emp_id,
                    "employee_name": emp_name,
                    "verification_name": v_name,
                    "date_to": date_to,
                    "is_verified": is_verified
                })
                
    # Sort by closest expiration date
    results.sort(key=lambda x: x["date_to"])

    return jsonify({"expiring": results, "to_date": to_date})


if __name__ == "__main__":
    app.run(port=4335, debug=True)
