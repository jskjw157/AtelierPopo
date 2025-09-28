import type { Metadata } from "next";
import { Inter, Pacifico } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const pacifico = Pacifico({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-pacifico",
});

export const metadata: Metadata = {
  title: "Atelier Popo - 핸드메이드 소품샵",
  description:
    "아기자기하고 미니멀한 핸드메이드 소품샵 Atelier Popo. 에코백, 미니파우치, 데일리백, 곱창밴드, 아기 기저귀 파우치 등 다양한 핸드메이드 소품을 만나보세요.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
        />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/remixicon/4.5.0/remixicon.min.css"
        />
      </head>
      <body className={`${inter.variable} ${pacifico.variable} antialiased`}>
        {children}
        <script
          src="https://readdy.ai/api/public/assistant/widget?projectId=28f9f899-a7f6-46cc-bfa3-b5d3b4610d35"
          async
        ></script>
      </body>
    </html>
  );
}
