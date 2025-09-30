export const metadata = {
  title: 'Argus Dashboard',
  description: 'Phase 1 Proxmox dashboard UI'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
