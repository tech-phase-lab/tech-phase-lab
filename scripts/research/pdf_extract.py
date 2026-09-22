"""Resource-limited PDF text extractor used by the research monitor."""
from io import BytesIO
import resource
import sys

from pypdf import PdfReader

MAX_BYTES = 12 * 1024 * 1024
MAX_EXTRACTED_CHARS = 160_000
MAX_PAGES = 400
MAX_ADDRESS_SPACE = 256 * 1024 * 1024
MAX_CPU_SECONDS = 15


def apply_limits():
    resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_SPACE, MAX_ADDRESS_SPACE))
    resource.setrlimit(resource.RLIMIT_CPU, (MAX_CPU_SECONDS, MAX_CPU_SECONDS))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_EXTRACTED_CHARS * 4, MAX_EXTRACTED_CHARS * 4))


def extract(content):
    reader = PdfReader(BytesIO(content), strict=False)
    if reader.is_encrypted:
        raise ValueError("encrypted")
    if len(reader.pages) > MAX_PAGES:
        raise ValueError("page-limit")
    lines, extracted_chars = [], 0
    for page in reader.pages:
        page_text = page.extract_text() or ""
        for value in page_text.splitlines():
            normalized = " ".join(value.split())
            if normalized:
                lines.append(normalized)
                extracted_chars += len(normalized) + 1
        if extracted_chars >= MAX_EXTRACTED_CHARS:
            break
    return "\n".join(lines)[:MAX_EXTRACTED_CHARS]


def main():
    apply_limits()
    content = sys.stdin.buffer.read(MAX_BYTES + 1)
    if not content or len(content) > MAX_BYTES or not content.startswith(b"%PDF-"):
        return 2
    try:
        extracted = extract(content)
    except Exception:
        return 2
    if not extracted:
        return 2
    sys.stdout.buffer.write(extracted.encode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
