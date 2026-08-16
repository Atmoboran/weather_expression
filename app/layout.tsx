import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wetterklang — what the weather sounds like",
  description:
    "Two days of German weather station data and webcam imagery, played as music in your browser. Temperature picks the note, wind sets the volume, falling pressure stretches the rhythm.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
