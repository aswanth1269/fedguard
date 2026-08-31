import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "FedGuard",
  description:
    "Adversarially robust federated learning for transaction fraud detection. Cross-round reputation against typology-targeted backdoors.",
};

/**
 * No theme bootstrap script here, deliberately.
 *
 * React 19 refuses to execute a <script> rendered inside a component, and the
 * resulting error takes the entire hydration pass down with it: every client
 * component stays frozen in its server-rendered initial state, which for an
 * animated page means a permanently invisible hero. next/script does not help,
 * it renders the same tag.
 *
 * So the default theme is decided in CSS instead. Bare :root is light, the
 * prefers-color-scheme block supplies dark, and the toggle stamps an explicit
 * data-theme that beats both. Nothing has to run before paint, and there is no
 * flash for a visitor who has never touched the toggle.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
