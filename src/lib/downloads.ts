// Public metadata for Kestrel downloads (extension, AI kit, connector).
// Binary downloads are served from private Supabase Storage (/app/download/[file]).

export const DOWNLOADS = {
  version: "2.9.4",
  built: "2026-11-19",
  extension: "Kestrel-extension-2.9.4.zip",
  kit: "Kestrel-AI-Kit.zip",
  sizes: {
    "Kestrel-extension-2.9.4.zip": 431801,
    "Kestrel-AI-Kit.zip": 12738,
  },
} as const;

export const CONNECT_UPDATE = {
  version: "1.0.2",
  sha256: "f7b3617fa0b8701ad243fc2a353ffec9f24345050f588e148a34bbfd7049b5b5",
  sig: "FnH1JkJH1KcbE9d7Dgi/lhxcbFTb/HS0gDNmqU0PzNELnAXcg1RRfViqD9PIoLVjBtT8wdnCJRUTAk0eaea6CA==",
} as const;

export default DOWNLOADS;
