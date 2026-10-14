/** مدل‌های قابل انتخاب دیپ‌سیک + مدل پیش‌فرض (مشترک بین کلاینت و سرور) */

export const MODELS = [
  { id: 'deepseek-chat', label: 'deepseek-chat — سریع و کم‌هزینه (پیشنهادی)' },
  { id: 'deepseek-reasoner', label: 'deepseek-reasoner — استدلال عمیق‌تر (کندتر و گران‌تر)' },
];

export const DEFAULT_MODEL = 'deepseek-chat';
export const DEFAULT_BASE_URL = 'https://api.deepseek.com';

export function isKnownModel(value) {
  return MODELS.some((item) => item.id === value);
}

export function safeModel(value) {
  const model = String(value || '').trim();
  return isKnownModel(model) ? model : DEFAULT_MODEL;
}
