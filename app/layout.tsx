import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/dm-sans";
import "./globals.css";
import { ProfileProvider } from "@/components/ProfileProvider";
import { TutorSessionProvider } from "@/components/TutorSessionProvider";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Study Buddy — the tutor that remembers you",
  description: "A study tutor with real long-term memory on Walrus: quizzes, flashcards, and a study room where friends learn together without leaking private notes.",
};
export const viewport: Viewport = { themeColor: "#061217", width: "device-width", initialScale: 1 };

// Applies the saved (or system) theme before first paint to avoid a flash.
const themeScript = `try{var t=localStorage.getItem('sb-theme');if(!t){t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='dark'}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ProfileProvider>
          <TutorSessionProvider>
            <AppShell>{children}</AppShell>
          </TutorSessionProvider>
        </ProfileProvider>
      </body>
    </html>
  );
}
