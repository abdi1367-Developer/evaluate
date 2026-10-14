/**
 * این اسکریپت پس از نصب پکیج‌ها (postinstall) اجرا می‌شود و فایل worker کتابخانه‌ی
 * PDF را از node_modules داخل پوشه‌ی public کپی می‌کند.
 *
 * چرا؟ چون pdf.js برای خواندن PDF به یک worker جداگانه نیاز دارد و اگر آن را از
 * دامنه‌ی خودمان سرو کنیم، برنامه به اینترنت/CDN بیرونی وابسته نمی‌شود.
 */
import { copyFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const publicDir = path.join(projectRoot, 'public');
const target = path.join(publicDir, 'pdf.worker.min.mjs');

const candidates = [
  'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  'node_modules/pdfjs-dist/build/pdf.worker.mjs',
];

try {
  await mkdir(publicDir, { recursive: true });
  let copied = null;
  for (const relative of candidates) {
    const source = path.join(projectRoot, relative);
    try {
      await access(source);
      await copyFile(source, target);
      copied = relative;
      break;
    } catch {
      // فایل بعدی را امتحان کن
    }
  }
  if (copied) {
    console.log(`[setup] worker فایل PDF کپی شد: ${copied} -> public/pdf.worker.min.mjs`);
  } else {
    console.warn(
      '[setup] فایل worker پیدا نشد؛ برنامه به‌صورت خودکار از CDN استفاده می‌کند.'
    );
  }
} catch (error) {
  // postinstall هیچ‌وقت نباید نصب را متوقف کند
  console.warn(`[setup] کپی worker ناموفق بود: ${error?.message || error}`);
}
