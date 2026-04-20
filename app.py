import os
from flask import Flask, render_template, jsonify, request, session, redirect, url_for
from dotenv import load_dotenv
from MyMcdAPI import MyMcdAPI
from datetime import datetime
from functools import wraps

load_dotenv()

app = Flask(__name__)

app.secret_key = os.getenv("SECRET_KEY", os.urandom(24).hex())

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

# In-memory cache
cache = {
    "verifications": [],
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
    return render_template("index.html")

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

if __name__ == "__main__":
    app.run(port=4335, debug=True)
