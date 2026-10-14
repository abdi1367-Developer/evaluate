import './globals.css';

export const metadata = {
  title: 'سرفصل‌یاب و داور هوشمند | PDF/Word → Markdown + نمره‌دهی DeepSeek',
  description:
    'فایل PDF یا Word را به Markdown تبدیل کن، سرفصل‌ها را ببین و با DeepSeek تحلیل و نمره‌دهی کن.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2f6df6',
};

export default function RootLayout({ children }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap"
        />
        {children}
      </body>
    </html>
  );
}
