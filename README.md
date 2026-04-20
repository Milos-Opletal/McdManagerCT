# McdManagerCT 🍔📊

![Status](https://img.shields.io/badge/Status-Active-success)
![Python](https://img.shields.io/badge/Python-3.11+-blue.svg)
![Flask](https://img.shields.io/badge/Flask-Web%20Framework-black)
![Docker](https://img.shields.io/badge/Docker-Supported-2496ED)

**McdManagerCT** is a robust web application tailored for McDonald's management. It provides a sleek, password-protected analytics dashboard that automatically synchronizes with the internal McDonald's portal to extract crucial verification data, staff scores, and detailed performance metrics.

---

## ✨ Features

- **Blazing Fast Sync:** Leverages concurrent background threading to fetch employee data rapidly.
- **Granular Position Filters:** Quickly view and filter metrics by specific restaurant positions.
- **Precise Date Filtering:** Isolate evaluation data by selecting exact calendar dates.
- **Secure Access:** Built-in form-based authentication ensures your restaurant's data is only accessible to authorized personnel.
- **Containerized:** Fully Dockerized out-of-the-box, using `gunicorn` for a production-ready application server.

---

## 🛠️ Installation & Setup

### Prerequisites
- Python 3.11+
- Docker & Docker Compose (optional, for containerized deployments)

### Environment Setup

Before running the application, you must define the necessary credentials in a `.env` file at the root of the project.

```env
# Credentials for the internal McDonald's API
MYMCD_EMAIL=your_mymcd_login_email@example.com
MYMCD_PASSWORD=your_mymcd_password

# Authentication password to log into this web dashboard
APP_PASSWORD=your_secure_dashboard_password
```

### 🐳 Running with Docker (Recommended)

McdManagerCT is bundled with a production-ready `docker-compose.yml` that mounts the app and routes it using the lightweight `gunicorn` HTTP server.

1. Create and populate your `.env` file.
2. Build and launch the container:
   ```bash
   docker compose up -d --build
   ```
3. The dashboard will be accessible at `http://localhost:4335`.

*Note: The included docker-compose configuration utilizes an external `nginx_default` network. Ensure you adjust it if your reverse-proxy setup differs.*

### 💻 Running Locally without Docker

If you prefer to run the application natively for development or testing:

1. Setup a virtual environment:
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # Windows: .venv\Scripts\activate
   ```
2. Install the necessary dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Run the Flask development server:
   ```bash
   python app.py
   ```
4. Access the web interface at `http://localhost:4335`.

---

## 🔒 Security Note
Do not commit your `.env` file to source control. The `.gitignore` is pre-configured to ignore environment variables, ensuring your management accounts and session passwords stay completely secure.
