import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import { AppSidebar } from "@/components/app-sidebar";
import { TopNav } from "@/components/top-nav";
import { ToastProvider } from "@/components/toast-provider";
import { SidebarProvider } from "@/components/sidebar-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CREST - Investor CRM",
  description: "Internal CRM for managing investor contacts and follow-ups.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} h-full antialiased`}
    >
      <body className="flex h-full flex-col">
        <ToastProvider>
          <SidebarProvider>
            <TopNav />
            <div className="flex flex-1 overflow-hidden">
              <AppSidebar />
              <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
            </div>
          </SidebarProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
