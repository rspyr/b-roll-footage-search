import { GoogleGenAI } from "@google/genai";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY must be set. Get one from https://aistudio.google.com/apikey");
}

export const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
