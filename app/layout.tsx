import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import localFont from "next/font/local";
import { headers } from "next/headers";
import { CSPProvider } from "@base-ui/react/csp-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { TopNav } from "@/components/top-nav";
import { ToastProvider } from "@/components/toast-provider";
import { SidebarProvider } from "@/components/sidebar-provider";
import { MainContent } from "@/components/main-content";
import { RealtimeBridge } from "@/components/realtime-bridge";
import { ThemeProvider } from "@/components/theme-provider";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Mono is only used on template/broadcast screens and Playfair only as the
// logo's fallback, so they load on demand instead of being preloaded everywhere.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  preload: false,
});

const maharlika = localFont({
  src: "../public/fonts/Maharlika-Regular.ttf",
  variable: "--font-maharlika",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "CREST CRM",
    template: "CREST CRM - %s",
  },
  description: "Internal CRM for managing investor contacts and follow-ups.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The per-request nonce from proxy.ts (Content-Security-Policy, lib/csp.ts).
  // Reading headers makes every page render per request, which the nonce needs.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} ${maharlika.variable} h-full antialiased`}
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex h-full flex-col">
        {/* Base UI adds a small <style> (hides scrollbars in dropdowns); it needs the nonce too. */}
        <CSPProvider nonce={nonce}>
          <ThemeProvider>
            <ToastProvider>
              <SidebarProvider>
                <RealtimeBridge />
                <TopNav />
                <div className="flex flex-1 overflow-hidden">
                  <AppSidebar />
                  <MainContent>{children}</MainContent>
                </div>
              </SidebarProvider>
            </ToastProvider>
          </ThemeProvider>
        </CSPProvider>
      </body>
    </html>
  );
}
