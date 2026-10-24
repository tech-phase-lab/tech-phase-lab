FROM python:3.12-slim

WORKDIR /app
COPY services/tech-phase-backup/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --gid 10001 researchbackup \
    && useradd --create-home --uid 10001 --gid 10001 researchbackup \
    && mkdir -p /app/tests

COPY scripts/research/persistence.py scripts/research/persistence.py
COPY scripts/tech-phase/external_research_backup.py scripts/tech-phase/external_research_backup.py

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TECH_PHASE_EXTERNAL_BACKUP_ENABLED=false

USER 10001:10001
CMD ["python", "scripts/tech-phase/external_research_backup.py"]
