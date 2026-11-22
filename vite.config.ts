import { defineConfig } from "vite";

// BASE_PATH is "/" everywhere except GitHub Pages, which serves the game from a repo subfolder (/roll-coal-3d/).
export default defineConfig({ base: process.env.BASE_PATH || "/" });
