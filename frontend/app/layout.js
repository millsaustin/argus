import './globals.css';
import { Inter } from 'next/font/google';

export const metadata = {
  title: 'Argus Dashboard',
  description: 'Phase 1 Proxmox dashboard UI'
};

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`dark ${inter.variable}`} suppressHydrationWarning>
      <body className="bg-background text-foreground font-sans">{children}</body>
    </html>
  );
}
