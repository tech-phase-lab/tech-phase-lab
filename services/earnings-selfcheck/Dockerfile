FROM python:3.12-slim
WORKDIR /app
# Same parser inputs as the monitor: its providers list and its pinned requirements (pypdf), so the check reads PDFs the way production does.
COPY lib/research/providers.json lib/research/providers.json
COPY lib/research/calendar-coverage.json lib/research/calendar-coverage.json
COPY scripts/research/requirements.txt scripts/research/requirements.txt
RUN pip install --no-cache-dir -r scripts/research/requirements.txt
COPY scripts/research scripts/research
RUN useradd --create-home --uid 10001 check
USER check
ENV PYTHONUNBUFFERED=1
# Inert unless EARNINGS_SELFCHECK=true is set on the (cron) service; otherwise both checks print DISABLED and exit 0. Read-only: it never writes.
# Nov 20: the same daily run also does the production watch (scripts/research/production_watch.py, docs/PRODUCTION-WATCH.md).
RUN python scripts/research/daily_checks.py
CMD ["timeout", "--signal=TERM", "--kill-after=10s", "900s", "python", "scripts/research/daily_checks.py"]
