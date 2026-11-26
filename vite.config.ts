import { defineConfig } from "vite";

// BASE_PATH is "/" everywhere except GitHub Pages, which serves the game from a repo subfolder (/roll-coal-3d/).
// VITE_BUILD is the build stamp shown on the title screen (UTC month/day.hour/minute); computed here so `npm run build`
// works the same on Windows, Linux CI and Vercel.
const stamp = () => {
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}.${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
};

/** In dev, saving a file used to reload the page and wipe a game in progress (it once did it on the stats screen). This plugin swallows the reload and tells the page instead, which shows a "new build, click to reload" chip. */
const noAutoReload = () => ({
  name: "no-auto-reload",
  apply: "serve" as const,
  handleHotUpdate({ server }: { server: { ws: { send: (m: unknown) => void } } }) { server.ws.send({ type: "custom", event: "rc-files-changed" }); return []; },
});

export default defineConfig(({ command }) => ({
  plugins: [noAutoReload()],
  base: process.env.BASE_PATH || "/",
  define: command === "build" ? { "import.meta.env.VITE_BUILD": JSON.stringify(process.env.VITE_BUILD || stamp()) } : {},
}));
