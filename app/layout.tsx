import type { Metadata } from "next";
import { Lato, Montserrat } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const lato = Lato({
  variable: "--font-lato",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "Furniture Assist | Agency Portal",
  description: "Agency Partner Portal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className={`${lato.variable} ${montserrat.variable} bg-white min-h-screen`}
          style={{ fontFamily: "var(--font-lato), sans-serif" }}>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
