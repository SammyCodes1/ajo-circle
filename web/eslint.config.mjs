import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Pre-existing findings at 8399015 (before this lint gate existed), downgraded
    // to warnings so the gate can land without touching unrelated files:
    //   react-hooks/set-state-in-effect: app/circle/[id]/page.tsx, app/create/page.tsx,
    //     app/history/page.tsx, app/page.tsx, components/AccountPanel.tsx,
    //     components/WalletMenu.tsx, components/WalletProvider.tsx,
    //     components/WcConnectSheet.tsx, components/motion.tsx
    //   react-hooks/purity: app/circle/[id]/page.tsx
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
