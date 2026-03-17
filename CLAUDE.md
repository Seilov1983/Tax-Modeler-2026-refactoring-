# Project Standards: Tax Modeler 2026
1. Stack: Next.js 15, React 19, Tailwind CSS, Jotai, React Spring, React Konva.
2. UI/UX Language: "Apple Liquid Glass". Always use: `backdrop-filter: blur(12px)`, `bg-white/70` or `dark:bg-black/50`, soft shadows (`shadowBlur: 16` for errors), and large border radiuses (`rounded-3xl` for modals, `rounded-2xl` for panels).
3. Fonts: San Francisco Pro Display, Inter. 
4. Animation: Use `@react-spring/web` for all DOM animations (config: stiff) and smooth disclosure.
5. Canvas Rule: NEVER break or modify the existing flat rendering and absolute coordinate math used for Drag-and-Drop projection.
