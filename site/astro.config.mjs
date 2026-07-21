// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// https://astro.build/config
export default defineConfig({
  site: "https://rhizomatics.github.io",
  base: "/signalk-einklabel-plugin",
  integrations: [
    starlight({
      title: "eInk Labels for SignalK",
      description: "Display SignalK data on eInk Electronic Shelf Labels over Bluetooth Low Energy",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/rhizomatics/signalk-einklabel-plugin",
        },
      ],
      sidebar: [{ label: "Guide", items: [{ autogenerate: { directory: "" } }] }],
    }),
  ],
});
