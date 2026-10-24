import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Parakkat AI Office', description: 'Creative, digital and performance marketing team for Parakkat Jewels' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Assistant:wght@400;500;600;700&display=swap" />
      </head>
      <body><div className="wrap">{children}</div></body>
    </html>
  );
}
