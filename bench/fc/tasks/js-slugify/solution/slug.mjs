export const slugify=s=>s.trim().toLowerCase().split(/\s+/).filter(Boolean).join('-');
