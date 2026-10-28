FROM postgres:18-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/backup
COPY requirements.txt /app/requirements.txt
RUN /opt/backup/bin/pip install --no-cache-dir -r /app/requirements.txt
COPY backup.py provision.py /app/
ENTRYPOINT []
CMD ["/opt/backup/bin/python", "/app/backup.py"]
