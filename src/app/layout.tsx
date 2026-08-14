import type { Metadata, Viewport } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "IntegraQ",
  description: "Sistema integrado de gestión de calidad",
  applicationName: "IntegraQ",
  icons: {
    icon: "/brand/integraq-logo.png",
    apple: "/brand/integraq-logo.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1768ad",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
