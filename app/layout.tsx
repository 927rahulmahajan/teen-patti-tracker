import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Teen Patti Tracker",
  description: "Record offline Teen Patti cash games and settle up.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // shared phone, prevent accidental zoom on fast taps
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="mx-auto min-h-dvh max-w-md px-4 pb-10">{children}</body>
    </html>
  );
}
