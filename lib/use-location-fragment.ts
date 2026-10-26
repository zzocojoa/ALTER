"use client";
import { useSyncExternalStore } from "react";
function readFragment(): string { return window.location.hash; }
function serverFragment(): string { return ""; }
function subscribe(listener: () => void): () => void { window.addEventListener("hashchange", listener); return () => window.removeEventListener("hashchange", listener); }
export function useLocationFragment(): string { return useSyncExternalStore(subscribe, readFragment, serverFragment); }
