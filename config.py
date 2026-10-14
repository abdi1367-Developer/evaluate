"""تنظیمات کلی اپلیکیشن (کلید API، مدل و محدودیت‌های حجم متن)."""

from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # اگر python-dotenv نصب نباشد، فقط از متغیرهای محیطی استفاده می‌شود
    def load_dotenv(*_args, **_kwargs):
        return False

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


def _env_int(name: str, default: int) -> int:
    try:
        return int(str(os.getenv(name, default)).strip())
    except (TypeError, ValueError):
        return default


# --- اتصال به DeepSeek -------------------------------------------------------
DEEPSEEK_API_KEY = (os.getenv("DEEPSEEK_API_KEY") or "").strip()
DEEPSEEK_BASE_URL = (os.getenv("DEEPSEEK_BASE_URL") or "https://api.deepseek.com").rstrip("/")
DEEPSEEK_MODEL = (os.getenv("DEEPSEEK_MODEL") or "deepseek-chat").strip()
MODEL_CHOICES = ["deepseek-chat", "deepseek-reasoner"]

# --- مدیریت حجم متن (صرفه‌جویی در توکن) -------------------------------------
# اگر متن از این مقدار کاراکتر کمتر باشد، یک‌جا برای داوری ارسال می‌شود.
MAX_DIRECT_CHARS = _env_int("MAX_DIRECT_CHARS", 60_000)
# در حالت متن بلند، هر قطعه‌ی خلاصه‌سازی حداکثر این تعداد کاراکتر است.
CHUNK_CHARS = _env_int("CHUNK_CHARS", 35_000)
# حداکثر تعداد قطعه‌ها (برای کنترل هزینه)
MAX_CHUNKS = _env_int("MAX_CHUNKS", 12)
# مهلت هر درخواست به دیپ‌سیک و تعداد تلاش مجدد در خطاهای موقت
REQUEST_TIMEOUT = _env_int("REQUEST_TIMEOUT", 300)
MAX_RETRIES = _env_int("MAX_RETRIES", 2)
