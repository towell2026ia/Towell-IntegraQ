import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "IntegraQ",
    short_name: "IntegraQ",
    description: "Sistema integrado de gestión de calidad",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6f3",
    theme_color: "#1768ad",
    lang: "es-MX",
    icons: [
      {
        src: "/brand/integraq-logo.png",
        sizes: "1254x1254",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
