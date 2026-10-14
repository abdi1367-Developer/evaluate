"""ارتباط با API دیپ‌سیک و داوری سند (نمره + نظر).

ساختار کار:
- برای متن‌های کوتاه: کل Markdown یک‌جا برای داوری ارسال می‌شود.
- برای متن‌های بلند: ابتدا هر بخش خلاصه می‌شود و سپس سرفصل‌ها + خلاصه‌ها
  برای داوری نهایی ارسال می‌شوند (صرفه‌جویی چشمگیر در توکن).
"""

from __future__ import annotations

import json
import re
import time

import requests

from config import (
    CHUNK_CHARS,
    DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL,
    DEEPSEEK_MODEL,
    MAX_CHUNKS,
    MAX_RETRIES,
    REQUEST_TIMEOUT,
)
from extractor import estimate_tokens


class DeepSeekError(RuntimeError):
    """خطا در ارتباط با سرویس دیپ‌سیک."""


EVALUATOR_SYSTEM_PROMPT = """تو یک «داور» (Reviewer) حرفه‌ای، بی‌طرف و باتجربه برای مقاله‌های علمی و کتاب‌های تخصصی هستی.
وظیفه‌ات این است که متن داده‌شده را بخوانی، درباره‌ی کیفیت آن اعلام نظر کنی و نمره بدهی.

قواعد:
۱) فقط بر اساس متنی که در اختیار داری قضاوت کن و چیزی از خودت اضافه نکن.
۲) اگر متن کامل نبود (مثلاً خلاصه‌ی بخش‌ها به تو داده شده)، این نکته را در جمع‌بندی بگو.
۳) نمره را واقع‌بینانه بده: متن معمولی حدود ۵۰ تا ۷۰، متن خوب ۷۰ تا ۸۵ و متن عالی بالای ۸۵.
   نمره‌ی معیارها را متنوع بده، نه یکنواخت.
۴) همه‌ی خروجی‌ها باید فارسی روان باشند.
۵) خروجی را «فقط» به صورت یک شیء json معتبر بده؛ هیچ توضیح یا متن اضافه‌ای پیش و پس از json نگذار.

ساختار دقیق json:
{
  "score": <عدد صحیح 0 تا 100>,
  "grade": "<یکی از: ضعیف | قابل قبول | خوب | خیلی خوب | عالی>",
  "criteria": [
    {"name": "ساختار و سرفصل‌بندی", "score": <0-100>, "comment": "<یک تا دو جمله>"},
    {"name": "محتوا و عمق علمی", "score": <0-100>, "comment": "<یک تا دو جمله>"},
    {"name": "انسجام و نظم منطقی", "score": <0-100>, "comment": "<یک تا دو جمله>"},
    {"name": "نگارش و ویرایش زبانی", "score": <0-100>, "comment": "<یک تا دو جمله>"},
    {"name": "ارجاع‌دهی و اصالت", "score": <0-100>, "comment": "<یک تا دو جمله>"},
    {"name": "کاربردی‌بودن برای خواننده‌ی هدف", "score": <0-100>, "comment": "<یک تا دو جمله>"}
  ],
  "summary": "<چکیده‌ی کوتاه متن در ۳ تا ۵ خط>",
  "strengths": ["<نقطه‌ی قوت>", "<نقطه‌ی قوت>"],
  "weaknesses": ["<نقطه‌ی ضعف>", "<نقطه‌ی ضعف>"],
  "suggestions": ["<پیشنهاد عملی و قابل اجرا>", "<پیشنهاد عملی>"],
  "verdict": "<جمع‌بندی نهایی در ۲ تا ۳ خط، همراه با نمره و دلیل اصلی آن>"
}"""


SUMMARY_SYSTEM_PROMPT = """تو یک خلاصه‌ساز دقیق و امانت‌دار هستی و بخشی از یک مقاله/کتاب به تو داده می‌شود.
آن را به فارسی و در قالب نکات کلیدی فشرده خلاصه کن.
- سرفصل‌ها و زیربخش‌های همان بخش را حفظ کن.
- ادعاها، داده‌ها، اعداد، روش‌ها و نتیجه‌گیری‌های مهم را نگه دار و مطالب تکراری یا کم‌اهمیت را حذف کن.
- چیزی از خودت اضافه نکن و به متن وفادار بمان.
- خروجی حداکثر حدود ۲۵۰ واژه باشد و با Markdown ساده (فهرست نقطه‌ای) نوشته شود."""


def resolve_api_key(api_key: str | None = None) -> str:
    """کلید API را از ورودی کاربر یا فایل .env می‌خواند."""
    key = (api_key or "").strip() or DEEPSEEK_API_KEY
    if not key:
        raise DeepSeekError(
            "کلید API دیپ‌سیک تنظیم نشده است. فایل .env را بسازید یا کلید را در کادر مربوطه وارد کنید."
        )
    return key


# -----------------------------------------------------------------------------
# لایه‌ی ارتباط با دیپ‌سیک
# -----------------------------------------------------------------------------
def chat(
    messages: list[dict],
    *,
    api_key: str | None = None,
    model: str = DEEPSEEK_MODEL,
    json_mode: bool = False,
    temperature: float = 0.3,
    timeout: int = REQUEST_TIMEOUT,
) -> str:
    """یک درخواست chat/completions به دیپ‌سیک می‌فرستد و متن پاسخ را برمی‌گرداند."""
    key = resolve_api_key(api_key)
    model = (model or DEEPSEEK_MODEL).strip()

    payload: dict = {"model": model, "messages": messages, "stream": False}
    if not model.startswith("deepseek-reasoner"):
        payload["temperature"] = temperature
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    url = f"{DEEPSEEK_BASE_URL}/chat/completions"

    last_error: DeepSeekError | None = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=timeout)
        except requests.RequestException as exc:
            last_error = DeepSeekError(f"عدم دسترسی به سرویس دیپ‌سیک: {exc}")
        else:
            if response.status_code == 200:
                data = response.json()
                choices = data.get("choices") or []
                if not choices:
                    raise DeepSeekError("پاسخ دیپ‌سیک خالی بود.")
                content = (choices[0].get("message") or {}).get("content") or ""
                if not content.strip():
                    raise DeepSeekError("دیپ‌سیک پاسخ متنی برنگرداند.")
                return content
            if response.status_code in (429, 500, 502, 503, 504):
                last_error = DeepSeekError(
                    f"خطای موقت سرویس دیپ‌سیک ({response.status_code}). دوباره تلاش می‌شود."
                )
            elif response.status_code == 401:
                raise DeepSeekError("کلید API نامعتبر است (خطای 401).")
            elif response.status_code == 402:
                raise DeepSeekError("اعتبار حساب دیپ‌سیک کافی نیست (خطای 402).")
            elif response.status_code == 400:
                raise DeepSeekError(f"درخواست نامعتبر بود (خطای 400): {response.text[:300]}")
            else:
                raise DeepSeekError(
                    f"خطای دیپ‌سیک ({response.status_code}): {response.text[:300]}"
                )

        if attempt < MAX_RETRIES:
            time.sleep(2 * (attempt + 1))

    raise last_error or DeepSeekError("ارتباط با دیپ‌سیک ناموفق بود.")


def parse_json_response(text: str) -> dict:
    """پاسخ مدل را به دیکشنری تبدیل می‌کند (با تحمل وجود ```json و متن اضافه)."""
    cleaned = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*(.+?)```", cleaned, re.S)
    if fence:
        cleaned = fence.group(1).strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start == -1 or end <= start:
            raise DeepSeekError("پاسخ دیپ‌سیک JSON معتبر نبود.")
        try:
            data = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError as exc:
            raise DeepSeekError(f"پاسخ دیپ‌سیک JSON معتبر نبود: {exc}") from exc
    if not isinstance(data, dict):
        raise DeepSeekError("ساختار پاسخ دیپ‌سیک با انتظار ما همخوانی ندارد.")
    return data


# -----------------------------------------------------------------------------
# برنامه‌ریزی ارسال متن (صرفه‌جویی در توکن)
# -----------------------------------------------------------------------------
def should_summarize(markdown: str, max_direct_chars: int) -> bool:
    """آیا متن برای ارسال یک‌جا بزرگ است و باید مرحله‌ای خلاصه شود؟"""
    return len(markdown or "") > max(1, int(max_direct_chars))


def truncate_for_direct(markdown: str, max_direct_chars: int) -> tuple[str, bool]:
    """متن خیلی بلند را برای ارسال یک‌جا کوتاه می‌کند (۷۰٪ ابتدا + ۳۰٪ انتها)."""
    text = markdown or ""
    limit = max(1, int(max_direct_chars))
    if len(text) <= limit:
        return text, False
    head_len = int(limit * 0.7)
    tail_len = limit - head_len
    return (
        text[:head_len]
        + "\n\n... [بخشی از میانه‌ی سند برای صرفه‌جویی در توکن حذف شد] ...\n\n"
        + text[-tail_len:],
        True,
    )


def split_into_chunks(markdown: str, chunk_chars: int = CHUNK_CHARS, max_chunks: int = MAX_CHUNKS) -> list[str]:
    """متن Markdown را با مرز سرفصل‌ها به قطعه‌هایی با اندازه‌ی مناسب تقسیم می‌کند."""
    limit = max(1000, int(chunk_chars))
    blocks = [block for block in re.split(r"(?m)(?=^#{1,6}\s)", markdown or "") if block]

    expanded: list[str] = []
    for block in blocks:
        if len(block) <= limit:
            expanded.append(block)
            continue
        expanded.extend(_split_long_block(block, limit))

    chunks: list[str] = []
    current = ""
    for block in expanded:
        if current and len(current) + len(block) > limit:
            chunks.append(current)
            current = block
        else:
            current += block
    if current:
        chunks.append(current)

    chunks = [chunk for chunk in chunks if chunk.strip()]
    if not chunks:
        return []
    if len(chunks) > max_chunks > 0:
        chunks = _merge_chunks(chunks, max_chunks)
    return chunks


def _split_long_block(block: str, limit: int) -> list[str]:
    """یک بلوک بسیار بلند را با مرز پاراگراف (و در نهایت با کاراکتر) می‌شکند."""
    pieces: list[str] = []
    current = ""
    for paragraph in block.split("\n\n"):
        if len(paragraph) > limit:
            if current:
                pieces.append(current)
                current = ""
            pieces.extend(
                paragraph[index : index + limit] for index in range(0, len(paragraph), limit)
            )
            continue
        if current and len(current) + len(paragraph) + 2 > limit:
            pieces.append(current)
            current = paragraph
        else:
            current = f"{current}\n\n{paragraph}" if current else paragraph
    if current:
        pieces.append(current)
    return pieces


def _merge_chunks(chunks: list[str], target_count: int) -> list[str]:
    """تعداد قطعه‌ها را با ادغام قطعه‌های مجاور به تعداد هدف کاهش می‌دهد."""
    total = sum(len(chunk) for chunk in chunks)
    target_size = max(1, total // max(1, target_count))

    merged: list[str] = []
    current = ""
    for chunk in chunks:
        if current and len(current) + len(chunk) > target_size and len(merged) < target_count - 1:
            merged.append(current)
            current = chunk
        else:
            current += chunk
    if current:
        merged.append(current)
    return merged


# -----------------------------------------------------------------------------
# خلاصه‌سازی بخش‌ها و داوری نهایی
# -----------------------------------------------------------------------------
def summarize_chunk(
    text: str,
    *,
    index: int = 1,
    total: int = 1,
    doc_title: str = "",
    api_key: str | None = None,
    model: str = DEEPSEEK_MODEL,
) -> str:
    """یک قطعه از سند را به خلاصه‌ی فشرده تبدیل می‌کند (برای کاهش توکن)."""
    user_prompt = (
        f"این بخش شماره {index} از {total} سند «{doc_title or 'بدون عنوان'}» است.\n"
        "آن را طبق دستور خلاصه کن.\n\n"
        "=== آغاز بخش ===\n"
        f"{text}\n"
        "=== پایان بخش ==="
    )
    return chat(
        [
            {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        api_key=api_key,
        model=model,
        temperature=0.2,
    )


def build_evaluator_user_prompt(
    content: str,
    outline_text: str,
    *,
    doc_title: str = "",
    mode_note: str = "",
    extra_note: str = "",
    original_chars: int = 0,
) -> str:
    """متن پرامپت کاربر برای مرحله‌ی داوری نهایی را می‌سازد."""
    parts = [
        "مشخصات سند:",
        f"- عنوان فایل: {doc_title or 'نامشخص'}",
        f"- حجم متن اصلی: حدود {max(original_chars, len(content)):,} کاراکتر "
        f"(≈ {estimate_tokens(content):,} توکن)",
        f"- نحوه‌ی در اختیار گذاشتن متن: {mode_note or 'متن کامل'}",
    ]
    if extra_note and extra_note.strip():
        parts.append(f"- تأکید کارفرما: {extra_note.strip()}")
    if outline_text and outline_text.strip():
        parts.append("\nسرفصل‌های شناسایی‌شده:\n" + outline_text.strip())
    parts.append("\n=== متن سند ===\n" + content + "\n=== پایان متن سند ===")
    parts.append("\nالان این سند را ارزیابی کن و خروجی json را بده.")
    return "\n".join(parts)


def evaluate(
    content: str,
    outline_text: str = "",
    *,
    doc_title: str = "",
    mode_note: str = "",
    extra_note: str = "",
    original_chars: int = 0,
    api_key: str | None = None,
    model: str = DEEPSEEK_MODEL,
) -> tuple[dict, str]:
    """سند را برای داوری به دیپ‌سیک می‌فرستد و (نتیجه‌ی نرمال‌شده، پاسخ خام) را برمی‌گرداند."""
    user_prompt = build_evaluator_user_prompt(
        content,
        outline_text,
        doc_title=doc_title,
        mode_note=mode_note,
        extra_note=extra_note,
        original_chars=original_chars,
    )
    raw = chat(
        [
            {"role": "system", "content": EVALUATOR_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        api_key=api_key,
        model=model,
        json_mode=True,
        temperature=0.2,
    )
    return normalize_result(parse_json_response(raw)), raw


# -----------------------------------------------------------------------------
# نرمال‌سازی و نمایش نتیجه
# -----------------------------------------------------------------------------
_DIGIT_MAP = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def _as_int(value) -> int | None:
    """هر ورودی (عدد، رشته، رقم فارسی) را به عدد صحیح تبدیل می‌کند."""
    if value is None or isinstance(value, bool):
        return int(value) if isinstance(value, bool) else None
    if isinstance(value, (int, float)):
        return int(round(value))
    match = re.search(r"-?\d+(?:[.,]\d+)?", str(value).translate(_DIGIT_MAP))
    if not match:
        return None
    try:
        return int(round(float(match.group(0).replace(",", "."))))
    except ValueError:
        return None


def _as_list(value) -> list[str]:
    """ورودی را به فهرست رشته‌ها تبدیل می‌کند."""
    if value is None:
        return []
    if isinstance(value, str):
        chunks = [item.strip(" -•*\t") for item in re.split(r"[\n؛;]+", value)]
        return [chunk for chunk in chunks if chunk]
    if isinstance(value, (list, tuple)):
        return [str(item).strip() for item in value if str(item).strip()]
    return [str(value).strip()]


def grade_from_score(score: int | None) -> str:
    """تبدیل نمره به توصیف کیفی."""
    if score is None:
        return "نامشخص"
    if score >= 90:
        return "عالی"
    if score >= 80:
        return "خیلی خوب"
    if score >= 70:
        return "خوب"
    if score >= 55:
        return "قابل قبول"
    return "ضعیف"


def _score_emoji(score: int | None) -> str:
    """رنگ نشانگر بر اساس نمره."""
    if score is None:
        return "⚪"
    if score >= 80:
        return "🟢"
    if score >= 60:
        return "🟡"
    return "🔴"


def normalize_result(data: dict) -> dict:
    """خروجی مدل را به ساختاری یکدست تبدیل می‌کند تا نمایش آن خطا ندهد."""
    criteria: list[dict] = []
    for item in data.get("criteria") or []:
        if isinstance(item, dict):
            criteria.append(
                {
                    "name": str(item.get("name", "")).strip() or "معیار",
                    "score": _as_int(item.get("score")),
                    "comment": str(item.get("comment", "")).strip(),
                }
            )
        elif str(item).strip():
            criteria.append({"name": str(item).strip(), "score": None, "comment": ""})

    score = _as_int(data.get("score"))
    grade = str(data.get("grade", "")).strip() or grade_from_score(score)
    return {
        "score": score,
        "grade": grade,
        "criteria": criteria,
        "summary": str(data.get("summary", "")).strip(),
        "strengths": _as_list(data.get("strengths")),
        "weaknesses": _as_list(data.get("weaknesses")),
        "suggestions": _as_list(data.get("suggestions")),
        "verdict": str(data.get("verdict", "")).strip(),
    }


def render_result_md(result: dict, meta_lines: list[str] | None = None) -> str:
    """نتیجه‌ی داوری را به Markdown خوانا برای رابط کاربری تبدیل می‌کند."""
    score = result.get("score")
    lines: list[str] = []

    lines.append(f"# {_score_emoji(score)} نمره‌ی نهایی: {score if score is not None else '—'} از ۱۰۰")
    lines.append(f"**ارزیابی کلی:** {result.get('grade') or 'نامشخص'}")
    if score is not None:
        filled = max(0, min(10, round(score / 10)))
        lines.append(f"`{'▰' * filled}{'▱' * (10 - filled)}`")
    if meta_lines:
        lines.append("_" + "  |  ".join(str(item) for item in meta_lines if item) + "_")
    lines.append("")

    if result.get("summary"):
        lines.append("## 📝 چکیده")
        lines.append(result["summary"])
        lines.append("")

    criteria = result.get("criteria") or []
    if criteria:
        lines.append("## 📊 نمره‌ی معیارها")
        lines.append("| معیار | نمره | توضیح |")
        lines.append("| --- | :---: | --- |")
        for item in criteria:
            value = item.get("score")
            value_text = f"{value}" if value is not None else "—"
            comment = (item.get("comment") or "").replace("|", "/").replace("\n", " ")
            lines.append(f"| {item.get('name')} | {value_text} | {comment} |")
        lines.append("")

    if result.get("strengths"):
        lines.append("## ✅ نقاط قوت")
        lines.extend(f"- {item}" for item in result["strengths"])
        lines.append("")

    if result.get("weaknesses"):
        lines.append("## ⚠️ نقاط ضعف")
        lines.extend(f"- {item}" for item in result["weaknesses"])
        lines.append("")

    if result.get("suggestions"):
        lines.append("## 🛠 پیشنهادهای بهبود")
        lines.extend(f"{index}. {item}" for index, item in enumerate(result["suggestions"], 1))
        lines.append("")

    if result.get("verdict"):
        lines.append("## 🎯 جمع‌بندی داور")
        lines.append("> " + result["verdict"].replace("\n", "\n> "))

    return "\n".join(lines).strip()
