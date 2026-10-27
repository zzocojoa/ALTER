"use client";
import type { ReactElement } from "react";
import PageError from "./error";
import type { PageErrorProps } from "./error";
import "./globals.css";
import "./styles/tokens.css";
import "./styles/foundation.css";
import "./styles/components.css";
import "./styles/shell.css";
export default function GlobalError(props: PageErrorProps): ReactElement {
  return <html lang="ko"><body><PageError {...props}/></body></html>;
}
