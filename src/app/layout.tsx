import './globals.css';
import './workspace.css';
import './office.css';
import './aurora.css';
import './simple.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Parakkat AI Office', description: 'Creative, digital and performance marketing team for Parakkat Jewels' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* pick the saved theme before first paint so the page does not flash */}
        <script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.theme=localStorage.getItem('pk-theme')==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}" }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
