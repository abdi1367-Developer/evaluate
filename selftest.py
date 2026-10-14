"""تست سریع اجزای اپلیکیشن.

اجرا:
    python selftest.py          # فقط تست‌های آفلاین (بدون اینترنت)
    python selftest.py --live   # + یک درخواست واقعی و کوچک به دیپ‌سیک (بررسی کلید API)
"""

from __future__ import annotations

import os
import sys
import tempfile

SAMPLE_MD = """# فصل اول: مقدمه
این متن مقدمه است و توضیح می‌دهد موضوع چیست.

## ۱.۲ بیان مسئله
مسئله‌ی اصلی پژوهش در این بخش توضیح داده می‌شود.

### زیربخش جزئی
توضیح کوتاه.

# فصل دوم: روش تحقیق
- مورد اول
- مورد دوم
"""


def check(name: str, condition) -> bool:
    """یک بررسی را چاپ می‌کند و نتیجه‌ی بولین آن را برمی‌گرداند."""
    ok = bool(condition)
    print(("  ✅ " if ok else "  ❌ ") + name)
    return ok


def main() -> int:
    print("— بررسی‌های آفلاین —")
    passed = True

    from analyzer import (
        normalize_result,
        parse_json_response,
        render_result_md,
        should_summarize,
        split_into_chunks,
        truncate_for_direct,
    )
    from extractor import extract_headings, outline_to_text, to_markdown

    # ۱) استخراج سرفصل‌ها از Markdown
    headings = extract_headings(SAMPLE_MD)
    titles = [item["title"] for item in headings]
    passed &= check(f"استخراج سرفصل‌ها ({len(headings)} مورد)", len(headings) == 4)
    passed &= check("عنوان‌ها درست خوانده شدند", titles[:2] == ["فصل اول: مقدمه", "۱.۲ بیان مسئله"])
    passed &= check("سطح سرفصل‌ها درست است", [item["level"] for item in headings] == [1, 2, 3, 1])
    passed &= check("خروجی متنی سرفصل‌ها", outline_to_text(headings).splitlines()[1].startswith("  - "))

    # ۲) تقسیم و کوتاه‌سازی متن بلند
    long_text = "# بخش اول\n" + ("واژه " * 4000)
    chunks = split_into_chunks(long_text, chunk_chars=5000, max_chunks=3)
    passed &= check(f"تقسیم متن بلند ({len(chunks)} قطعه)", 1 <= len(chunks) <= 3)
    passed &= check("همه‌ی قطعه‌ها متن دارند", all(chunk.strip() for chunk in chunks))
    passed &= check("مجموع قطعه‌ها کل متن را پوشش می‌دهد", sum(len(c) for c in chunks) >= len(long_text) - 10)
    truncated, was_truncated = truncate_for_direct(long_text, 1000)
    passed &= check("کوتاه‌سازی متن بلند", was_truncated and len(truncated) < 1200)
    passed &= check("تشخیص نیاز به خلاصه‌سازی", should_summarize(long_text, 1000))

    # ۳) خواندن پاسخ JSON مدل (با رقم فارسی، نمره‌ی رشته‌ای و بلوک ```json)
    raw = (
        "```json\n"
        '{"score": "۸۵", "grade": "", "criteria": [{"name": "ساختار", "score": 90, '
        '"comment": "منظم"}], "strengths": ["الف"], "weaknesses": [], '
        '"suggestions": ["ب"], "summary": "چ", "verdict": "ج"}\n'
        "```"
    )
    result = normalize_result(parse_json_response(raw))
    passed &= check("تبدیل نمره‌ی رشته‌ای به عدد", result["score"] == 85)
    passed &= check("تکمیل خودکار توصیف نمره", result["grade"] == "خیلی خوب")
    rendered = render_result_md(result, ["تست"])
    passed &= check("ساخت خروجی Markdown داوری", "نمره‌ی نهایی: 85 از ۱۰۰" in rendered)
    passed &= check("ساخت جدول معیارها", "| ساختار | 90 | منظم |" in rendered)

    # ۴) تبدیل فایل Markdown روی دیسک
    handle = tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8")
    try:
        handle.write(SAMPLE_MD)
        handle.close()
        converted = to_markdown(handle.name)
        passed &= check("خواندن فایل و تبدیل به Markdown", "فصل دوم" in converted)
    finally:
        os.unlink(handle.name)

    # ۵) بررسی کلید API
    from analyzer import resolve_api_key

    passed &= check("کلید API قابل خواندن است", bool(resolve_api_key()))

    if "--live" in sys.argv:
        print("\n— بررسی زنده‌ی دیپ‌سیک (نیازمند اینترنت) —")
        from analyzer import DeepSeekError, chat, evaluate

        try:
            reply = chat(
                [{"role": "user", "content": "فقط بنویس: سلام"}],
                temperature=0.0,
            )
            passed &= check(f"اتصال به دیپ‌سیک (پاسخ: {reply.strip()[:30]!r})", bool(reply.strip()))
        except DeepSeekError as exc:
            passed &= check(f"اتصال به دیپ‌سیک ({exc})", False)

        try:
            judged, _raw = evaluate(SAMPLE_MD, "- فصل اول\n- فصل دوم", doc_title="نمونه")
            passed &= check(
                f"داوری نمونه (نمره: {judged.get('score')} — {judged.get('grade')})",
                judged.get("score") is not None and bool(judged.get("verdict")),
            )
        except DeepSeekError as exc:
            passed &= check(f"داوری نمونه ({exc})", False)

    print("\nنتیجه:", "همه‌ی بررسی‌ها موفق بود ✅" if passed else "برخی بررسی‌ها ناموفق بود ❌")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
