import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Study Buddy — a tutor that remembers",
  description:
    "A study tutor chatbot with real long-term memory, powered by Walrus Memory (MemWal).",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
