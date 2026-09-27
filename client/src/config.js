// Backend URL. On Netlify set VITE_API_URL to your Vercel deployment URL.
const fallback = `${location.protocol}//${location.hostname}:8787`;
export const API_URL = (import.meta.env.VITE_API_URL || fallback).replace(/\/$/, '');
