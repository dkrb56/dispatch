import { defineConfig } from "vite";

// The phone page (ticket i-need-an-iphone-app-with-just-overview): three files with fixed names in
// `dist/phone`, which `src-tauri/build.rs` embeds into `dispatch-host`. This build runs after the
// build of the window, because that one empties `dist`.
export default defineConfig({
  base: "./",
  publicDir: false,
  clearScreen: false,
  build: {
    outDir: "dist/phone",
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: "phone.html",
      output: {
        entryFileNames: "phone.js",
        chunkFileNames: "phone-[name].js",
        assetFileNames: "phone[extname]",
      },
    },
  },
});
