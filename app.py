"""سرفصل‌یاب و داور هوشمند — اپلیکیشن ساده‌ی Gradio.

مراحل کار:
۱) فایل Word یا PDF را بدهید تا به Markdown تبدیل و سرفصل‌های آن استخراج شود.
۲) سرفصل‌ها (و متن Markdown) را ببینید و در صورت نیاز ویرایش کنید.
۳) دکمه‌ی «تحلیل با DeepSeek» را بزنید تا داور، نظر بدهد و نمره ثبت کند.
"""

from __future__ import annotations

import json
from pathlib import Path

import gradio as gr

from analyzer import (
    DeepSeekError,
    evaluate,
    render_result_md,
    resolve_api_key,
    should_summarize,
    split_into_chunks,
    summarize_chunk,
    truncate_for_direct,
)
from config import DEEPSEEK_API_KEY, DEEPSEEK_MODEL, MAX_DIRECT_CHARS, MODEL_CHOICES
from extractor import (
    SUPPORTED_EXTENSIONS,
    FileReadError,
    estimate_tokens,
    extract_headings,
    file_name,
    outline_to_text,
    render_outline_md,
    render_stats_md,
    to_markdown,
)

RTL_CSS = """
.gradio-container { direction: rtl; text-align: right; }
.gradio-container textarea, .gradio-container input { direction: rtl; text-align: right; }
.gradio-container .prose h1, .gradio-container .prose h2,
.gradio-container .prose h3, .gradio-container .prose h4 { text-align: right; }
.gradio-container .prose table { width: 100%; }
.gradio-container .cm-editor { direction: ltr; text-align: left; }
footer { display: none !important; }
"""

HEADER_MD = """
# 📚 سرفصل‌یاب و داور هوشمند
**۱)** فایل مقاله یا کتاب (Word / PDF) را آپلود کنید → **۲)** دکمه‌ی «تبدیل به Markdown و استخراج سرفصل» را بزنید
→ **۳)** سرفصل‌ها و متن را ببینید (در صورت نیاز ویرایش کنید) → **۴)** دکمه‌ی «تحلیل با DeepSeek» را بزنید و نمره بگیرید.

> فایل اول به Markdown تبدیل می‌شود؛ همین کار مصرف توکن را به‌طور محسوس کم می‌کند.
"""


def _resolve_path(file_obj) -> str:
    """مسیر فایل را از هر ورودی‌ای که Gradio می‌دهد استخراج می‌کند."""
    if isinstance(file_obj, (str, bytes)) or hasattr(file_obj, "__fspath__"):
        return str(file_obj)
    return str(getattr(file_obj, "name", file_obj))


def do_extract(file_obj):
    """مرحله‌ی ۱: خواندن فایل، تبدیل به Markdown و استخراج سرفصل‌ها.

    خروجی‌ها به ترتیب: سرفصل‌ها، متن Markdown، آمار، وضعیت، عنوان سند، متن ذخیره‌شده.
    """
    if not file_obj:
        return "", "", "", "⚠️ اول یک فایل PDF یا Word انتخاب کنید.", "", ""

    path = _resolve_path(file_obj)
    try:
        markdown = to_markdown(path)
    except FileReadError as exc:
        return "", "", "", f"❌ {exc}", "", ""
    except Exception as exc:  # noqa: BLE001 - نمایش خطای غیرمنتظره به کاربر
        return "", "", "", f"❌ خطای غیرمنتظره در خواندن فایل: {exc}", "", ""

    title = Path(path).stem
    headings = extract_headings(markdown)
    status = (
        f"✅ فایل **{file_name(path)}** خوانده و به Markdown تبدیل شد. "
        f"تعداد سرفصل‌های شناسایی‌شده: **{len(headings)}** — "
        f"حدود **{estimate_tokens(markdown):,}** توکن تخمینی."
    )
    return (
        render_outline_md(headings, title),
        markdown,
        render_stats_md(title, markdown, headings),
        status,
        title,
        markdown,
    )


UPLOAD_HINT = "⚠️ اول فایل را بدهید و دکمه‌ی «۱) تبدیل به Markdown» را بزنید."


def _no_change():
    """مقدار «بدون تغییر» برای خروجی‌های Gradio (سازگار با نسخه‌های مختلف)."""
    skip = getattr(gr, "skip", None)
    return skip() if callable(skip) else gr.update()


def do_analyze(md_text, stored_md, stored_title, model, api_key, note, save_mode, max_chars):
    """مرحله‌ی ۲: ارسال سند به دیپ‌سیک برای داوری و نمره‌دهی.

    Generator است تا وضعیت هر مرحله (خلاصه‌سازی بخش‌ها / داوری) زنده نمایش داده شود.
    خروجی‌ها: وضعیت، نتیجه‌ی داوری، JSON نهایی.
    """
    content = (md_text or "").strip() or (stored_md or "").strip()
    if not content:
        yield UPLOAD_HINT, _no_change(), _no_change()
        return

    try:
        resolve_api_key(api_key)
    except DeepSeekError as exc:
        yield f"❌ {exc}", _no_change(), _no_change()
        return

    model = (model or DEEPSEEK_MODEL).strip()
    title = (stored_title or "سند").strip()
    headings = extract_headings(content)
    outline_text = outline_to_text(headings)
    original_chars = len(content)
    char_limit = max(1000, int(max_chars or MAX_DIRECT_CHARS))
    meta = [f"مدل: `{model}`", f"{original_chars:,} کاراکتر"]

    if save_mode and should_summarize(content, char_limit):
        chunks = split_into_chunks(content)
    else:
        chunks = []

    if len(chunks) > 1:
        yield (
            f"⏳ متن بلند است ({original_chars:,} کاراکتر)؛ در {len(chunks)} بخش خلاصه می‌شود...",
            _no_change(),
            _no_change(),
        )
        summaries: list[str] = []
        for index, chunk in enumerate(chunks, 1):
            yield f"⏳ خلاصه‌سازی بخش {index} از {len(chunks)} ...", _no_change(), _no_change()
            try:
                summary = summarize_chunk(
                    chunk,
                    index=index,
                    total=len(chunks),
                    doc_title=title,
                    api_key=api_key,
                    model=model,
                )
            except DeepSeekError as exc:
                yield f"❌ {exc}", _no_change(), _no_change()
                return
            summaries.append(f"### خلاصه‌ی بخش {index}\n{summary.strip()}")

        content = (
            "## سرفصل‌های سند\n"
            + (outline_text or "(سرفصلی شناسایی نشد)")
            + "\n\n## خلاصه‌ی بخش‌ها\n"
            + "\n\n".join(summaries)
        )
        mode_note = f"سرفصل‌ها + خلاصه‌ی {len(chunks)} بخش (برای صرفه‌جویی در توکن)"
        meta.append(f"خلاصه‌سازی: {len(chunks)} بخش")
    else:
        content, truncated = truncate_for_direct(content, char_limit)
        mode_note = "متن کامل Markdown"
        if truncated:
            mode_note += " (بخشی از میانه‌ی سند برای صرفه‌جویی در توکن حذف شد)"
            meta.append("متن کوتاه‌شده")

    yield "⏳ داوری نهایی با DeepSeek ...", _no_change(), _no_change()

    try:
        result, _raw = evaluate(
            content,
            outline_text,
            doc_title=title,
            mode_note=mode_note,
            extra_note=note,
            original_chars=original_chars,
            api_key=api_key,
            model=model,
        )
    except DeepSeekError as exc:
        yield f"❌ {exc}", _no_change(), _no_change()
        return
    except Exception as exc:  # noqa: BLE001 - نمایش خطای غیرمنتظره به کاربر
        yield f"❌ خطای غیرمنتظره در تحلیل: {exc}", _no_change(), _no_change()
        return

    status = (
        f"✅ تحلیل تمام شد — نمره: **{result.get('score')}** از ۱۰۰ "
        f"({result.get('grade')}) | {mode_note}"
    )
    raw_json = json.dumps(result, ensure_ascii=False, indent=2)
    yield status, render_result_md(result, meta), raw_json


# -----------------------------------------------------------------------------
# رابط کاربری
# -----------------------------------------------------------------------------
def build_ui() -> gr.Blocks:
    """رابط کاربری ساده‌ی اپلیکیشن را می‌سازد."""
    key_status = (
        "کلید API از فایل .env خوانده شد."
        if DEEPSEEK_API_KEY
        else "کلید API در فایل .env پیدا نشد؛ آن را در کادر زیر وارد کنید."
    )
    default_model = DEEPSEEK_MODEL if DEEPSEEK_MODEL in MODEL_CHOICES else MODEL_CHOICES[0]

    with gr.Blocks(title="سرفصل‌یاب و داور هوشمند", css=RTL_CSS, theme=gr.themes.Soft()) as demo:
        gr.Markdown(HEADER_MD)

        state_title = gr.State("")
        state_md = gr.State("")

        with gr.Row():
            with gr.Column(scale=4, min_width=320):
                file_in = gr.File(
                    label="۱) فایل مقاله/کتاب (PDF یا Word)",
                    file_types=SUPPORTED_EXTENSIONS,
                )
                extract_btn = gr.Button("۱) تبدیل به Markdown و استخراج سرفصل", variant="secondary")

                gr.Markdown("---")
                model_in = gr.Dropdown(
                    choices=MODEL_CHOICES, value=default_model, label="مدل دیپ‌سیک"
                )
                api_key_in = gr.Textbox(
                    label="کلید API (خالی = خواندن از فایل .env)",
                    type="password",
                    placeholder=key_status,
                )
                note_in = gr.Textbox(
                    label="تأکید/نکته برای داور (اختیاری)",
                    lines=2,
                    placeholder="مثلاً: این متن پایان‌نامه‌ی کارشناسی ارشد است؛ سخت‌گیرانه نمره بده.",
                )
                save_mode_in = gr.Checkbox(
                    value=True,
                    label="صرفه‌جویی توکن: برای متن‌های بلند اول خلاصه‌سازی مرحله‌ای انجام شود",
                )
                max_chars_in = gr.Slider(
                    minimum=10000,
                    maximum=200000,
                    step=5000,
                    value=max(10000, min(200000, MAX_DIRECT_CHARS)),
                    label="سقف کاراکتر ارسالی در حالت «متن کامل»",
                )
                analyze_btn = gr.Button("۲) تحلیل با DeepSeek و گرفتن نمره", variant="primary")
                status_out = gr.Markdown(f"ℹ️ {key_status}  \nآماده است.")

            with gr.Column(scale=6, min_width=420):
                with gr.Tabs():
                    with gr.Tab("🔢 سرفصل‌ها"):
                        outline_out = gr.Markdown("سرفصل‌ها پس از تبدیل فایل اینجا نمایش داده می‌شوند.")
                    with gr.Tab("📄 متن Markdown"):
                        stats_out = gr.Markdown("آمار متن پس از تبدیل نمایش داده می‌شود.")
                        md_out = gr.Textbox(
                            label="متن Markdown (قابل ویرایش؛ دقیقاً همین متن به دیپ‌سیک می‌رود)",
                            lines=18,
                            max_lines=40,
                            interactive=True,
                        )
                    with gr.Tab("⭐ تحلیل و نمره"):
                        result_out = gr.Markdown("نتیجه‌ی داوری اینجا نمایش داده می‌شود.")
                        with gr.Accordion("داده‌ی JSON خروجی مدل", open=False):
                            raw_out = gr.Code(label="json", language="json", lines=12, interactive=False)

        extract_btn.click(
            fn=do_extract,
            inputs=[file_in],
            outputs=[outline_out, md_out, stats_out, status_out, state_title, state_md],
        )
        analyze_btn.click(
            fn=do_analyze,
            inputs=[
                md_out,
                state_md,
                state_title,
                model_in,
                api_key_in,
                note_in,
                save_mode_in,
                max_chars_in,
            ],
            outputs=[status_out, result_out, raw_out],
        )

    return demo


def main() -> None:
    """اجرای اپلیکیشن روی سرور محلی و باز کردن مرورگر."""
    build_ui().queue().launch(inbrowser=True, show_error=True)


if __name__ == "__main__":
    main()
