"""تبدیل فایل ورودی (PDF / Word / متن) به Markdown و استخراج سرفصل‌ها.

هدف: تبدیل سند به Markdown تمیز پیش از ارسال به مدل، تا توکن کمتری مصرف شود.
"""

from __future__ import annotations

import re
from pathlib import Path

# پسوندهای پشتیبانی‌شده
SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".md", ".markdown", ".txt"]

# سرفصل‌هایی که به صورت # یا ## ... در Markdown مشخص شده‌اند
HEADING_RE = re.compile(r"^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$")
# سطرهای شماره‌دار مثل «۱.۲. مقدمه» یا «3-2 روش کار»
NUMBERED_RE = re.compile(r"^[\d۰-۹]+(?:[.\-–][\d۰-۹]+)*[.)\-–]?\s+\S.{0,80}$")
# کلیدواژه‌های رایج فصل‌بندی در متون فارسی
KEYWORD_RE = re.compile(
    r"^(فصل|بخش|پیوست|ضمیمه|مقدمه|پیشگفتار|چکیده|سرفصل|نتیجه\s*گیری|جمع\s*بندی|"
    r"فهرست|مراجع|منابع|نمایه|Abstract|Chapter|Part|Section|Introduction|Conclusion)\b.{0,80}$",
    re.IGNORECASE,
)

# حداکثر تعداد سرفصل‌های نمایش‌داده‌شده (برای جلوگیری از شلوغی رابط کاربری)
MAX_HEADINGS = 400


class FileReadError(RuntimeError):
    """خطا در خواندن یا تبدیل فایل ورودی."""


# -----------------------------------------------------------------------------
# کمکی‌های عمومی
# -----------------------------------------------------------------------------
def file_name(path) -> str:
    """نام فایل از مسیر (رشته یا آبجکت فایل Gradio)."""
    return Path(_as_path(path)).name


def _as_path(path) -> str:
    """مسیر فایل را از هر ورودی‌ای که Gradio بدهد (str یا TemporaryFileWrapper) استخراج می‌کند."""
    if isinstance(path, (str, bytes)) or hasattr(path, "__fspath__"):
        return str(path)
    return str(getattr(path, "name", path))


def read_text(path) -> str:
    """خواندن فایل متنی با چند انکودینگ رایج (utf-8، utf-8-sig، windows-1256 و ...)."""
    raw = Path(_as_path(path)).read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "cp1256", "windows-1252", "latin-1"):
        try:
            return raw.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", errors="ignore")


def estimate_tokens(text: str) -> int:
    """تخمین محافظه‌کارانه‌ی تعداد توکن (فارسی ~۲.۵ و انگلیسی ~۴ کاراکتر برای هر توکن)."""
    if not text:
        return 0
    return int(len(text) / 3) + 1


# -----------------------------------------------------------------------------
# تبدیل به Markdown
# -----------------------------------------------------------------------------
def to_markdown(path) -> str:
    """فایل ورودی را به Markdown تبدیل می‌کند."""
    resolved = Path(_as_path(path))
    if not resolved.exists():
        raise FileReadError(f"فایل پیدا نشد: {resolved}")
    ext = resolved.suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise FileReadError(
            f"پسوند «{ext}» پشتیبانی نمی‌شود. فرمت‌های مجاز: {', '.join(SUPPORTED_EXTENSIONS)}"
        )

    if ext == ".pdf":
        markdown = _pdf_to_markdown(resolved)
    elif ext == ".docx":
        markdown = _docx_to_markdown(resolved)
    elif ext in (".md", ".markdown"):
        markdown = read_text(resolved)
    else:
        markdown = _plain_to_markdown(read_text(resolved))

    markdown = normalize_markdown(markdown)
    if not markdown.strip():
        raise FileReadError(
            "متنی از فایل استخراج نشد. اگر PDF اسکن‌شده (تصویری) است، اول باید OCR شود."
        )
    return markdown


def _pdf_to_markdown(path: Path) -> str:
    """تبدیل PDF به Markdown؛ اول با pymupdf4llm و در صورت نبود، با PyMuPDF."""
    try:
        import pymupdf4llm  # type: ignore
    except ImportError:
        pymupdf4llm = None

    if pymupdf4llm is not None:
        try:
            return pymupdf4llm.to_markdown(str(path))
        except Exception:
            pass  # در صورت خطا، سراغ روش جایگزین می‌رویم

    return _pdf_to_markdown_fallback(path)


def _pdf_to_markdown_fallback(path: Path) -> str:
    """روش جایگزین: استخراج متن با PyMuPDF و حدس سطح سرفصل از اندازه‌ی فونت."""
    try:
        import fitz  # type: ignore  # PyMuPDF
    except ImportError as exc:
        raise FileReadError(
            "برای خواندن PDF باید یکی از بسته‌های «pymupdf4llm» یا «pymupdf» نصب باشد."
        ) from exc

    lines: list[str] = []
    with fitz.open(str(path)) as doc:
        body_size = _dominant_font_size(doc)
        for page in doc:
            for block in page.get_text("dict").get("blocks", []):
                if block.get("type") != 0:  # فقط بلوک‌های متنی
                    continue
                for line in block.get("lines", []):
                    spans = line.get("spans", [])
                    text = "".join(span.get("text", "") for span in spans).strip()
                    if not text:
                        continue
                    size = max((span.get("size", 0) for span in spans), default=0)
                    level = _heading_level(size, body_size)
                    lines.append(f"{'#' * level} {text}" if level else text)
            lines.append("")
    return "\n".join(lines)


def _dominant_font_size(doc, max_pages: int = 10) -> float:
    """پرتکرارترین اندازه‌ی فونت را به عنوان اندازه‌ی متن اصلی (body) برمی‌گرداند."""
    from collections import Counter

    counter: Counter = Counter()
    for index, page in enumerate(doc):
        if index >= max_pages:
            break
        for block in page.get_text("dict").get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span.get("text", "").strip()
                    if text:
                        counter[round(float(span.get("size", 0)) * 2) / 2] += len(text)
    if not counter:
        return 0.0
    return float(counter.most_common(1)[0][0])


def _heading_level(size: float, body_size: float) -> int:
    """تبدیل اندازه‌ی فونت به سطح سرفصل (۰ یعنی متن معمولی)."""
    if not body_size or size <= 0:
        return 0
    ratio = size / body_size
    if ratio >= 1.65:
        return 1
    if ratio >= 1.35:
        return 2
    if ratio >= 1.14:
        return 3
    return 0


def _docx_to_markdown(path: Path) -> str:
    """تبدیل Word به Markdown با mammoth (سبک‌های Heading به # تبدیل می‌شوند)."""
    try:
        import mammoth  # type: ignore
    except ImportError as exc:
        raise FileReadError(
            "برای خواندن فایل Word باید بسته‌ی «mammoth» نصب باشد. (pip install mammoth)"
        ) from exc

    with open(path, "rb") as handle:
        result = mammoth.convert_to_markdown(handle)
    return result.value or ""


def _plain_to_markdown(text: str) -> str:
    """متن ساده را به Markdown ساده تبدیل می‌کند (تشخیص حداقلی سرفصل)."""
    out: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw.strip()
        if not line:
            out.append("")
            continue
        if len(line) <= 90 and (KEYWORD_RE.match(line) or NUMBERED_RE.match(line)):
            out.append(f"## {line}")
        else:
            out.append(line)
    return "\n".join(out)


def normalize_markdown(markdown: str) -> str:
    """پاکسازی ساده: یکنواخت‌سازی خطوط، حذف فاصله‌های اضافی و خطوط خالی تکراری."""
    text = (markdown or "").replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u200c\u200c", "\u200c")  # نیم‌فاصله‌های تکراری
    cleaned: list[str] = []
    blank_run = 0
    for raw in text.split("\n"):
        line = raw.rstrip()
        if not line.strip():
            blank_run += 1
            if blank_run > 1:
                continue
            cleaned.append("")
            continue
        blank_run = 0
        cleaned.append(re.sub(r"[ \t]{2,}", " ", line))
    return "\n".join(cleaned).strip() + "\n"


# -----------------------------------------------------------------------------
# استخراج و نمایش سرفصل‌ها
# -----------------------------------------------------------------------------
def _clean_title(text: str) -> str:
    """پاکسازی عنوان سرفصل از نشانه‌های Markdown و فاصله‌های اضافی."""
    title = re.sub(r"\*\*|__|~~|`", "", text or "")
    title = re.sub(r"^\[|\]\(.*?\)$", "", title)  # لینک‌های Markdown
    return re.sub(r"\s+", " ", title).strip(" -–—.:؛،")


def extract_headings(markdown: str) -> list[dict]:
    """فهرست سرفصل‌ها را از Markdown استخراج می‌کند.

    هر آیتم: {"level": int, "title": str, "source": "markdown"|"heuristic"}
    """
    headings: list[dict] = []
    for raw in (markdown or "").split("\n"):
        match = HEADING_RE.match(raw)
        if not match:
            continue
        title = _clean_title(match.group(2))
        if title:
            headings.append(
                {"level": len(match.group(1)), "title": title, "source": "markdown"}
            )
    if headings:
        return headings[:MAX_HEADINGS]
    return _guess_headings(markdown)


def _guess_headings(markdown: str) -> list[dict]:
    """اگر سرفصل Markdown وجود نداشت، با نشانه‌های متنی حدس می‌زند."""
    headings: list[dict] = []
    in_code_block = False
    for raw in (markdown or "").split("\n"):
        line = raw.strip()
        if line.startswith("```"):
            in_code_block = not in_code_block
            continue
        if in_code_block or not line or len(line) > 90:
            continue
        if KEYWORD_RE.match(line):
            headings.append({"level": 1, "title": _clean_title(line), "source": "heuristic"})
            continue
        if NUMBERED_RE.match(line) and not line.endswith((".", "،", "؛", "!", "?")):
            headings.append({"level": 2, "title": _clean_title(line), "source": "heuristic"})
        if len(headings) >= MAX_HEADINGS:
            break
    return headings


def outline_to_text(headings: list[dict]) -> str:
    """سرفصل‌ها را به صورت متن ساده و تودرتو (برای ارسال به مدل) برمی‌گرداند."""
    lines = []
    for heading in headings or []:
        indent = "  " * max(0, int(heading.get("level", 1)) - 1)
        lines.append(f"{indent}- {heading.get('title', '')}")
    return "\n".join(lines)


def render_outline_md(headings: list[dict], title: str = "") -> str:
    """نمایش سرفصل‌ها به صورت فهرست تودرتوی Markdown برای رابط کاربری."""
    lines: list[str] = []
    if title:
        lines.append(f"### فهرست مطالب — {title}")
    if not headings:
        lines.append(
            "هیچ سرفصلی پیدا نشد. اگر فایل اسکن‌شده است، یا سرفصل‌ها با سبک Heading "
            "نوشته نشده‌اند، می‌توانید متن Markdown را دستی ویرایش کنید."
        )
        return "\n".join(lines)

    lines.append(f"**{len(headings)} سرفصل شناسایی شد:**")
    lines.append("")
    for heading in headings:
        level = max(1, int(heading.get("level", 1)))
        indent = "  " * (level - 1)
        mark = "**" if level == 1 else ""
        lines.append(f"{indent}- {mark}{heading.get('title', '')}{mark}")
    return "\n".join(lines)


def render_stats_md(title: str, markdown: str, headings: list[dict]) -> str:
    """آمار کوتاه متن: تعداد کاراکتر، توکن تخمینی و تعداد سرفصل‌ها."""
    chars = len(markdown or "")
    words = len((markdown or "").split())
    tokens = estimate_tokens(markdown or "")
    level_counts = {}
    for heading in headings or []:
        level = int(heading.get("level", 1))
        level_counts[level] = level_counts.get(level, 0) + 1
    breakdown = " | ".join(
        f"سطح {level}: {count}" for level, count in sorted(level_counts.items())
    )
    return (
        f"**عنوان:** {title or '—'}  \n"
        f"**کاراکتر:** {chars:,}  |  **واژه:** {words:,}  |  "
        f"**توکن تخمینی:** {tokens:,}  \n"
        f"**سرفصل‌ها:** {len(headings or [])}"
        + (f"  ({breakdown})" if breakdown else "")
    )
