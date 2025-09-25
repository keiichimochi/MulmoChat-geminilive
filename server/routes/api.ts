import express, { Request, Response, Router } from "express";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { puppeteerCrawlerAgent } from "mulmocast";
import { StartApiResponse } from "../types";
import { GeminiSessionManager, createDefaultSessionConfig } from "../services/geminiSessionManager";
dotenv.config();

const router: Router = express.Router();

// Initialize Gemini Session Manager
let geminiSessionManager: GeminiSessionManager | null = null;

const initializeGeminiSessionManager = (): GeminiSessionManager => {
  if (!geminiSessionManager) {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      throw new Error("GEMINI_API_KEY environment variable not set");
    }
    geminiSessionManager = new GeminiSessionManager(geminiKey);
  }
  return geminiSessionManager;
};

// Session start endpoint - Updated for Gemini Live
router.post("/start", async (req: Request, res: Response): Promise<void> => {
  const googleMapKey = process.env.GOOGLE_MAP_API_KEY;

  try {
    // Initialize Gemini Session Manager
    const sessionManager = initializeGeminiSessionManager();

    // Create session configuration with customizable parameters
    const systemInstructions =
      req.body.systemInstructions ||
      "You are a teacher who explains various things in a way that even middle school students can easily understand. " +
      "When words alone are not enough, you MUST use the generateImage API to draw pictures and use them to help explain. " +
      "When you are talking about places, objects, people, movies, books and other things, you MUST use the generateImage API " +
      "to draw pictures to make the conversation more engaging.";

    // Parse optional configuration parameters from request body
    const temperature = req.body.temperature ? parseFloat(req.body.temperature.toString()) : undefined;
    const maxOutputTokens = req.body.maxTokens ? parseInt(req.body.maxTokens.toString()) : undefined;
    const audioInputSampleRate = req.body.inputSampleRate ? parseInt(req.body.inputSampleRate.toString()) : undefined;
    const audioOutputSampleRate = req.body.outputSampleRate ? parseInt(req.body.outputSampleRate.toString()) : undefined;

    // Build configuration options with proper type handling
    const configOptions: {
      temperature?: number;
      maxOutputTokens?: number;
      audioInputSampleRate?: number;
      audioOutputSampleRate?: number;
    } = {};

    if (temperature && !isNaN(temperature)) {
      configOptions.temperature = Math.max(0, Math.min(2, temperature));
    }
    if (maxOutputTokens && !isNaN(maxOutputTokens)) {
      configOptions.maxOutputTokens = Math.max(1, Math.min(8192, maxOutputTokens));
    }
    if (audioInputSampleRate && !isNaN(audioInputSampleRate)) {
      configOptions.audioInputSampleRate = audioInputSampleRate;
    }
    if (audioOutputSampleRate && !isNaN(audioOutputSampleRate)) {
      configOptions.audioOutputSampleRate = audioOutputSampleRate;
    }

    const sessionConfig = createDefaultSessionConfig(systemInstructions, [], configOptions);

    // Create Gemini Live session
    const sessionResult = await sessionManager.createSession(sessionConfig);

    if (!sessionResult.success) {
      console.error("Failed to create Gemini Live session:", sessionResult.error);
      res.status(500).json({
        error: "Failed to create session",
        details: sessionResult.error.message,
      });
      return;
    }

    const session = sessionResult.data;

    // Prepare response data compatible with existing frontend
    const responseData: StartApiResponse = {
      success: true,
      message: "Gemini Live session started",
      ephemeralKey: session.ephemeralToken, // For backward compatibility
      ephemeralToken: session.ephemeralToken, // New field
      websocketUrl: session.websocketUrl, // New field for Gemini Live
      googleMapKey: googleMapKey || undefined,
    };

    console.log("✅ Gemini Live session created:", {
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
    });

    res.json(responseData);
  } catch (error: unknown) {
    console.error("Failed to start Gemini Live session:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    res.status(500).json({
      error: "Failed to start session",
      details: errorMessage,
    });
  }
});

// Generate image endpoint
router.post(
  "/generate-image",
  async (req: Request, res: Response): Promise<void> => {
    const { prompt, images } = req.body;

    if (!prompt) {
      res.status(400).json({ error: "Prompt is required" });
      return;
    }

    const geminiKey = process.env.GEMINI_API_KEY;

    if (!geminiKey) {
      res
        .status(500)
        .json({ error: "GEMINI_API_KEY environment variable not set" });
      return;
    }

    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const model = "gemini-2.5-flash-image-preview";
      const contents: {
        text?: string;
        inlineData?: { mimeType: string; data: string };
      }[] = [{ text: prompt }];
      for (const image of images ?? []) {
        contents.push({ inlineData: { mimeType: "image/png", data: image } });
      }
      const response = await ai.models.generateContent({ model, contents });
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const returnValue: {
        success: boolean;
        message: string | undefined;
        imageData: string | undefined;
      } = {
        success: false,
        message: undefined,
        imageData: undefined,
      };

      console.log(
        "*** Gemini image generation response parts:",
        parts.length,
        prompt,
      );

      for (const part of parts) {
        if (part.text) {
          console.log("*** Gemini image generation response:", part.text);
          returnValue.message = part.text;
        }
        if (part.inlineData) {
          const imageData = part.inlineData.data;
          if (imageData) {
            console.log("*** Image generation succeeded");
            returnValue.success = true;
            returnValue.imageData = imageData;
          } else {
            console.log("*** the part has inlineData, but no image data", part);
          }
        }
      }
      if (!returnValue.message) {
        returnValue.message = returnValue.imageData
          ? "image generation succeeded"
          : "no image data found in response";
      }

      res.json(returnValue);
    } catch (error: unknown) {
      console.error("*** Image generation failed", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({
        error: "Failed to generate image",
        details: errorMessage,
      });
    }
  },
);

// Browse endpoint using mulmocast puppeteerCrawlerAgent
router.post("/browse", async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body;

  if (!url) {
    res.status(400).json({ error: "URL is required" });
    return;
  }

  try {
    const result = await puppeteerCrawlerAgent.agent({
      params: {},
      debugInfo: {
        verbose: false,
        nodeId: "",
        state: "",
        subGraphs: new Map(),
        retry: 0
      },
      filterParams: {},
      namedInputs: { url }
    } as any);
    res.json({
      success: true,
      data: result,
    });
  } catch (error: unknown) {
    console.error("Browse failed:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      error: "Failed to browse URL",
      details: errorMessage,
    });
  }
});

// Twitter oEmbed proxy endpoint
router.get(
  "/twitter-embed",
  async (req: Request, res: Response): Promise<void> => {
    const { url } = req.query;

    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "URL query parameter is required" });
      return;
    }

    try {
      // Validate that it's a Twitter/X URL
      const urlObj = new URL(url);
      const isValidTwitterUrl = [
        "twitter.com",
        "www.twitter.com",
        "x.com",
        "www.x.com",
      ].includes(urlObj.hostname);

      if (!isValidTwitterUrl) {
        res.status(400).json({ error: "URL must be a Twitter/X URL" });
        return;
      }

      const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&theme=light&maxwidth=500&hide_thread=false&omit_script=false`;

      const response = await fetch(oembedUrl);

      if (!response.ok) {
        throw new Error(
          `Twitter oEmbed API error: ${response.status} ${response.statusText}`,
        );
      }

      const data = await response.json();
      res.json({
        success: true,
        html: data.html,
        author_name: data.author_name,
        author_url: data.author_url,
        url: data.url,
      });
    } catch (error: unknown) {
      console.error("Twitter embed failed:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({
        error: "Failed to fetch Twitter embed",
        details: errorMessage,
      });
    }
  },
);

export default router;
