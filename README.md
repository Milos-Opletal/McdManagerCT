# McdManagerCT

Web application designed for McDonald's management verification analytics. Connects to the mymcd portal and extracts recent verification data, scores, and points, providing a streamlined, easily readable dashboard.

## Features
- **Concurrent API Fetching:** Quickly processes employee verifications through background threading.
- **Granular Filters:** Filter statistics by specific employee positions.
- **Date Range Masking:** View specific shifts or timeframes with absolute precision.
- **Password Protected:** Uses HTTP Basic Auth to block unauthorized access to the portal.

## Usage

### Local Testing
```bash
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
python app.py
```

### Docker
Make sure to copy `.env.example` to `.env` and fill it out. Also set `APP_PASSWORD` to lock the dashboard.
```bash
docker compose up -d
```
