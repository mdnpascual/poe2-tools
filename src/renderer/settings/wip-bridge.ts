// Bridge for optional private WIP module.
// import.meta.glob with eager:true loads the module at build time if it exists.
// If the file doesn't exist, the glob returns an empty object.

const modules = import.meta.glob("../../private/WipTab.tsx", { eager: true }) as Record<string, any>;
const mod = Object.values(modules)[0];

export const WipTab: React.ComponentType | null = mod?.WipTab ?? null;
