FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Copy requirements file first to leverage Docker cache
COPY requirements.txt .

# Install Python dependencies plus gunicorn for production
RUN pip install --no-cache-dir -r requirements.txt gunicorn

# Set environment variables
ENV PYTHONUNBUFFERED=1

# Copy application files
COPY . .

# Expose the application port
EXPOSE 4335
