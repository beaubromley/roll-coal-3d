import { defineConfig } from "vite";

// BASE_PATH is "/" everywhere except GitHub Pages, which serves the game from a repo subfolder (/roll-coal-3d/).
// VITE_BUILD is the build stamp shown on the title screen (UTC month/day.hour/minute); computed here so `npm run build`
// works the same on Windows, Linux CI and Vercel.
const stamp = () => {
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}.${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
};

export default defineConfig(({ command }) => ({
  base: process.env.BASE_PATH || "/",
  define: command === "build" ? { "import.meta.env.VITE_BUILD": JSON.stringify(process.env.VITE_BUILD || stamp()) } : {},
}));
