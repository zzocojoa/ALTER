import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ALTER · 나의 학습 공간",
  description: "스스로 생각하고, 설명하고, 다시 확인하는 학습 공간입니다.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  return <html lang="ko"><body className="antialiased">{children}</body></html>;
}
