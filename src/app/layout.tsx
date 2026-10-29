import './globals.css';
import './workspace.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Parakkat AI Office', description: 'Creative, digital and performance marketing team for Parakkat Jewels' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        {/* pick the saved theme before first paint so the page does not flash */}
        <script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.theme=localStorage.getItem('pk-theme')==='dark'?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}" }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600&family=Manrope:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
